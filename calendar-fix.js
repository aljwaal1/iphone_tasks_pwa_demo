'use strict';

(function calendarImportFix() {
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

  function showCalendarInstructions() {
    if (typeof openInfoDialog !== 'function') return;
    setTimeout(() => {
      openInfoDialog('إكمال تفعيل التنبيه', `
        <ol>
          <li>في شاشة التقويم التي فتحت، اضغط <strong>إضافة الكل</strong> ثم اختر التقويم واضغط إضافة.</li>
          <li>افتح الحدث بعد إضافته وتأكد أن خانة <strong>تنبيه</strong> ليست «بلا».</li>
          <li>من إعدادات الآيفون افتح <strong>الإشعارات ← التقويم</strong> وفعّل السماح بالإشعارات، شاشة القفل، والـ<strong>أصوات</strong>.</li>
        </ol>
        <p><strong>مهم:</strong> مجرد تنزيل الملف إلى تطبيق «الملفات» لا يضيف موعدًا ولا ينشئ تنبيهًا.</p>
      `);
    }, 900);
  }

  function openCalendarPreview(tasks, name) {
    if (!tasks.length) return false;
    const content = makeCalendar(tasks, name);
    const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const preview = window.open(url, '_blank');
    if (!preview) window.location.assign(url);

    setTimeout(() => URL.revokeObjectURL(url), 120000);
    showCalendarInstructions();
    return true;
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

  document.addEventListener('click', (event) => {
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
      if (openCalendarPreview([task], task.title)) markExported([task]);
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
    if (openCalendarPreview(tasks, 'مهامي اليومية')) markExported(tasks);
    if (typeof closeMenu === 'function') closeMenu();
  }, true);
})();
