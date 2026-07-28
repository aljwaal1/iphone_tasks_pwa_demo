'use strict';

const CACHE_NAME = 'iphone-tasks-pwa-v16-web-push-20260728';
const CALENDAR_EXPORT_CACHE = 'iphone-tasks-calendar-exports-v3';
const APP_SHELL = [
  './', './index.html', './styles.css', './app.js', './app-state.js', './app-ui.js',
  './app-services.js', './push-client.js', './push-config.js', './core.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key !== CACHE_NAME && key !== CALENDAR_EXPORT_CACHE)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) || (fallback ? await caches.match(fallback) : Response.error());
  }
}

async function calendarExportResponse(request) {
  const cache = await caches.open(CALENDAR_EXPORT_CACHE);
  const response = await cache.match(request, { ignoreVary: true });
  if (response) return response;
  return new Response('انتهت صلاحية ملف التقويم. ارجع إلى التطبيق وأنشئه مرة أخرى.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.ics')) {
    event.respondWith(calendarExportResponse(event.request));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, './index.html'));
    return;
  }
  event.respondWith(networkFirst(event.request));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch (_) { payload = { body: event.data?.text() || 'لديك تذكير جديد' }; }
  const title = String(payload.title || 'مهامي');
  const options = {
    body: String(payload.body || 'حان موعد إحدى مهامك'),
    icon: './icon-192.png', badge: './icon-192.png',
    tag: String(payload.tag || `iphone-tasks-${Date.now()}`),
    renotify: true, vibrate: [200, 100, 200],
    data: { url: payload.url || './', taskId: payload.taskId || null, due: payload.due || null }
  };
  const badgePromise = self.registration.setAppBadge ? self.registration.setAppBadge(1).catch(() => {}) : Promise.resolve();
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badgePromise]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  const badgePromise = self.registration.clearAppBadge ? self.registration.clearAppBadge().catch(() => {}) : Promise.resolve();
  event.waitUntil(Promise.all([
    badgePromise,
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === new URL(target).origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      if (clients.openWindow) await clients.openWindow(target);
    })
  ]));
});
