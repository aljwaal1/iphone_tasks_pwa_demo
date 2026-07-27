'use strict';

(function calendarImportFix() {
  const CALENDAR_EXPORT_CACHE = 'iphone-tasks-calendar-exports-v2';
  const RETURN_FLAG = 'iphone_tasks_calendar_return_help';

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function escapeIcs(value) {
    return String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\r?\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function localIcsDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(date.getHours())}${pad2(date.getMinutes())}00`;
  }

  function utcIcsDate(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
  }

  function foldLine(line) {
    const limit = 70;
    if (line.length <= limit) return line;
    const parts = [];
    let rest = line;
    while (rest.length > limit) {
      parts.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    parts.push(rest);
    return parts.join('\r\n ');
  }

  function triggerFor(minutes) {
    if (minutes === 1440) return '-P1D';
    if (minutes === 0) return 'PT0M';
    return `-PT${minutes}M`;
  }

  function eventLines(task) {
    const start = new Date(task.due);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const repeatRule = task.repeat === 'daily' ? 'RRULE:FREQ=DAILY'
      : task.repeat === 'weekly' ? 'RRULE:FREQ=WEEKLY'
        : task.repeat === 'monthly' ? 'RRULE:FREQ=MONTHLY' : null;
    const description = [
      task.note,
      `التصنيف: ${task.category || 'عام'}`,
      `الأولوية: ${typeof priorityText === 'function' ? priorityText(task.priority) : task.priority}`
    ].filter(Boolean).join('\n');
    const stamp = utcIcsDate();

    return [
      'BEGIN:VEVENT',
      `UID:${escapeIcs(task.id)}@iphone-tasks.local`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${stamp}`,
      'SEQUENCE:0',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      `DTSTART:${localIcsDate(start)}`,
      `DTEND:${localIcsDate(end)}`,
      `SUMMARY:${escapeIcs(task.title)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      repeatRule,
      'BEGIN:VALARM',
      `TRIGGER;RELATED=START:${triggerFor(Number(task.remindBefore || 0))}`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcs(task.title)}`,
      'X-APPLE-DEFAULT-ALARM:TRUE',
      'END:VALARM',
      'END:VEVENT'
    ].filter(Boolean).map(foldLine);
  }

  function makeCalendar(tasks, name) {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `PRODID:-//${escapeIcs(name)}//iPhone Tasks Local//AR`,
      `X-WR-CALNAME:${escapeIcs(name)}`,
      ...tasks.flatMap(eventLines),
      'END:VCALENDAR',
      ''
    ].join('\r\n');
  }

  function safeFilePart(value) {
    return String(value || 'iphone-task')
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'iphone-task';
  }

  function showCalendarInstructions() {
    if (typeof openInfoDialog !== 'function') return;
    openInfoDialog('إكمال إضافة الموعد', `
      <ol>
        <li>إذا ظهرت معاينة التقويم، اضغط <strong>إضافة الكل</strong> أو <strong>إضافة</strong>.</li>
        <li>اختر التقويم الذي تريد حفظ الموعد فيه.</li>
        <li>بعد الإضافة افتح الحدث وتأكد أن خانة <strong>تنبيه</strong> ليست «بلا».</li>
      </ol>
      <p>إذا ظهر الملف في التنزيلات بدل التقويم، افتحه من زر التنزيلات في Safari ثم اضغط مشاركة واختر <strong>البريد</strong>؛ يدعم iPhone استيراد ملف ‎.ics من مرفق البريد.</p>
    `);
  }

  async function cacheCalendarFile(content, name) {
    if (!('caches' in window) || !('serviceWorker' in navigator)) return null;

    const registration = await navigator.serviceWorker.ready;
    await registration.update().catch(() => {});
    if (!navigator.serviceWorker.controller) return null;

    const cache = await caches.open(CALENDAR_EXPORT_CACHE);
    const oldRequests = await cache.keys();
    await Promise.all(oldRequests.map((request) => cache.delete(request)));

    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const filename = `${safeFilePart(name)}.ics`;
    const exportUrl = new URL(`./calendar-export-${token}.ics`, window.location.href);
    const response = new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });

    await cache.put(exportUrl.href, response);
    return exportUrl.href;
  }

  async function shareFallback(content, name) {
    const filename = `${safeFilePart(name)}.ics`;
    const file = new File([content], filename, { type: 'text/calendar;charset=utf-8' });

    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: name,
          text: 'افتح مرفق التقويم واضغط إضافة.'
        });
        return true;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return false;
    }

    const blobUrl = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
    return true;
  }

  async function openCalendarFile(tasks, name) {
    if (!tasks.length) return false;
    const content = makeCalendar(tasks, name);

    try {
      const url = await cacheCalendarFile(content, name);
      if (url) {
        sessionStorage.setItem(RETURN_FLAG, '1');
        window.location.assign(url);
        return true;
      }
    } catch (error) {
      console.error('Calendar route failed', error);
    }

    const shared = await shareFallback(content, name);
    if (shared) showCalendarInstructions();
    return shared;
  }

  function markExported(tasks) {
    const timestamp = typeof nowIso === 'function' ? nowIso() : new Date().toISOString();
    tasks.forEach((task) => {
      task.calendarExportedAt = timestamp;
      task.calendarExportedDue = task.due;
    });
    if (typeof saveTasks === 'function') saveTasks();
    if (typeof render === 'function') render();
  }

  document.addEventListener('click', async (event) => {
    const taskCalendarButton = event.target.closest?.('.calendar-action');
    if (taskCalendarButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const card = taskCalendarButton.closest('.task-card');
      const task = typeof state !== 'undefined'
        ? state.tasks.find((item) => item.id === card?.dataset.id)
        : null;
      if (!task?.due) {
        if (typeof toast === 'function') toast('هذه المهمة لا تحتوي على موعد');
        return;
      }
      taskCalendarButton.disabled = true;
      if (typeof toast === 'function') toast('جاري تجهيز ملف التقويم…');
      const opened = await openCalendarFile([task], task.title);
      taskCalendarButton.disabled = false;
      if (opened) markExported([task]);
      return;
    }

    const allCalendarButton = event.target.closest?.('[data-menu-action="calendar"]');
    if (!allCalendarButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const tasks = typeof state !== 'undefined'
      ? state.tasks.filter((task) => !task.done && task.due)
      : [];
    if (!tasks.length) {
      if (typeof toast === 'function') toast('لا توجد مهام حالية بموعد');
      if (typeof closeMenu === 'function') closeMenu();
      return;
    }

    allCalendarButton.disabled = true;
    if (typeof toast === 'function') toast('جاري تجهيز ملف التقويم…');
    const opened = await openCalendarFile(tasks, 'مهامي اليومية');
    allCalendarButton.disabled = false;
    if (opened) markExported(tasks);
    if (typeof closeMenu === 'function') closeMenu();
  }, true);

  if (sessionStorage.getItem(RETURN_FLAG) === '1') {
    sessionStorage.removeItem(RETURN_FLAG);
    window.addEventListener('pageshow', () => setTimeout(showCalendarInstructions, 350), { once: true });
  }
})();
