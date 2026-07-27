'use strict';

const STORAGE_KEY = 'iphone_tasks_local_v14';
const MAX_IMPORT_TASKS = 10000;
const VALID_PRIORITIES = new Set(['high', 'medium', 'normal']);
const VALID_REPEATS = new Set(['none', 'daily', 'weekly', 'monthly']);
const VALID_REMINDERS = new Set([0, 5, 15, 30, 60, 1440]);

const state = {
  tasks: [],
  view: 'active',
  filter: 'all',
  search: '',
  editingId: null,
  priority: 'normal',
  category: 'عام',
  openActionsId: null,
  deferredInstallPrompt: null,
  waitingWorker: null
};

const el = (id) => document.getElementById(id);
const qsAll = (selector) => Array.from(document.querySelectorAll(selector));

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeText(value, maxLength = 1000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function isValidLocalDateTime(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function normalizeTask(raw, { regenerateId = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const title = safeText(raw.title, 160);
  if (!title) return null;

  const due = safeText(raw.due, 16);
  const normalizedDue = isValidLocalDateTime(due) ? due : '';
  const priority = VALID_PRIORITIES.has(raw.priority)
    ? raw.priority
    : raw.priority === 'med' ? 'medium' : raw.priority === 'low' ? 'normal' : 'normal';
  const repeat = VALID_REPEATS.has(raw.repeat) ? raw.repeat : 'none';
  const reminderNumber = Number(raw.remindBefore ?? raw.notifyBefore ?? 0);
  const remindBefore = VALID_REMINDERS.has(reminderNumber) ? reminderNumber : 0;
  const done = Boolean(raw.done);
  const completedAt = done && typeof raw.completedAt === 'string' ? raw.completedAt : null;

  return {
    id: regenerateId ? makeId() : safeText(raw.id, 120) || makeId(),
    title,
    note: safeText(raw.note, 1000),
    due: normalizedDue,
    priority,
    category: safeText(raw.category, 40) || 'عام',
    remindBefore,
    repeat,
    done,
    completedAt,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    calendarExportedAt: typeof raw.calendarExportedAt === 'string' ? raw.calendarExportedAt : null,
    calendarExportedDue: typeof raw.calendarExportedDue === 'string' ? raw.calendarExportedDue : null,
    seriesId: safeText(raw.seriesId, 120) || null,
    occurrenceOf: safeText(raw.occurrenceOf, 120) || null
  };
}

function loadTasks() {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('iphone_tasks_pwa_pro_v3');
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed
      .map((item) => normalizeTask(item))
      .filter(Boolean)
      .map((task) => {
        if (seen.has(task.id)) task.id = makeId();
        seen.add(task.id);
        return task;
      });
  } catch (error) {
    localStorage.setItem(`${STORAGE_KEY}_corrupt_${Date.now()}`, raw.slice(0, 500000));
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}

function toast(message) {
  const node = el('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2500);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function toLocalInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function splitLocalInput(value) {
  if (!value) return { date: '', time: '' };
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}

function buildDueFromForm() {
  const date = el('taskDateInput').value;
  const time = el('taskTimeInput').value;
  if (!date && !time) return '';
  if (!date || !time) {
    toast('اختر التاريخ والوقت معًا');
    return null;
  }
  const value = `${date}T${time}`;
  if (!isValidLocalDateTime(value)) {
    toast('التاريخ أو الوقت غير صالح');
    return null;
  }
  return value;
}

function isSameLocalDay(value, reference = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate();
}

function formatDue(value) {
  if (!value) return 'دون موعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'موعد غير صالح';
  return date.toLocaleString('ar-JO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function priorityText(priority) {
  return priority === 'high' ? 'عالية' : priority === 'medium' ? 'متوسطة' : 'عادية';
}

function repeatText(repeat) {
  return repeat === 'daily' ? 'يومي'
    : repeat === 'weekly' ? 'أسبوعي'
      : repeat === 'monthly' ? 'شهري' : '';
}

function reminderText(minutes) {
  if (minutes === 0) return 'وقت الموعد';
  if (minutes === 60) return 'قبل ساعة';
  if (minutes === 1440) return 'قبل يوم';
  return `قبل ${minutes} دقيقة`;
}

function calendarStatus(task) {
  if (!task.due) return null;
  if (!task.calendarExportedAt) return 'not-exported';
  if (task.calendarExportedDue !== task.due || task.updatedAt > task.calendarExportedAt) return 'stale';
  return 'exported';
}

function taskMatchesFilter(task) {
  const query = state.search.toLocaleLowerCase('ar');
  if (query) {
    const haystack = `${task.title} ${task.note} ${task.category}`.toLocaleLowerCase('ar');
    if (!haystack.includes(query)) return false;
  }

  if (state.filter === 'today') return isSameLocalDay(task.due);
  if (state.filter === 'high') return task.priority === 'high';
  if (state.filter === 'scheduled') return Boolean(task.due);
  if (state.filter === 'unscheduled') return !task.due;
  return true;
}

function sortedVisibleTasks() {
  return state.tasks
    .filter((task) => state.view === 'completed' ? task.done : !task.done)
    .filter(taskMatchesFilter)
    .sort((a, b) => {
      if (state.view === 'completed') {
        return String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? ''));
      }
      const aDue = a.due || '9999';
      const bDue = b.due || '9999';
      return aDue.localeCompare(bDue) || b.createdAt.localeCompare(a.createdAt);
    });
}

function createPill(text, className = '') {
  const span = document.createElement('span');
  span.className = `pill ${className}`.trim();
  span.textContent = text;
  return span;
}

function createTaskCard(task) {
  const card = document.createElement('article');
  card.className = `task-card${task.done ? ' completed' : ''}`;
  card.dataset.id = task.id;
  card.dataset.priority = task.priority;

  const completeButton = document.createElement('button');
  completeButton.className = 'complete-button';
  completeButton.type = 'button';
  completeButton.textContent = task.done ? '✓' : '';
  completeButton.setAttribute('aria-label', task.done ? 'إعادة المهمة إلى الحالية' : 'إكمال المهمة');
  completeButton.addEventListener('click', () => toggleTask(task.id));

  const content = document.createElement('div');
  content.className = 'task-content';

  const title = document.createElement('h3');
  title.className = 'task-title';
  title.textContent = task.title;
  content.append(title);

  if (task.note) {
    const note = document.createElement('p');
    note.className = 'task-note';
    note.textContent = task.note;
    content.append(note);
  }

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  meta.append(createPill(formatDue(task.due)));
  meta.append(createPill(`أولوية ${priorityText(task.priority)}`));
  meta.append(createPill(task.category));

  if (task.due) meta.append(createPill(`⏱ ${reminderText(task.remindBefore)}`));
  if (task.repeat !== 'none') meta.append(createPill(`↻ ${repeatText(task.repeat)}`));

  const status = calendarStatus(task);
  if (status === 'exported') meta.append(createPill('▣ تم تصدير التقويم', 'calendar'));
  if (status === 'stale') meta.append(createPill('▣ يحتاج تحديث التقويم', 'warning'));

  content.append(meta);

  const menuButton = document.createElement('button');
  menuButton.className = 'task-menu-button';
  menuButton.type = 'button';
  menuButton.textContent = '⋯';
  menuButton.setAttribute('aria-label', `خيارات ${task.title}`);
  menuButton.setAttribute('aria-expanded', state.openActionsId === task.id ? 'true' : 'false');
  menuButton.addEventListener('click', () => {
    state.openActionsId = state.openActionsId === task.id ? null : task.id;
    render();
  });

  card.append(completeButton, content, menuButton);

  if (state.openActionsId === task.id) {
    const actions = document.createElement('div');
    actions.className = 'task-actions';

    if (!task.done) {
      actions.append(actionButton('تعديل', () => openTaskSheet(task.id)));
      actions.append(actionButton('نسخ', () => duplicateTask(task.id)));
      if (task.due) actions.append(actionButton('إضافة للتقويم', () => exportTaskToCalendar(task.id), 'calendar-action'));
    } else {
      actions.append(actionButton('استعادة', () => toggleTask(task.id)));
    }

    actions.append(actionButton('حذف', () => deleteTask(task.id), 'danger'));
    card.append(actions);
  }

  return card;
}

function actionButton(label, handler, className = '') {
  const button = document.createElement('button');
  button.className = `task-action ${className}`.trim();
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function render() {
  const active = state.tasks.filter((task) => !task.done);
  const completed = state.tasks.filter((task) => task.done);
  const todays = active.filter((task) => isSameLocalDay(task.due));
  const completedToday = state.tasks.filter((task) => task.done && isSameLocalDay(task.completedAt));
  const percent = todays.length ? Math.round((completedToday.length / (todays.length + completedToday.length)) * 100) : (completedToday.length ? 100 : 0);

  const radius = 35;
  const circumference = 2 * Math.PI * radius;
  const ring = el('ringProgress');
  ring.setAttribute('stroke-dasharray', String(circumference));
  ring.setAttribute('stroke-dashoffset', String(circumference - (circumference * percent / 100)));
  el('ringPercent').textContent = `${percent}%`;
  el('summaryLabel').textContent = todays.length || completedToday.length
    ? `أنجزت ${completedToday.length} من ${todays.length + completedToday.length} اليوم`
    : 'لا توجد مهام اليوم';
  el('todayCount').textContent = String(todays.length + completedToday.length);
  el('openCount').textContent = String(active.length);
  el('doneCount').textContent = String(completed.length);

  el('activeBadge').textContent = String(active.length);
  el('completedBadge').textContent = String(completed.length);
  el('menuActiveCount').textContent = String(active.length);
  el('menuCompletedCount').textContent = String(completed.length);

  qsAll('.view-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  el('listTitle').textContent = state.view === 'completed' ? 'المهام المكتملة' : 'المهام الحالية';
  el('listEyebrow').textContent = state.view === 'completed' ? 'للرجوع عند الحاجة' : 'قائمة العمل';
  el('deleteCompletedButton').classList.toggle('hidden', state.view !== 'completed' || !completed.length);

  const list = sortedVisibleTasks();
  const container = el('tasksList');
  container.replaceChildren();

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<div class="empty-icon">${state.view === 'completed' ? '✓' : '📋'}</div>${state.view === 'completed' ? 'لا توجد مهام مكتملة بعد.' : 'لا توجد مهام هنا الآن.<br>اضغط زر الإضافة لإنشاء مهمة.'}`;
    container.append(empty);
    return;
  }

  list.forEach((task) => container.append(createTaskCard(task)));
}

function setView(view) {
  state.view = view === 'completed' ? 'completed' : 'active';
  state.openActionsId = null;
  render();
  closeMenu();
}

function openMenu() {
  el('menuScrim').hidden = false;
  requestAnimationFrame(() => el('sideMenu').classList.add('open'));
  el('sideMenu').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeMenu() {
  el('sideMenu').classList.remove('open');
  el('sideMenu').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setTimeout(() => { el('menuScrim').hidden = true; }, 280);
}

function resetTaskForm() {
  state.editingId = null;
  state.priority = 'normal';
  state.category = 'عام';
  el('taskSheetTitle').textContent = 'مهمة جديدة';
  el('taskTitleInput').value = '';
  el('taskNoteInput').value = '';
  el('taskDateInput').value = '';
  el('taskTimeInput').value = '';
  el('reminderInput').value = '0';
  el('repeatInput').value = 'none';
  syncChoiceButtons();
}

function syncChoiceButtons() {
  qsAll('#priorityChoices .choice').forEach((button) => button.classList.toggle('selected', button.dataset.value === state.priority));
  qsAll('#categoryChoices .choice').forEach((button) => button.classList.toggle('selected', button.dataset.value === state.category));
}

function openTaskSheet(taskId = null) {
  resetTaskForm();
  if (taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;
    state.editingId = task.id;
    state.priority = task.priority;
    state.category = task.category;
    el('taskSheetTitle').textContent = 'تعديل المهمة';
    el('taskTitleInput').value = task.title;
    el('taskNoteInput').value = task.note;
    const split = splitLocalInput(task.due);
    el('taskDateInput').value = split.date;
    el('taskTimeInput').value = split.time;
    el('reminderInput').value = String(task.remindBefore);
    el('repeatInput').value = task.repeat;
    syncChoiceButtons();
  }

  state.openActionsId = null;
  el('taskModalBackdrop').hidden = false;
  requestAnimationFrame(() => el('taskSheet').classList.add('open'));
  el('taskSheet').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => el('taskTitleInput').focus(), 250);
}

function closeTaskSheet() {
  el('taskSheet').classList.remove('open');
  el('taskSheet').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setTimeout(() => { el('taskModalBackdrop').hidden = true; }, 300);
}

function saveTaskFromForm(event) {
  event.preventDefault();
  const title = safeText(el('taskTitleInput').value, 160);
  if (!title) {
    toast('اكتب عنوان المهمة أولًا');
    el('taskTitleInput').focus();
    return;
  }

  const due = buildDueFromForm();
  if (due === null) return;
  const timestamp = nowIso();

  if (state.editingId) {
    const task = state.tasks.find((item) => item.id === state.editingId);
    if (!task) return;
    task.title = title;
    task.note = safeText(el('taskNoteInput').value, 1000);
    task.due = due;
    task.priority = state.priority;
    task.category = state.category;
    task.remindBefore = Number(el('reminderInput').value);
    task.repeat = el('repeatInput').value;
    task.updatedAt = timestamp;
    toast('تم تحديث المهمة');
  } else {
    state.tasks.push(normalizeTask({
      id: makeId(),
      title,
      note: el('taskNoteInput').value,
      due,
      priority: state.priority,
      category: state.category,
      remindBefore: Number(el('reminderInput').value),
      repeat: el('repeatInput').value,
      done: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    toast('تمت إضافة المهمة');
  }

  saveTasks();
  state.view = 'active';
  closeTaskSheet();
  render();
}

function addMonthsClamped(date, months) {
  const target = new Date(date);
  const originalDay = target.getDate();
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(originalDay, lastDay));
  return target;
}

function nextRepeatDue(value, repeat) {
  const date = new Date(value);
  if (repeat === 'daily') date.setDate(date.getDate() + 1);
  if (repeat === 'weekly') date.setDate(date.getDate() + 7);
  if (repeat === 'monthly') return toLocalInputValue(addMonthsClamped(date, 1));
  return toLocalInputValue(date);
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;

  if (task.done) {
    task.done = false;
    task.completedAt = null;
    task.updatedAt = nowIso();
    state.view = 'active';
    toast('تمت استعادة المهمة');
  } else if (task.repeat !== 'none' && task.due) {
    const timestamp = nowIso();
    const completedOccurrence = {
      ...task,
      id: makeId(),
      repeat: 'none',
      done: true,
      completedAt: timestamp,
      updatedAt: timestamp,
      occurrenceOf: task.seriesId || task.id,
      calendarExportedAt: null,
      calendarExportedDue: null
    };
    task.seriesId = task.seriesId || task.id;
    task.due = nextRepeatDue(task.due, task.repeat);
    task.updatedAt = timestamp;
    task.calendarExportedAt = null;
    task.calendarExportedDue = null;
    state.tasks.push(completedOccurrence);
    toast('تم الإنجاز ونقل الموعد إلى التكرار القادم');
  } else {
    task.done = true;
    task.completedAt = nowIso();
    task.updatedAt = task.completedAt;
    toast('تم إنجاز المهمة');
  }

  state.openActionsId = null;
  saveTasks();
  render();
}

function duplicateTask(id) {
  const source = state.tasks.find((item) => item.id === id);
  if (!source) return;
  const timestamp = nowIso();
  state.tasks.push({
    ...source,
    id: makeId(),
    title: `${source.title} (نسخة)`,
    done: false,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    calendarExportedAt: null,
    calendarExportedDue: null,
    occurrenceOf: null
  });
  state.openActionsId = null;
  saveTasks();
  render();
  toast('تم نسخ المهمة');
}

function deleteTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  if (!confirm(`حذف المهمة: ${task.title}؟`)) return;
  state.tasks = state.tasks.filter((item) => item.id !== id);
  state.openActionsId = null;
  saveTasks();
  render();
  toast('تم حذف المهمة');
}

function deleteCompleted() {
  const count = state.tasks.filter((task) => task.done).length;
  if (!count || !confirm(`حذف ${count} مهمة مكتملة نهائيًا؟`)) return;
  state.tasks = state.tasks.filter((task) => !task.done);
  saveTasks();
  render();
  toast('تم حذف المهام المكتملة');
}

function setQuickTime(minutes) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  date.setSeconds(0, 0);
  const value = toLocalInputValue(date);
  el('taskDateInput').value = value.slice(0, 10);
  el('taskTimeInput').value = value.slice(11, 16);
}

function setEightPm() {
  const date = new Date();
  date.setHours(20, 0, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  const value = toLocalInputValue(date);
  el('taskDateInput').value = value.slice(0, 10);
  el('taskTimeInput').value = value.slice(11, 16);
}

function icsEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function icsLocalDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function icsUtcDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function foldIcsLine(line) {
  const limit = 70;
  if (line.length <= limit) return line;
  const chunks = [];
  let remaining = line;
  while (remaining.length > limit) {
    chunks.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
  }
  chunks.push(remaining);
  return chunks.join('\r\n ');
}

function taskToIcsEvent(task) {
  const start = new Date(task.due);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const repeatRule = task.repeat === 'daily' ? 'RRULE:FREQ=DAILY'
    : task.repeat === 'weekly' ? 'RRULE:FREQ=WEEKLY'
      : task.repeat === 'monthly' ? 'RRULE:FREQ=MONTHLY' : null;
  const trigger = task.remindBefore === 1440 ? '-P1D' : task.remindBefore === 0 ? 'PT0M' : `-PT${task.remindBefore}M`;
  const descriptionParts = [task.note, `التصنيف: ${task.category}`, `الأولوية: ${priorityText(task.priority)}`].filter(Boolean);

  return [
    'BEGIN:VEVENT',
    `UID:${icsEscape(task.id)}@iphone-tasks.local`,
    `DTSTAMP:${icsUtcDate()}`,
    `DTSTART:${icsLocalDate(task.due)}`,
    `DTEND:${icsLocalDate(toLocalInputValue(end))}`,
    `SUMMARY:${icsEscape(task.title)}`,
    `DESCRIPTION:${icsEscape(descriptionParts.join('\n'))}`,
    repeatRule,
    'BEGIN:VALARM',
    `TRIGGER:${trigger}`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(task.title)}`,
    'END:VALARM',
    'END:VEVENT'
  ].filter(Boolean).map(foldIcsLine).join('\r\n');
}

function buildCalendar(tasks, name = 'مهامي') {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `PRODID:-//${icsEscape(name)}//iPhone Tasks Local//AR`,
    `X-WR-CALNAME:${icsEscape(name)}`,
    ...tasks.map(taskToIcsEvent),
    'END:VCALENDAR',
    ''
  ].join('\r\n');
}

async function shareOrDownloadFile(file, fallbackName) {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: fallbackName });
      return true;
    }
  } catch (error) {
    if (error?.name === 'AbortError') return false;
  }

  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fallbackName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}

