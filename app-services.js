'use strict';

import {
  CALENDAR_EXPORT_CACHE,
  CALENDAR_RETURN_FLAG,
  MAX_FILE_BYTES,
  MAX_IMPORT_TASKS,
  MAX_TIMER_DELAY,
  RECOVERY_KEY,
  STORAGE_KEY,
  el,
  formatDue,
  isIos,
  isStandalone,
  loadTasks,
  normalizeTaskList,
  nowIso,
  readJson,
  reminderDate,
  saveSettings,
  saveTasks,
  sourceTaskArray,
  state,
  taskFingerprint,
  toast
} from './app-state.js';
import { buildCalendar, SCHEMA_VERSION } from './core.js';
import { closeInfoDialog, closeMenu, openInfoDialog, render } from './app-ui.js';

function safeFilePart(value) {
  return String(value || 'iphone-task')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'iphone-task';
}

async function shareFile(file, { title = file.name, text = '' } = {}) {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    }
  } catch (error) {
    if (error?.name === 'AbortError') return 'cancelled';
    console.warn('Share failed', error);
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return 'downloaded';
}

async function createCalendarRoute(content, name) {
  if (!('caches' in window) || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) return null;
  const cache = await caches.open(CALENDAR_EXPORT_CACHE);
  const old = await cache.keys();
  await Promise.all(old.map((request) => cache.delete(request)));
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const url = new URL(`./calendar-export-${token}.ics`, location.href);
  await cache.put(url.href, new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${safeFilePart(name)}.ics"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  }));
  registration.update().catch(() => {});
  return url.href;
}

function markCalendarFileCreated(tasks) {
  const timestamp = nowIso();
  tasks.forEach((task) => {
    task.calendarFileAt = timestamp;
    task.calendarFingerprint = taskFingerprint(task);
  });
  saveTasks();
  render();
}

export function showCalendarHelp() {
  openInfoDialog('إكمال إضافة الموعد', `
    <ol>
      <li>إذا ظهرت معاينة التقويم اضغط <strong>إضافة</strong> أو <strong>إضافة الكل</strong>.</li>
      <li>إذا نُزّل الملف، افتحه من سهم التنزيلات في Safari ثم وافق على إضافته.</li>
      <li>افتح الحدث داخل التقويم وتأكد أن خانة <strong>تنبيه</strong> ليست «بلا».</li>
      <li>فعّل إشعارات وأصوات تطبيق التقويم من إعدادات الآيفون.</li>
    </ol>
    <p><strong>مهم:</strong> إنشاء الملف لا يعني أن الحدث أضيف تلقائيًا؛ iOS يطلب موافقتك.</p>
  `);
}

async function exportCalendarTasks(tasks, name, button) {
  if (!tasks.length) {
    toast('لا توجد مهام حالية بموعد');
    return;
  }
  button?.setAttribute('disabled', '');
  toast('جاري تجهيز ملف التقويم…');
  const content = buildCalendar(tasks, name);
  try {
    const route = await createCalendarRoute(content, name);
    if (route) {
      markCalendarFileCreated(tasks);
      sessionStorage.setItem(CALENDAR_RETURN_FLAG, '1');
      location.assign(route);
      return;
    }
    const file = new File([content], `${safeFilePart(name)}.ics`, { type: 'text/calendar;charset=utf-8' });
    const result = await shareFile(file, { title: name, text: 'افتح ملف التقويم ثم وافق على إضافته.' });
    if (result !== 'cancelled') {
      markCalendarFileCreated(tasks);
      showCalendarHelp();
    }
  } catch (error) {
    console.error('Calendar export failed', error);
    toast('تعذر إنشاء ملف التقويم');
  } finally {
    button?.removeAttribute('disabled');
  }
}

export function exportTaskCalendar(id, button) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task?.due) {
    toast('هذه المهمة لا تحتوي على موعد');
    return;
  }
  exportCalendarTasks([task], task.title, button);
}

export function exportAllToCalendar(button) {
  const tasks = state.tasks.filter((task) => !task.done && task.due);
  exportCalendarTasks(tasks, 'مهامي اليومية', button);
  closeMenu({ restore: false });
}

export async function exportBackup() {
  const payload = {
    format: 'iphone-tasks-backup',
    version: SCHEMA_VERSION,
    exportedAt: nowIso(),
    settings: state.settings,
    tasks: state.tasks
  };
  const file = new File(
    [JSON.stringify(payload, null, 2)],
    `iphone-tasks-backup-${new Date().toISOString().slice(0, 10)}.json`,
    { type: 'application/json' }
  );
  await shareFile(file, { title: 'نسخة احتياطية لمهامي' });
  closeMenu();
  toast('تم تجهيز النسخة الاحتياطية');
}

function applyImportedTasks(imported, mode) {
  if (mode === 'replace') {
    try {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({ createdAt: nowIso(), tasks: state.tasks }));
    } catch (_) {
      // Recovery is best-effort.
    }
    state.tasks = imported;
  } else {
    state.tasks = [...state.tasks, ...imported];
  }
  saveTasks();
  render();
  closeInfoDialog();
  toast(mode === 'replace' ? 'تم استبدال البيانات' : 'تم دمج النسخة مع المهام الحالية');
}

