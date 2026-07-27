'use strict';

import {
  calendarStatus,
  dueState,
  el,
  formatDue,
  isSameLocalDay,
  isValidLocalDateTime,
  makeId,
  normalizeTask,
  nowIso,
  parseLocalDateTime,
  priorityText,
  qsAll,
  reminderText,
  repeatText,
  safeText,
  saveTasks,
  sortedVisibleTasks,
  splitLocalInput,
  state,
  toast
} from './app-state.js';
import { advanceRepeatToFuture, toLocalInputValue } from './core.js';

function createPill(text, className = '') {
  const span = document.createElement('span');
  span.className = `pill ${className}`.trim();
  span.textContent = text;
  return span;
}

function actionButton(label, handler, className = '') {
  const button = document.createElement('button');
  button.className = `task-action ${className}`.trim();
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function createTaskCard(task) {
  const status = dueState(task);
  const calStatus = calendarStatus(task);
  const card = document.createElement('article');
  card.className = `task-card${task.done ? ' completed' : ''}`;
  card.dataset.id = task.id;
  card.dataset.priority = task.priority;
  card.dataset.dueState = status;

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
  meta.append(createPill(formatDue(task.due), status === 'overdue' ? 'overdue' : status === 'today' ? 'today' : ''));
  meta.append(createPill(`أولوية ${priorityText(task.priority)}`));
  meta.append(createPill(task.category));
  if (task.due) meta.append(createPill(`⏱ ${reminderText(task.remindBefore)}`));
  if (task.repeat !== 'none') meta.append(createPill(`↻ ${repeatText(task.repeat)}`));
  if (calStatus === 'ready') meta.append(createPill('▣ ملف تقويم جاهز', 'calendar'));
  if (calStatus === 'stale') meta.append(createPill('▣ أنشئ ملفًا محدثًا', 'warning'));
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
      if (task.due) {
        actions.append(actionButton(
          calStatus === 'ready' ? 'إنشاء ملف تقويم جديد' : 'إنشاء ملف التقويم',
          (event) => window.dispatchEvent(new CustomEvent('calendar-task-request', {
            detail: { id: task.id, button: event.currentTarget }
          })),
          'calendar-action'
        ));
      }
    } else {
      actions.append(actionButton('استعادة', () => toggleTask(task.id)));
    }
    actions.append(actionButton('حذف', () => deleteTask(task.id), 'danger'));
    card.append(actions);
  }
  return card;
}

function renderSummary() {
  const now = new Date();
  const active = state.tasks.filter((task) => !task.done);
  const completed = state.tasks.filter((task) => task.done);
  const dueToday = active.filter((task) => isSameLocalDay(task.due, now));
  const doneToday = completed.filter((task) => isSameLocalDay(task.completedAt, now));
  const overdue = active.filter((task) => dueState(task, now) === 'overdue');
  const totalToday = dueToday.length + doneToday.length;
  const percent = totalToday ? Math.round((doneToday.length / totalToday) * 100) : 0;
  const circumference = 2 * Math.PI * 35;
  const ring = el('ringProgress');
  ring.setAttribute('stroke-dasharray', String(circumference));
  ring.setAttribute('stroke-dashoffset', String(circumference - circumference * percent / 100));
  el('ringPercent').textContent = `${percent}%`;
  el('summaryLabel').textContent = totalToday
    ? `أنجزت ${doneToday.length} من ${totalToday} اليوم`
    : 'لا توجد مهام مستحقة اليوم';
  el('todayCount').textContent = String(totalToday);
  el('overdueCount').textContent = String(overdue.length);
  el('openCount').textContent = String(active.length);
  el('doneCount').textContent = String(completed.length);
  el('activeBadge').textContent = String(active.length);
  el('completedBadge').textContent = String(completed.length);
  el('menuActiveCount').textContent = String(active.length);
  el('menuCompletedCount').textContent = String(completed.length);
}

export function render() {
  renderSummary();
  const completed = state.tasks.filter((task) => task.done);
  qsAll('.view-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  el('listTitle').textContent = state.view === 'completed' ? 'المهام المكتملة' : 'المهام الحالية';
  el('listEyebrow').textContent = state.view === 'completed' ? 'للرجوع عند الحاجة' : 'قائمة العمل';
  el('deleteCompletedButton').classList.toggle('hidden', state.view !== 'completed' || !completed.length);

  const container = el('tasksList');
  container.replaceChildren();
  const list = sortedVisibleTasks();
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('div');
    icon.className = 'empty-icon';
    icon.textContent = state.view === 'completed' ? '✓' : '📋';
    const text = document.createElement('p');
    text.textContent = state.view === 'completed'
      ? 'لا توجد مهام مكتملة بعد.'
      : 'لا توجد مهام هنا الآن. اضغط زر الإضافة لإنشاء مهمة.';
    empty.append(icon, text);
    container.append(empty);
    return;
  }
  list.forEach((task) => container.append(createTaskCard(task)));
}