async function exportTaskToCalendar(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task?.due) {
    toast('هذه المهمة لا تحتوي على موعد');
    return;
  }

  const file = new File([buildCalendar([task], task.title)], `task-${task.id}.ics`, { type: 'text/calendar;charset=utf-8' });
  const shared = await shareOrDownloadFile(file, `${task.title}.ics`);
  if (!shared) return;

  task.calendarExportedAt = nowIso();
  task.calendarExportedDue = task.due;
  saveTasks();
  render();
  toast('افتح الملف وأضفه إلى تقويم الآيفون');
}

async function exportAllToCalendar() {
  const tasks = state.tasks.filter((task) => !task.done && task.due);
  if (!tasks.length) {
    toast('لا توجد مهام حالية بموعد');
    closeMenu();
    return;
  }

  const file = new File([buildCalendar(tasks, 'مهامي اليومية')], 'iphone-tasks-calendar.ics', { type: 'text/calendar;charset=utf-8' });
  const shared = await shareOrDownloadFile(file, 'iphone-tasks-calendar.ics');
  if (!shared) return;

  const timestamp = nowIso();
  tasks.forEach((task) => {
    task.calendarExportedAt = timestamp;
    task.calendarExportedDue = task.due;
  });
  saveTasks();
  render();
  closeMenu();
  toast('تم تجهيز جميع المواعيد للتقويم');
}

