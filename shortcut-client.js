'use strict';

import { closeMenu } from './app-ui.js';
import { parseLocalDateTime, state, toast } from './app-state.js';

export const SHORTCUT_NAME = 'مهامي – إضافة تذكير';
export const SHORTCUT_INSTALL_URL = 'https://www.icloud.com/shortcuts/50e2b912b94b489687f74f6edac28b3e';

function reminderMoment(task) {
  const due = parseLocalDateTime(task?.due);
  if (!due) return null;
  const minutes = Number(task.remindBefore || 0);
  return new Date(due.getTime() - minutes * 60_000);
}

function shortcutPayload(task) {
  const alertAt = reminderMoment(task);
  if (!alertAt) return null;
  return {
    title: String(task.title || 'مهمة').slice(0, 160),
    note: String(task.note || '').slice(0, 1000),
    due: alertAt.toISOString()
  };
}

function shortcutRunUrl(mode = 'clipboard', text = '') {
  const name = encodeURIComponent(SHORTCUT_NAME);
  if (mode === 'text') {
    return `shortcuts://run-shortcut?name=${name}&input=text&text=${encodeURIComponent(text)}`;
  }
  return `shortcuts://run-shortcut?name=${name}&input=clipboard`;
}

export function installReminderShortcut() {
  closeMenu({ restore: false });
  location.href = SHORTCUT_INSTALL_URL;
}

export async function runReminderShortcut(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    toast('تعذر العثور على المهمة');
    return;
  }
  const payload = shortcutPayload(task);
  if (!payload) {
    toast('أضف تاريخًا ووقتًا للمهمة أولًا');
    return;
  }

  const text = JSON.stringify(payload);
  toast('جاري فتح اختصار التذكيرات…');
  try {
    await navigator.clipboard.writeText(text);
    location.href = shortcutRunUrl('clipboard');
  } catch (error) {
    console.warn('Clipboard handoff failed, using URL text input', error);
    location.href = shortcutRunUrl('text', text);
  }
}

function addShortcutButton(card) {
  const actions = card.querySelector('.task-actions');
  if (!actions || actions.querySelector('[data-shortcut-reminder]')) return;
  const task = state.tasks.find((item) => item.id === card.dataset.id);
  if (!task || task.done || !task.due) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'task-action shortcut-action';
  button.dataset.shortcutReminder = task.id;
  button.textContent = 'تنبيه في الآيفون';
  button.addEventListener('click', () => runReminderShortcut(task.id));
  actions.prepend(button);
}

export function enhanceShortcutButtons() {
  document.querySelectorAll('.task-card').forEach(addShortcutButton);
}

export function initializeShortcutIntegration() {
  const list = document.getElementById('tasksList');
  if (!list) return;
  enhanceShortcutButtons();
  const observer = new MutationObserver(enhanceShortcutButtons);
  observer.observe(list, { childList: true, subtree: true });
}
