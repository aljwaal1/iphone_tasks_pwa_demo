'use strict';

import {
  CALENDAR_RETURN_FLAG,
  STORAGE_KEY,
  el,
  loadSettings,
  loadTasks,
  qsAll,
  saveTasks,
  state
} from './app-state.js';
import {
  closeInfoDialog,
  closeMenu,
  closeTaskSheet,
  deleteCompleted,
  openMenu,
  openTaskSheet,
  render,
  saveTaskFromForm,
  setEightPm,
  setQuickTime,
  setView,
  syncChoiceButtons
} from './app-ui.js';
import {
  checkDueReminders,
  exportAllToCalendar,
  exportBackup,
  installServiceEventHandlers,
  registerServiceWorker,
  restoreBackupFile,
  restoreRecoverySnapshot,
  scheduleReminders,
  showCalendarHelp,
  showInstallHelp,
  showNotificationCenter,
  updateConnectionBadge
} from './app-services.js';

function initializeHeader() {
  const now = new Date();
  el('todayText').textContent = now.toLocaleDateString('ar-JO', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
  const hour = now.getHours();
  el('greetTitle').textContent = hour < 12 ? 'صباح الخير 👋' : hour < 18 ? 'أهلًا بك 👋' : 'مساء الخير 👋';
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
    if (action === 'add') { closeMenu({ restore: false }); setTimeout(() => openTaskSheet(), 180); }
    if (action === 'active') setView('active');
    if (action === 'completed') setView('completed');
    if (action === 'calendar') exportAllToCalendar(button);
    if (action === 'notifications') showNotificationCenter();
    if (action === 'backup') exportBackup();
    if (action === 'restore') { closeMenu({ restore: false }); el('restoreFileInput').click(); }
    if (action === 'recovery') restoreRecoverySnapshot();
    if (action === 'install') showInstallHelp();
  }));

  el('restoreFileInput').addEventListener('change', (event) => restoreBackupFile(event.target.files?.[0]));
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      initializeHeader();
      render();
      scheduleReminders();
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (el('taskSheet').classList.contains('open')) closeTaskSheet();
    else if (el('infoDialog').classList.contains('open')) closeInfoDialog();
    else if (el('sideMenu').classList.contains('open')) closeMenu();
  });
}

async function init() {
  state.tasks = loadTasks();
  state.settings = loadSettings();
  saveTasks({ silent: true });
  initializeHeader();
  updateConnectionBadge();
  installServiceEventHandlers();
  wireEvents();
  render();
  await registerServiceWorker();
  scheduleReminders();
  state.reminderInterval = setInterval(checkDueReminders, 60_000);

  const url = new URL(location.href);
  if (url.searchParams.get('action') === 'add') {
    url.searchParams.delete('action');
    history.replaceState(null, '', url);
    setTimeout(() => openTaskSheet(), 250);
  }
  if (sessionStorage.getItem(CALENDAR_RETURN_FLAG) === '1') {
    sessionStorage.removeItem(CALENDAR_RETURN_FLAG);
    setTimeout(showCalendarHelp, 500);
  }
}

init();