async function exportBackup() {
  const payload = {
    format: 'iphone-tasks-backup',
    version: 14,
    exportedAt: nowIso(),
    tasks: state.tasks
  };
  const file = new File([JSON.stringify(payload, null, 2)], `iphone-tasks-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  await shareOrDownloadFile(file, file.name);
  closeMenu();
  toast('تم تجهيز النسخة الاحتياطية');
}

function restoreBackupFile(file) {
  if (!file || file.size > 8 * 1024 * 1024) {
    toast('حجم الملف غير مناسب');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const source = Array.isArray(parsed) ? parsed : parsed?.tasks;
      if (!Array.isArray(source) || source.length > MAX_IMPORT_TASKS) throw new Error('invalid');
      const imported = source.map((item) => normalizeTask(item, { regenerateId: true })).filter(Boolean);
      if (!imported.length && source.length) throw new Error('invalid');

      const replace = confirm(`تم العثور على ${imported.length} مهمة.\n\nموافق: استبدال البيانات الحالية\nإلغاء: دمجها مع الموجود`);
      state.tasks = replace ? imported : [...state.tasks, ...imported];
      saveTasks();
      render();
      toast(replace ? 'تمت استعادة النسخة' : 'تم دمج النسخة مع المهام الحالية');
    } catch (error) {
      toast('ملف النسخة الاحتياطية غير صالح');
    } finally {
      el('restoreFileInput').value = '';
    }
  };
  reader.onerror = () => toast('تعذر قراءة الملف');
  reader.readAsText(file);
}

function openInfoDialog(title, html) {
  el('infoDialogTitle').textContent = title;
  el('infoDialogBody').innerHTML = html;
  el('infoModalBackdrop').hidden = false;
  requestAnimationFrame(() => el('infoDialog').classList.add('open'));
  el('infoDialog').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeInfoDialog() {
  el('infoDialog').classList.remove('open');
  el('infoDialog').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setTimeout(() => { el('infoModalBackdrop').hidden = true; }, 220);
}

function showInstallHelp() {
  closeMenu();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) {
    openInfoDialog('التطبيق مثبت', '<p><strong>التطبيق يعمل الآن من الشاشة الرئيسية.</strong></p><p>يمكنك استخدامه دون إنترنت، وتصدير مواعيد المهام إلى تقويم الآيفون.</p>');
    return;
  }

  if (state.deferredInstallPrompt) {
    openInfoDialog('تثبيت التطبيق', '<div class="dialog-actions"><button id="nativeInstallButton" type="button">تثبيت الآن</button></div><p>بعد التثبيت سيعمل التطبيق في نافذة مستقلة.</p>');
    setTimeout(() => {
      el('nativeInstallButton')?.addEventListener('click', async () => {
        await state.deferredInstallPrompt.prompt();
        state.deferredInstallPrompt = null;
        closeInfoDialog();
      });
    });
    return;
  }

  openInfoDialog('تثبيت على الآيفون', `
    <ol>
      <li>افتح الصفحة في <strong>Safari</strong>.</li>
      <li>اضغط زر المشاركة <strong>□↑</strong>.</li>
      <li>اختر <strong>إضافة إلى الشاشة الرئيسية</strong>.</li>
      <li>اضغط <strong>إضافة</strong>.</li>
    </ol>
    <p>بعد ذلك افتح التطبيق من الأيقونة الجديدة.</p>
  `);
}

function wireEvents() {
  el('menuButton').addEventListener('click', openMenu);
  el('closeMenuButton').addEventListener('click', closeMenu);
  el('menuScrim').addEventListener('click', closeMenu);
  el('addTaskButton').addEventListener('click', () => openTaskSheet());
  el('closeTaskSheetButton').addEventListener('click', closeTaskSheet);
  el('taskModalBackdrop').addEventListener('click', closeTaskSheet);
  el('taskForm').addEventListener('submit', saveTaskFromForm);
  el('closeInfoDialogButton').addEventListener('click', closeInfoDialog);
  el('infoModalBackdrop').addEventListener('click', closeInfoDialog);
  el('deleteCompletedButton').addEventListener('click', deleteCompleted);

  qsAll('.view-tab').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  el('searchInput').addEventListener('input', (event) => {
    state.search = event.target.value.trim();
    render();
  });
  el('filterSelect').addEventListener('change', (event) => {
    state.filter = event.target.value;
    render();
  });

  qsAll('#priorityChoices .choice').forEach((button) => button.addEventListener('click', () => {
    state.priority = button.dataset.value;
    syncChoiceButtons();
  }));
  qsAll('#categoryChoices .choice').forEach((button) => button.addEventListener('click', () => {
    state.category = button.dataset.value;
    syncChoiceButtons();
  }));
  qsAll('[data-quick-minutes]').forEach((button) => button.addEventListener('click', () => setQuickTime(Number(button.dataset.quickMinutes))));
  el('quickEightButton').addEventListener('click', setEightPm);

  qsAll('[data-menu-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.menuAction;
    if (action === 'add') { closeMenu(); setTimeout(() => openTaskSheet(), 180); }
    if (action === 'active') setView('active');
    if (action === 'completed') setView('completed');
    if (action === 'calendar') exportAllToCalendar();
    if (action === 'backup') exportBackup();
    if (action === 'restore') { closeMenu(); el('restoreFileInput').click(); }
    if (action === 'install') showInstallHelp();
  }));

  el('restoreFileInput').addEventListener('change', (event) => restoreBackupFile(event.target.files?.[0]));
  el('applyUpdateButton').addEventListener('click', () => {
    if (state.waitingWorker) state.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (el('taskSheet').classList.contains('open')) closeTaskSheet();
    else if (el('infoDialog').classList.contains('open')) closeInfoDialog();
    else if (el('sideMenu').classList.contains('open')) closeMenu();
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });

    if (registration.waiting) {
      state.waitingWorker = registration.waiting;
      el('updateBanner').hidden = false;
    }

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          state.waitingWorker = registration.waiting;
          el('updateBanner').hidden = false;
        }
      });
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  } catch (error) {
    console.error('Service worker registration failed', error);
  }
}

function initializeHeader() {
  const now = new Date();
  el('todayText').textContent = now.toLocaleDateString('ar-JO', { weekday: 'long', day: 'numeric', month: 'long' });
  const hour = now.getHours();
  el('greetTitle').textContent = hour < 12 ? 'صباح الخير 👋' : hour < 18 ? 'أهلًا بك 👋' : 'مساء الخير 👋';
}

function init() {
  state.tasks = loadTasks();
  saveTasks();
  initializeHeader();
  wireEvents();
  render();
  registerServiceWorker();
}

init();
