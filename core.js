'use strict';

export const SCHEMA_VERSION = 15;
export const VALID_PRIORITIES = new Set(['high', 'medium', 'normal']);
export const VALID_REPEATS = new Set(['none', 'daily', 'weekly', 'monthly']);
export const VALID_REMINDERS = new Set([0, 5, 15, 30, 60, 1440]);

export function nowIso() {
  return new Date().toISOString();
}

export function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function safeText(value, maxLength = 1000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function pad(value) {
  return String(value).padStart(2, '0');
}

export function parseLocalDateTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yRaw, mRaw, dRaw, hRaw, minRaw] = match;
  const year = Number(yRaw);
  const month = Number(mRaw);
  const day = Number(dRaw);
  const hour = Number(hRaw);
  const minute = Number(minRaw);
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const date = new Date(2000, 0, 1, hour, minute, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
  ) return null;

  return date;
}

export function isValidLocalDateTime(value) {
  return value === '' || Boolean(parseLocalDateTime(value));
}

export function toLocalInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function validIsoOrFallback(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

export function normalizeTask(raw, { regenerateId = false, timestamp = nowIso() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const title = safeText(raw.title, 160);
  if (!title) return null;

  const rawDue = safeText(raw.due, 16);
  const due = isValidLocalDateTime(rawDue) ? rawDue : '';
  const mappedPriority = raw.priority === 'med' ? 'medium' : raw.priority === 'low' ? 'normal' : raw.priority;
  const priority = VALID_PRIORITIES.has(mappedPriority) ? mappedPriority : 'normal';
  const repeat = VALID_REPEATS.has(raw.repeat) ? raw.repeat : 'none';
  const reminderNumber = Number(raw.remindBefore ?? raw.notifyBefore ?? 0);
  const remindBefore = VALID_REMINDERS.has(reminderNumber) ? reminderNumber : 0;
  const done = Boolean(raw.done);
  const dueDate = due ? parseLocalDateTime(due) : null;
  const rawAnchor = Number(raw.repeatAnchorDay);
  const repeatAnchorDay = Number.isInteger(rawAnchor) && rawAnchor >= 1 && rawAnchor <= 31
    ? rawAnchor
    : dueDate?.getDate() ?? null;

  return {
    id: regenerateId ? makeId() : safeText(raw.id, 120) || makeId(),
    title,
    note: safeText(raw.note, 1000),
    due,
    priority,
    category: safeText(raw.category, 40) || 'عام',
    remindBefore,
    repeat,
    repeatAnchorDay,
    done,
    completedAt: done ? validIsoOrFallback(raw.completedAt, timestamp) : null,
    createdAt: validIsoOrFallback(raw.createdAt, timestamp),
    updatedAt: validIsoOrFallback(raw.updatedAt, timestamp),
    calendarFileAt: validIsoOrFallback(raw.calendarFileAt ?? raw.calendarExportedAt, null),
    calendarFingerprint: safeText(raw.calendarFingerprint, 300),
    seriesId: safeText(raw.seriesId, 120) || null,
    occurrenceOf: safeText(raw.occurrenceOf, 120) || null,
    lastNotifiedKey: safeText(raw.lastNotifiedKey, 300)
  };
}

export function addMonthsAnchored(date, months, anchorDay = date.getDate()) {
  const target = new Date(date);
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(anchorDay, lastDay));
  return target;
}

export function nextRepeatDue(value, repeat, anchorDay = null) {
  const date = parseLocalDateTime(value);
  if (!date || repeat === 'none') return value || '';
  if (repeat === 'daily') date.setDate(date.getDate() + 1);
  if (repeat === 'weekly') date.setDate(date.getDate() + 7);
  if (repeat === 'monthly') return toLocalInputValue(addMonthsAnchored(date, 1, anchorDay || date.getDate()));
  return toLocalInputValue(date);
}

export function advanceRepeatToFuture(value, repeat, anchorDay, reference = new Date()) {
  let next = nextRepeatDue(value, repeat, anchorDay);
  let parsed = parseLocalDateTime(next);
  let guard = 0;
  while (parsed && parsed.getTime() <= reference.getTime() && guard < 5000) {
    next = nextRepeatDue(next, repeat, anchorDay);
    parsed = parseLocalDateTime(next);
    guard += 1;
  }
  return next;
}

export function priorityText(priority) {
  return priority === 'high' ? 'عالية' : priority === 'medium' ? 'متوسطة' : 'عادية';
}

export function repeatText(repeat) {
  return repeat === 'daily' ? 'يومي' : repeat === 'weekly' ? 'أسبوعي' : repeat === 'monthly' ? 'شهري' : '';
}

export function reminderText(minutes) {
  if (minutes === 0) return 'وقت الموعد';
  if (minutes === 60) return 'قبل ساعة';
  if (minutes === 1440) return 'قبل يوم';
  return `قبل ${minutes} دقيقة`;
}

export function taskFingerprint(task) {
  const value = JSON.stringify([
    task.title,
    task.note,
    task.due,
    task.remindBefore,
    task.repeat,
    task.repeatAnchorDay,
    task.category,
    task.priority
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function reminderDate(task) {
  const due = parseLocalDateTime(task.due);
  if (!due) return null;
  return new Date(due.getTime() - Number(task.remindBefore || 0) * 60_000);
}

function icsEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function icsUtcDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function icsLocalDate(value) {
  const date = value instanceof Date ? value : parseLocalDateTime(value);
  if (!date) return '';
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

export function foldIcsLine(line, maxOctets = 75) {
  const encoder = new TextEncoder();
  const output = [];
  let current = '';
  let bytes = 0;

  for (const char of String(line)) {
    const charBytes = encoder.encode(char).length;
    if (bytes + charBytes > maxOctets && current) {
      output.push(current);
      current = ` ${char}`;
      bytes = 1 + charBytes;
    } else {
      current += char;
      bytes += charBytes;
    }
  }
  if (current || !output.length) output.push(current);
  return output.join('\r\n');
}

function alarmTrigger(minutes) {
  if (minutes === 1440) return '-P1D';
  if (minutes === 0) return 'PT0M';
  return `-PT${minutes}M`;
}

function monthlyRDates(task, count = 60) {
  if (task.repeat !== 'monthly' || Number(task.repeatAnchorDay || 0) <= 28) return null;
  const dates = [];
  let value = task.due;
  for (let index = 1; index < count; index += 1) {
    value = nextRepeatDue(value, 'monthly', task.repeatAnchorDay);
    if (!value) break;
    dates.push(icsLocalDate(value));
  }
  return dates.length ? `RDATE:${dates.join(',')}` : null;
}

function taskToIcsLines(task) {
  const stamp = new Date();
  const repeatRule = task.repeat === 'daily'
    ? 'RRULE:FREQ=DAILY'
    : task.repeat === 'weekly'
      ? 'RRULE:FREQ=WEEKLY'
      : task.repeat === 'monthly' && Number(task.repeatAnchorDay || 0) <= 28
        ? 'RRULE:FREQ=MONTHLY'
        : null;
  const rDates = monthlyRDates(task);
  const description = [
    task.note,
    `التصنيف: ${task.category}`,
    `الأولوية: ${priorityText(task.priority)}`
  ].filter(Boolean).join('\n');
  const sequence = Math.max(0, Math.floor(new Date(task.updatedAt || stamp).getTime() / 1000));

  return [
    'BEGIN:VEVENT',
    `UID:${icsEscape(task.id)}@iphone-tasks.local`,
    `DTSTAMP:${icsUtcDate(stamp)}`,
    `CREATED:${icsUtcDate(task.createdAt || stamp)}`,
    `LAST-MODIFIED:${icsUtcDate(task.updatedAt || stamp)}`,
    `SEQUENCE:${sequence}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    `DTSTART:${icsLocalDate(task.due)}`,
    'DURATION:PT30M',
    `SUMMARY:${icsEscape(task.title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `CATEGORIES:${icsEscape(task.category)}`,
    repeatRule,
    rDates,
    'BEGIN:VALARM',
    `TRIGGER;VALUE=DURATION;RELATED=START:${alarmTrigger(Number(task.remindBefore || 0))}`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(task.title)}`,
    'X-APPLE-DEFAULT-ALARM:TRUE',
    'END:VALARM',
    'END:VEVENT'
  ].filter(Boolean).map((line) => foldIcsLine(line));
}

export function buildCalendar(tasks, name = 'مهامي', { timeZone } = {}) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'PRODID:-//iPhone Tasks Local//AR',
    `X-WR-CALNAME:${icsEscape(name)}`,
    `X-WR-TIMEZONE:${icsEscape(zone)}`,
    'X-PUBLISHED-TTL:PT1H',
    ...tasks.flatMap(taskToIcsLines),
    'END:VCALENDAR',
    ''
  ].join('\r\n');
}