export async function restoreBackupFile(file) {
  if (!file || file.size > MAX_FILE_BYTES) {
    toast('حجم الملف غير مناسب');
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    const source = sourceTaskArray(parsed);
    if (!source || source.length > MAX_IMPORT_TASKS) throw new Error('invalid backup');
    const imported = normalizeTaskList(source, { regenerateIds: true });
    if (!imported.length && source.length) throw new Error('invalid tasks');
    openInfoDialog('استعادة نسخة احتياطية', `
      <p>تم العثور على <strong>${imported.length}</strong> مهمة. اختر طريقة الاستعادة:</p>
      <div class="dialog-actions">
        <button id="mergeBackupButton" type="button">دمج مع المهام الحالية</button>
        <button id="replaceBackupButton" type="button" class="danger-button">استبدال جميع البيانات</button>
        <button id="cancelBackupButton" type="button">إلغاء</button>
      </div>
    `, () => {
      el('mergeBackupButton').addEventListener('click', () => applyImportedTasks(imported, 'merge'));
      el('replaceBackupButton').addEventListener('click', () => applyImportedTasks(imported, 'replace'));
      el('cancelBackupButton').addEventListener('click', closeInfoDialog);
    });
  } catch (error) {
    console.warn('Invalid backup', error);
    toast('ملف النسخة الاحتياطية غير صالح');
  } finally {
    el('restoreFileInput').value = '';
  }
}

export function restoreRecoverySnapshot() {
  const recovery = readJson(RECOVERY_KEY, null);
  const source = sourceTaskArray(recovery);
  if (!source) {
    toast('لا توجد نسخة استرداد محفوظة');
    closeMenu();
    return;
  }
  const restored = normalizeTaskList(source);
  openInfoDialog('استعادة النسخة السابقة', `
    <p>سيتم استبدال البيانات الحالية بنسخة محفوظة قبل آخر عملية استبدال، وتحتوي على <strong>${restored.length}</strong> مهمة.</p>
    <div class="dialog-actions">
      <button id="confirmRecoveryButton" type="button" class="danger-button">استعادة الآن</button>
      <button id="cancelRecoveryButton" type="button">إلغاء</button>
    </div>
  `, () => {
    el('confirmRecoveryButton').addEventListener('click', () => {
      state.tasks = restored;
      saveTasks();
      render();
      closeInfoDialog();
      toast('تمت استعادة النسخة السابقة');
    });
    el('cancelRecoveryButton').addEventListener('click', closeInfoDialog);
  });
  closeMenu({ restore: false });
}

export function showInstallHelp() {
  closeMenu({ restore: false });
  if (isStandalone()) {
    openInfoDialog('التطبيق مثبت', '<p><strong>التطبيق يعمل من الشاشة الرئيسية.</strong></p><p>البيانات محفوظة محليًا ويمكنك استخدامه دون إنترنت.</p>');
    return;
  }
  if (state.deferredInstallPrompt) {
    openInfoDialog('تثبيت التطبيق', '<div class="dialog-actions"><button id="nativeInstallButton" type="button">تثبيت الآن</button></div>', () => {
      el('nativeInstallButton').addEventListener('click', async () => {
        await state.deferredInstallPrompt.prompt();
        state.deferredInstallPrompt = null;
        closeInfoDialog();
      });
    });
    return;
  }
  openInfoDialog('تثبيت على الآيفون', `
    <ol><li>افتح الصفحة في <strong>Safari</strong>.</li><li>اضغط زر المشاركة.</li><li>اختر <strong>إضافة إلى الشاشة الرئيسية</strong>.</li><li>اضغط إضافة.</li></ol>
  `);
}

function notificationSupportStatus() {
  if (!('Notification' in window)) return 'غير مدعوم في هذا الوضع';
  if (!('serviceWorker' in navigator)) return 'Service Worker غير مدعوم';
  return Notification.permission === 'granted' ? 'مسموح' : Notification.permission === 'denied' ? 'مرفوض' : 'لم يُطلب بعد';
}

export function showNotificationCenter() {
  closeMenu({ restore: false });
  openInfoDialog('تشخيص التنبيهات', `
    <div class="diagnostic-grid">
      <span>التشغيل من الشاشة الرئيسية</span><strong>${isStandalone() ? 'نعم' : 'لا'}</strong>
      <span>دعم إشعارات الويب</span><strong>${'Notification' in window ? 'نعم' : 'لا'}</strong>
      <span>الإذن</span><strong>${notificationSupportStatus()}</strong>
      <span>التنبيهات المحلية مفعلة</span><strong>${state.settings.localNotifications ? 'نعم' : 'لا'}</strong>
    </div>
    <p>تنبيهات التطبيق المحلية تعمل فقط ما دام التطبيق مفتوحًا أو ما زال حيًا في النظام. للتنبيه المضمون بعد الإغلاق استخدم ملف تقويم الآيفون.</p>
    <div class="dialog-actions">
      <button id="enableNotificationsButton" type="button">تفعيل واختبار إشعار</button>
      <button id="testSoundButton" type="button">اختبار الصوت داخل التطبيق</button>
      <button id="disableNotificationsButton" type="button" class="danger-button">إيقاف تنبيهات التطبيق</button>
    </div>
  `, () => {
    el('enableNotificationsButton').addEventListener('click', enableAndTestNotifications);
    el('testSoundButton').addEventListener('click', () => playChime(true));
    el('disableNotificationsButton').addEventListener('click', () => {
      state.settings.localNotifications = false;
      saveSettings();
      scheduleReminders();
      toast('تم إيقاف تنبيهات التطبيق');
      closeInfoDialog();
    });
  });
}

