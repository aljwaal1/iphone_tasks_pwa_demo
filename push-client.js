'use strict';

import { PUSH_API_URL } from './push-config.js';
import { el, isStandalone, reminderDate, state, toast } from './app-state.js';
import { closeInfoDialog, closeMenu, openInfoDialog } from './app-ui.js';

const DEVICE_ID_KEY = 'iphone_tasks_push_device_id_v16';
const DEVICE_SECRET_KEY = 'iphone_tasks_push_device_secret_v16';
const PUSH_ENABLED_KEY = 'iphone_tasks_push_enabled_v16';
let syncTimer = null;

function randomToken(prefix) {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${token}`;
}

function getDeviceCredentials() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  let deviceSecret = localStorage.getItem(DEVICE_SECRET_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID?.() || randomToken('device');
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  if (!deviceSecret) {
    deviceSecret = randomToken('secret');
    localStorage.setItem(DEVICE_SECRET_KEY, deviceSecret);
  }
  return { deviceId, deviceSecret };
}

function serverReady() {
  return /^https:\/\//i.test(PUSH_API_URL);
}

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function api(path, { method = 'GET', body } = {}) {
  if (!serverReady()) throw new Error('PUSH_SERVER_NOT_CONFIGURED');
  const { deviceId, deviceSecret } = getDeviceCredentials();
  const response = await fetch(`${PUSH_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
      'X-Device-Secret': deviceSecret
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
  return payload;
}

function serializeSubscription(subscription) {
  return subscription.toJSON ? subscription.toJSON() : {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: subscription.getKey('p256dh'),
      auth: subscription.getKey('auth')
    }
  };
}

function pushSupport() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getPushState() {
  if (!pushSupport()) return { supported: false, subscribed: false };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return {
    supported: true,
    subscribed: Boolean(subscription),
    permission: Notification.permission,
    serverConfigured: serverReady()
  };
}

async function ensureSubscription() {
  if (!pushSupport()) throw new Error('PUSH_NOT_SUPPORTED');
  if (!isStandalone()) throw new Error('INSTALL_REQUIRED');
  if (!serverReady()) throw new Error('PUSH_SERVER_NOT_CONFIGURED');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('PERMISSION_DENIED');

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { publicKey } = await api('/v1/public-key');
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey)
    });
  }

  const { deviceId } = getDeviceCredentials();
  await api('/v1/subscriptions', {
    method: 'POST',
    body: {
      deviceId,
      subscription: serializeSubscription(subscription),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      appOrigin: location.origin
    }
  });
  localStorage.setItem(PUSH_ENABLED_KEY, '1');
  return subscription;
}

function tasksForServer() {
  return state.tasks
    .filter((task) => !task.done && task.due)
    .map((task) => {
      const trigger = reminderDate(task);
      if (!trigger) return null;
      return {
        id: task.id,
        title: task.title,
        body: task.note || 'حان موعد المهمة',
        due: task.due,
        triggerAt: trigger.toISOString(),
        priority: task.priority,
        updatedAt: task.updatedAt
      };
    })
    .filter(Boolean);
}

export async function syncPushTasks({ silent = true } = {}) {
  if (!serverReady() || localStorage.getItem(PUSH_ENABLED_KEY) !== '1') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription || Notification.permission !== 'granted') return false;
    await api('/v1/tasks/sync', {
      method: 'POST',
      body: { tasks: tasksForServer() }
    });
    if (!silent) toast('تمت مزامنة مواعيد التنبيه');
    return true;
  } catch (error) {
    console.warn('Push task sync failed', error);
    if (!silent) toast('تعذر مزامنة التنبيهات');
    return false;
  }
}

export async function enablePushNotifications() {
  try {
    await ensureSubscription();
    await syncPushTasks();
    await api('/v1/test', { method: 'POST', body: {} });
    closeInfoDialog();
    toast('تم تفعيل إشعارات شاشة القفل وإرسال اختبار');
  } catch (error) {
    console.error('Push enable failed', error);
    const messages = {
      INSTALL_REQUIRED: 'افتح التطبيق من الأيقونة المثبتة على الشاشة الرئيسية.',
      PUSH_NOT_SUPPORTED: 'هذا الجهاز أو هذا الوضع لا يدعم Web Push.',
      PERMISSION_DENIED: 'تم رفض الإشعارات. فعّلها من إعدادات الآيفون ← الإشعارات ← مهامي.',
      PUSH_SERVER_NOT_CONFIGURED: 'كود الإشعارات جاهز، لكن خادم الإرسال لم يُنشر بعد.'
    };
    toast(messages[error.message] || 'تعذر تفعيل الإشعارات', 5200);
  }
}

export async function disablePushNotifications() {
  try {
    if (serverReady()) await api('/v1/subscriptions', { method: 'DELETE' });
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch (error) {
    console.warn('Push disable failed', error);
  } finally {
    localStorage.removeItem(PUSH_ENABLED_KEY);
    closeInfoDialog();
    toast('تم إيقاف إشعارات الخلفية');
  }
}

export async function showPushCenter() {
  closeMenu({ restore: false });
  const status = await getPushState();
  const statusText = !status.supported
    ? 'غير مدعوم'
    : status.subscribed && status.permission === 'granted'
      ? 'مفعّل'
      : status.permission === 'denied' ? 'مرفوض' : 'غير مفعّل';

  openInfoDialog('إشعارات شاشة القفل', `
    <div class="diagnostic-grid">
      <span>التطبيق مثبت</span><strong>${isStandalone() ? 'نعم' : 'لا'}</strong>
      <span>دعم Web Push</span><strong>${status.supported ? 'نعم' : 'لا'}</strong>
      <span>حالة الإشعارات</span><strong>${statusText}</strong>
      <span>خادم الإرسال</span><strong>${status.serverConfigured ? 'جاهز' : 'بانتظار النشر'}</strong>
    </div>
    <p>لا يوجد اسم مستخدم ولا كلمة مرور. يتعرف النظام على هذا الجهاز بمعرّف عشوائي فقط.</p>
    <div class="dialog-actions">
      <button id="enablePushButton" type="button">تفعيل وإرسال إشعار اختبار</button>
      <button id="syncPushButton" type="button">مزامنة المواعيد الآن</button>
      <button id="disablePushButton" type="button" class="danger-button">إيقاف الإشعارات</button>
    </div>
  `, () => {
    el('enablePushButton').addEventListener('click', enablePushNotifications);
    el('syncPushButton').addEventListener('click', () => syncPushTasks({ silent: false }));
    el('disablePushButton').addEventListener('click', disablePushNotifications);
  });
}

export function installPushHandlers() {
  window.addEventListener('tasks-saved', () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncPushTasks(), 900);
  });
  window.addEventListener('online', () => syncPushTasks());
}

export async function initializePush() {
  installPushHandlers();
  if (localStorage.getItem(PUSH_ENABLED_KEY) === '1') await syncPushTasks();
}
