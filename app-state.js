'use strict';

import {
  VALID_PRIORITIES,
  VALID_REPEATS,
  VALID_REMINDERS,
  isValidLocalDateTime,
  makeId,
  normalizeTask,
  nowIso,
  parseLocalDateTime,
  priorityText,
  reminderDate,
  reminderText,
  repeatText,
  safeText,
  taskFingerprint
} from './core.js';

export {
  VALID_PRIORITIES,
  VALID_REPEATS,
  VALID_REMINDERS,
  isValidLocalDateTime,
  makeId,
  normalizeTask,
  nowIso,
  parseLocalDateTime,
  priorityText,
  reminderDate,
  reminderText,
  repeatText,
  safeText,
  taskFingerprint
};

export const STORAGE_KEY = 'iphone_tasks_local_v15';
export const LEGACY_STORAGE_KEYS = ['iphone_tasks_local_v14', 'iphone_tasks_pwa_pro_v3'];
export const SETTINGS_KEY = 'iphone_tasks_settings_v15';
export const RECOVERY_KEY = 'iphone_tasks_recovery_v15';
export const CALENDAR_EXPORT_CACHE = 'iphone-tasks-calendar-exports-v3';
export const CALENDAR_RETURN_FLAG = 'iphone_tasks_calendar_return_help_v15';
export const MAX_IMPORT_TASKS = 10_000;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TIMER_DELAY = 24 * 60 * 60 * 1000;

export const state = {
  tasks: [],
  settings: { localNotifications: false },
  view: 'active',
  filter: 'all',
  search: '',
  editingId: null,
  priority: 'normal',
  category: 'عام',
  openActionsId: null,
  deferredInstallPrompt: null,
  reminderTimers: new Map(),
  reminderInterval: null,
  lastFocusedElement: null
};

export const el = (id) => document.getElementById(id);
export const qsAll = (selector) => Array.from(document.querySelectorAll(selector));

export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function toast(message, duration = 2600) {
  const node = el('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), duration);
}

export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    console.warn(`Failed to read ${key}`, error);
    return fallback;
  }
}

export function loadSettings() {
  const parsed = readJson(SETTINGS_KEY, {});
  return { localNotifications: Boolean(parsed?.localNotifications) };
}

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch (error) {
    console.warn('Failed to save settings', error);
  }
}

export function sourceTaskArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks)) return parsed.tasks;
  return null;
}

export function normalizeTaskList(source, { regenerateIds = false } = {}) {
  const seen = new Set();
  return source
    .slice(0, MAX_IMPORT_TASKS)
    .map((item) => normalizeTask(item, { regenerateId: regenerateIds }))
    .filter(Boolean)
    .map((task) => {
      if (seen.has(task.id)) task.id = makeId();
      seen.add(task.id);
      return task;
    });
}

export function loadTasks() {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const source = sourceTaskArray(JSON.parse(raw));
      if (source) return normalizeTaskList(source);
    } catch (error) {
      try {
        localStorage.setItem(`${STORAGE_KEY}_corrupt_${Date.now()}`, raw.slice(0, 500_000));
      } catch (_) {
        // Ignore a secondary storage failure.
      }
    }
  }
  return [];
}

export function saveTasks({ silent = false } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    window.dispatchEvent(new CustomEvent('tasks-saved'));
    return true;
  } catch (error) {
    console.error('Failed to save tasks', error);
    if (!silent) toast('تعذر حفظ البيانات. تحقق من مساحة Safari المتاحة.', 4200);
    return false;
  }
}

export function splitLocalInput(value) {
  if (!value) return { date: '', time: '' };
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}

export function isSameLocalDay(value, reference = new Date()) {
  const date = typeof value === 'string' && value.length === 16
    ? parseLocalDateTime(value)
    : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate();
}

export function formatDue(value) {
  const date = parseLocalDateTime(value);
  if (!date) return 'دون موعد';
  return date.toLocaleString('ar-JO', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

export function dueState(task, reference = new Date()) {
  const due = parseLocalDateTime(task.due);
  if (!due || task.done) return 'normal';
  if (due.getTime() < reference.getTime()) return 'overdue';
  if (isSameLocalDay(task.due, reference)) return 'today';
  return 'future';
}

export function calendarStatus(task) {
  if (!task.due) return null;
  if (!task.calendarFileAt) return 'none';
  return task.calendarFingerprint === taskFingerprint(task) ? 'ready' : 'stale';
}

export function taskMatchesFilter(task) {
  const query = state.search.toLocaleLowerCase('ar');
  if (query) {
    const haystack = `${task.title} ${task.note} ${task.category}`.toLocaleLowerCase('ar');
    if (!haystack.includes(query)) return false;
  }
  if (state.filter === 'today') return isSameLocalDay(task.due);
  if (state.filter === 'overdue') return dueState(task) === 'overdue';
  if (state.filter === 'high') return task.priority === 'high';
  if (state.filter === 'scheduled') return Boolean(task.due);
  if (state.filter === 'unscheduled') return !task.due;
  return true;
}

function priorityRank(priority) {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
}

export function sortedVisibleTasks() {
  return state.tasks
    .filter((task) => state.view === 'completed' ? task.done : !task.done)
    .filter(taskMatchesFilter)
    .sort((a, b) => {
      if (state.view === 'completed') {
        return String(b.completedAt || '').localeCompare(String(a.completedAt || ''));
      }
      return (a.due || '9999').localeCompare(b.due || '9999')
        || priorityRank(a.priority) - priorityRank(b.priority)
        || b.createdAt.localeCompare(a.createdAt);
    });
}
