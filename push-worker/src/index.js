import webpush from 'web-push';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = origin === env.APP_ORIGIN || origin.startsWith(`${env.APP_ORIGIN}/`);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : env.APP_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Device-Secret',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function response(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...corsHeaders(request, env), 'Cache-Control': 'no-store' }
  });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function credentials(request) {
  return {
    deviceId: request.headers.get('X-Device-Id')?.trim() || '',
    deviceSecret: request.headers.get('X-Device-Secret')?.trim() || ''
  };
}

async function authenticate(request, env) {
  const { deviceId, deviceSecret } = credentials(request);
  if (!deviceId || !deviceSecret) return null;
  const device = await env.DB.prepare('SELECT device_id, secret_hash, subscription_json, active FROM devices WHERE device_id = ?')
    .bind(deviceId).first();
  if (!device || device.active !== 1) return null;
  if (await sha256(deviceSecret) !== device.secret_hash) return null;
  return device;
}

function configureWebPush(env) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

async function registerSubscription(request, env) {
  const { deviceId, deviceSecret } = credentials(request);
  if (!deviceId || !deviceSecret) return response(request, env, { error: 'missing_device_credentials' }, 400);
  const body = await request.json();
  if (!body.subscription?.endpoint || !body.subscription?.keys?.p256dh || !body.subscription?.keys?.auth) {
    return response(request, env, { error: 'invalid_subscription' }, 400);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO devices (device_id, secret_hash, subscription_json, timezone, app_origin, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      secret_hash = excluded.secret_hash,
      subscription_json = excluded.subscription_json,
      timezone = excluded.timezone,
      app_origin = excluded.app_origin,
      active = 1,
      updated_at = excluded.updated_at
  `).bind(
    deviceId,
    await sha256(deviceSecret),
    JSON.stringify(body.subscription),
    String(body.timezone || 'UTC').slice(0, 100),
    String(body.appOrigin || env.APP_ORIGIN).slice(0, 300),
    now,
    now
  ).run();
  return response(request, env, { ok: true });
}

async function syncTasks(request, env, device) {
  const body = await request.json();
  const tasks = Array.isArray(body.tasks) ? body.tasks.slice(0, 500) : [];
  const now = new Date().toISOString();
  const statements = [env.DB.prepare("DELETE FROM reminders WHERE device_id = ? AND status = 'pending'").bind(device.device_id)];
  for (const task of tasks) {
    const trigger = new Date(task.triggerAt);
    if (!task.id || !task.title || Number.isNaN(trigger.getTime())) continue;
    statements.push(env.DB.prepare(`
      INSERT INTO reminders (
        device_id, task_id, title, body, due_local, trigger_at, priority,
        task_updated_at, status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(device_id, task_id) DO UPDATE SET
        title = excluded.title, body = excluded.body, due_local = excluded.due_local,
        trigger_at = excluded.trigger_at, priority = excluded.priority,
        task_updated_at = excluded.task_updated_at, status = 'pending', attempts = 0,
        last_error = NULL, sent_at = NULL, updated_at = excluded.updated_at
    `).bind(
      device.device_id,
      String(task.id).slice(0, 160),
      String(task.title).slice(0, 160),
      String(task.body || 'حان موعد المهمة').slice(0, 600),
      String(task.due || '').slice(0, 40),
      trigger.toISOString(),
      String(task.priority || 'normal').slice(0, 20),
      String(task.updatedAt || now).slice(0, 40),
      now,
      now
    ));
  }
  await env.DB.batch(statements);
  return response(request, env, { ok: true, count: statements.length - 1 });
}

async function sendToDevice(env, device, payload) {
  configureWebPush(env);
  return webpush.sendNotification(JSON.parse(device.subscription_json), JSON.stringify(payload), {
    TTL: 86400,
    urgency: 'high'
  });
}

async function sendTest(request, env, device) {
  try {
    await sendToDevice(env, device, {
      title: 'اختبار مهامي',
      body: 'إشعارات شاشة القفل تعمل الآن.',
      tag: 'iphone-tasks-push-test',
      url: './'
    });
    return response(request, env, { ok: true });
  } catch (error) {
    return response(request, env, { error: 'push_failed', detail: String(error?.statusCode || error?.message || error) }, 502);
  }
}

async function processDue(env) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    SELECT r.*, d.subscription_json, d.active
    FROM reminders r JOIN devices d ON d.device_id = r.device_id
    WHERE r.status = 'pending' AND r.trigger_at <= ? AND d.active = 1
    ORDER BY r.trigger_at ASC LIMIT 100
  `).bind(now).all();
  for (const item of result.results || []) {
    try {
      await sendToDevice(env, item, {
        title: item.title,
        body: item.body,
        tag: `task-${item.task_id}`,
        url: './',
        taskId: item.task_id,
        due: item.due_local
      });
      await env.DB.prepare("UPDATE reminders SET status = 'sent', sent_at = ?, updated_at = ? WHERE device_id = ? AND task_id = ?")
        .bind(now, now, item.device_id, item.task_id).run();
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0);
      await env.DB.prepare(`
        UPDATE reminders SET attempts = attempts + 1, last_error = ?,
          status = CASE WHEN attempts >= 4 THEN 'failed' ELSE 'pending' END,
          updated_at = ? WHERE device_id = ? AND task_id = ?
      `).bind(String(statusCode || error?.message || error).slice(0, 500), now, item.device_id, item.task_id).run();
      if (statusCode === 404 || statusCode === 410) {
        await env.DB.prepare('UPDATE devices SET active = 0, updated_at = ? WHERE device_id = ?')
          .bind(now, item.device_id).run();
      }
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    if (url.pathname === '/health') return response(request, env, { ok: true, service: 'iphone-tasks-push' });
    if (url.pathname === '/v1/public-key' && request.method === 'GET') {
      return response(request, env, { publicKey: env.VAPID_PUBLIC_KEY });
    }
    if (url.pathname === '/v1/subscriptions' && request.method === 'POST') return registerSubscription(request, env);
    const device = await authenticate(request, env);
    if (!device) return response(request, env, { error: 'unauthorized_device' }, 401);
    if (url.pathname === '/v1/subscriptions' && request.method === 'DELETE') {
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare('UPDATE devices SET active = 0, updated_at = ? WHERE device_id = ?').bind(now, device.device_id),
        env.DB.prepare('DELETE FROM reminders WHERE device_id = ?').bind(device.device_id)
      ]);
      return response(request, env, { ok: true });
    }
    if (url.pathname === '/v1/tasks/sync' && request.method === 'POST') return syncTasks(request, env, device);
    if (url.pathname === '/v1/test' && request.method === 'POST') return sendTest(request, env, device);
    return response(request, env, { error: 'not_found' }, 404);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processDue(env));
  }
};