function rememberFocus() {
  state.lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function restoreFocus() {
  state.lastFocusedElement?.focus?.();
  state.lastFocusedElement = null;
}

export function setView(view) {
  state.view = view === 'completed' ? 'completed' : 'active';
  state.openActionsId = null;
  render();
  closeMenu();
}

export function openMenu() {
  rememberFocus();
  el('menuScrim').hidden = false;
  requestAnimationFrame(() => el('sideMenu').classList.add('open'));
  el('sideMenu').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

export function closeMenu({ restore = true } = {}) {
  el('sideMenu').classList.remove('open');
  el('sideMenu').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setTimeout(() => {
    el('menuScrim').hidden = true;
    if (restore) restoreFocus();
  }, 280);
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

export function syncChoiceButtons() {
  qsAll('#priorityChoices .choice').forEach((button) => button.classList.toggle('selected', button.dataset.value === state.priority));
  qsAll('#categoryChoices .choice').forEach((button) => button.classList.toggle('selected', button.dataset.value === state.category));
}

export function openTaskSheet(taskId = null) {
  rememberFocus();
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

export function closeTaskSheet() {
  el('taskSheet').classList.remove('open');
  el('taskSheet').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setTimeout(() => {
    el('taskModalBackdrop').hidden = true;
    restoreFocus();
  }, 300);
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

export function saveTaskFromForm(event) {
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
  const note = safeText(el('taskNoteInput').value, 1000);
  const remindBefore = Number(el('reminderInput').value);
  const repeat = el('repeatInput').value;

  if (state.editingId) {
    const task = state.tasks.find((item) => item.id === state.editingId);
    if (!task) return;
    const oldDue = task.due;
    task.title = title;
    task.note = note;
    task.due = due;
    task.priority = state.priority;
    task.category = state.category;
    task.remindBefore = remindBefore;
    task.repeat = repeat;
    if (due && (oldDue !== due || !task.repeatAnchorDay)) task.repeatAnchorDay = parseLocalDateTime(due)?.getDate() || null;
    if (!due) task.repeatAnchorDay = null;
    task.updatedAt = timestamp;
    task.lastNotifiedKey = '';
    toast('تم تحديث المهمة');
  } else {
    state.tasks.push(normalizeTask({
      id: makeId(), title, note, due, priority: state.priority, category: state.category,
      remindBefore, repeat, done: false, createdAt: timestamp, updatedAt: timestamp
    }));
    toast('تمت إضافة المهمة');
  }
  saveTasks();
  state.view = 'active';
  closeTaskSheet();
  render();
}

export function toggleTask(id) {
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
    state.tasks.push({
      ...task,
      id: makeId(),
      repeat: 'none',
      done: true,
      completedAt: timestamp,
      updatedAt: timestamp,
      occurrenceOf: task.seriesId || task.id,
      calendarFileAt: null,
      calendarFingerprint: '',
      lastNotifiedKey: ''
    });
    task.seriesId ||= task.id;
    task.due = advanceRepeatToFuture(task.due, task.repeat, task.repeatAnchorDay, new Date());
    task.updatedAt = timestamp;
    task.calendarFileAt = null;
    task.calendarFingerprint = '';
    task.lastNotifiedKey = '';
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

export function duplicateTask(id) {
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
    calendarFileAt: null,
    calendarFingerprint: '',
    seriesId: null,
    occurrenceOf: null,
    lastNotifiedKey: ''
  });
  state.openActionsId = null;
  saveTasks();
  render();
  toast('تم نسخ المهمة');
}

export function deleteTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || !confirm(`حذف المهمة: ${task.title}؟`)) return;
  state.tasks = state.tasks.filter((item) => item.id !== id);
  state.openActionsId = null;
  saveTasks();
  render();
  toast('تم حذف المهمة');
}

export function deleteCompleted() {
  const count = state.tasks.filter((task) => task.done).length;
  if (!count || !confirm(`حذف ${count} مهمة مكتملة نهائيًا؟`)) return;
  state.tasks = state.tasks.filter((task) => !task.done);
  saveTasks();
  render();
  toast('تم حذف المهام المكتملة');
}

export function setQuickTime(minutes) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes, 0, 0);
  const value = toLocalInputValue(date);
  el('taskDateInput').value = value.slice(0, 10);
  el('taskTimeInput').value = value.slice(11, 16);
}

export function setEightPm() {
  const date = new Date();
  date.setHours(20, 0, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  const value = toLocalInputValue(date);
  el('taskDateInput').value = value.slice(0, 10);
  el('taskTimeInput').value = value.slice(11, 16);
}

export function openInfoDialog(title, html, setup) {
  rememberFocus();
  el('infoDialogTitle').textContent = title;
  el('infoDialogBody').innerHTML = html;
  el('infoModalBackdrop').hidden = false;
  requestAnimationFrame(() => el('infoDialog').classList.add('open'));
  el('infoDialog').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setup?.();
  setTimeout(() => el('closeInfoDialogButton').focus(), 80);
}

export function closeInfoDialog() {
  el('infoDialog').classList.remove('open');
  el('infoDialog').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setTimeout(() => {
    el('infoModalBackdrop').hidden = true;
    restoreFocus();
  }, 220);
}