export async function playChime(fromUserGesture = false) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('audio unsupported');
    const context = new AudioContextClass();
    if (fromUserGesture && context.state === 'suspended') await context.resume();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.38);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.4);
    setTimeout(() => context.close().catch(() => {}), 700);
    if (fromUserGesture) toast('تم تشغيل صوت الاختبار');
  } catch (error) {
    if (fromUserGesture) toast('تعذر تشغيل الصوت. تحقق من وضع الصامت ومستوى الصوت.');
  }
}

async function showWebNotification(title, options) {
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, options);
}

async function enableAndTestNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    toast(isIos() && !isStandalone()
      ? 'ثبّت التطبيق على الشاشة الرئيسية أولًا لاستخدام إشعارات الويب.'
      : 'إشعارات الويب غير مدعومة في هذا المتصفح.', 4500);
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('لم يتم السماح بالإشعارات. يمكنك تغيير ذلك من إعدادات الآيفون.', 4200);
      return;
    }
    state.settings.localNotifications = true;
    saveSettings();
    await showWebNotification('اختبار مهامي', {
      body: 'الإشعار يعمل. الصوت تحدده إعدادات إشعارات الآيفون ووضع الصامت.',
      icon: './icon-192.png', badge: './icon-192.png', tag: 'iphone-tasks-test', renotify: true,
      vibrate: [180, 90, 180], data: { url: './' }
    });
    await playChime(true);
    scheduleReminders();
    closeInfoDialog();
  } catch (error) {
    console.error('Notification test failed', error);
    toast('تعذر اختبار الإشعار على هذا الجهاز');
  }
}

function notificationKey(task) {
  const reminder = reminderDate(task);
  return `${task.id}|${taskFingerprint(task)}|${reminder?.getTime() || 0}`;
}

async function fireTaskReminder(task) {
  const key = notificationKey(task);
  if (task.lastNotifiedKey === key) return;
  task.lastNotifiedKey = key;
  saveTasks({ silent: true });
  try {
    await showWebNotification(task.title, {
      body: task.note || `موعد المهمة: ${formatDue(task.due)}`,
      icon: './icon-192.png', badge: './icon-192.png', tag: `task-${task.id}-${task.due}`,
      renotify: true, vibrate: [200, 100, 200], data: { url: './', taskId: task.id }
    });
    if (document.visibilityState === 'visible') playChime();
  } catch (error) {
    console.warn('Reminder notification failed', error);
  }
}

function clearReminderTimers() {
  for (const timer of state.reminderTimers.values()) clearTimeout(timer);
  state.reminderTimers.clear();
}

export function checkDueReminders() {
  if (!state.settings.localNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  state.tasks.filter((task) => !task.done && task.due).forEach((task) => {
    const reminder = reminderDate(task);
    if (!reminder) return;
    const delta = reminder.getTime() - now;
    if (delta <= 5_000 && delta >= -90_000) fireTaskReminder(task);
  });
}

export function scheduleReminders() {
  clearReminderTimers();
  if (!state.settings.localNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now();
  state.tasks.filter((task) => !task.done && task.due).forEach((task) => {
    const reminder = reminderDate(task);
    if (!reminder) return;
    const delay = reminder.getTime() - now;
    if (delay > 0 && delay <= MAX_TIMER_DELAY) {
      state.reminderTimers.set(task.id, setTimeout(() => fireTaskReminder(task), delay));
    }
  });
  checkDueReminders();
}

export function updateConnectionBadge() {
  const badge = el('connectionBadge');
  badge.textContent = navigator.onLine ? 'متصل' : 'دون إنترنت';
  badge.classList.toggle('offline', !navigator.onLine);
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    registration.update().catch(() => {});
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      location.reload();
    });
  } catch (error) {
    console.error('Service worker registration failed', error);
  }
}

export function installServiceEventHandlers() {
  window.addEventListener('tasks-saved', scheduleReminders);
  window.addEventListener('calendar-task-request', (event) => exportTaskCalendar(event.detail.id, event.detail.button));
  window.addEventListener('online', updateConnectionBadge);
  window.addEventListener('offline', updateConnectionBadge);
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      state.tasks = loadTasks();
      render();
      scheduleReminders();
    }
  });
}
