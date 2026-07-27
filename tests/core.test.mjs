import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceRepeatToFuture,
  buildCalendar,
  foldIcsLine,
  isValidLocalDateTime,
  nextRepeatDue,
  normalizeTask,
  parseLocalDateTime,
  taskFingerprint
} from '../core.js';

test('strict date validation rejects normalized impossible dates', () => {
  assert.equal(isValidLocalDateTime('2026-02-31T10:00'), false);
  assert.equal(isValidLocalDateTime('2024-02-29T10:00'), true);
  assert.equal(isValidLocalDateTime('2025-02-29T10:00'), false);
  assert.equal(parseLocalDateTime('2026-13-01T10:00'), null);
});

test('monthly recurrence keeps the original anchor day', () => {
  assert.equal(nextRepeatDue('2026-01-31T08:30', 'monthly', 31), '2026-02-28T08:30');
  assert.equal(nextRepeatDue('2026-02-28T08:30', 'monthly', 31), '2026-03-31T08:30');
});

test('overdue recurring tasks advance to the next future occurrence', () => {
  const result = advanceRepeatToFuture('2026-07-20T08:00', 'daily', 20, new Date(2026, 6, 27, 10, 0));
  assert.equal(result, '2026-07-28T08:00');
});

test('normalization migrates legacy fields safely', () => {
  const task = normalizeTask({ title: 'اختبار', priority: 'med', due: '2026-07-27T12:00', notifyBefore: 15 });
  assert.equal(task.priority, 'medium');
  assert.equal(task.remindBefore, 15);
  assert.equal(task.repeatAnchorDay, 27);
});

test('calendar includes alarm, timezone, and clamped monthly dates', () => {
  const task = normalizeTask({
    id: 'abc',
    title: 'موعد مهم',
    due: '2026-01-31T20:00',
    remindBefore: 30,
    repeat: 'monthly',
    repeatAnchorDay: 31,
    category: 'عمل'
  });
  const ics = buildCalendar([task], 'مهامي', { timeZone: 'Asia/Amman' });
  assert.match(ics, /BEGIN:VALARM/);
  assert.match(ics, /TRIGGER;VALUE=DURATION;RELATED=START:-PT30M/);
  assert.match(ics, /X-WR-TIMEZONE:Asia\/Amman/);
  assert.match(ics, /RDATE:20260228T200000,20260331T200000/);
});

test('folding respects UTF-8 line size with Arabic text', () => {
  const folded = foldIcsLine(`SUMMARY:${'مهمة عربية طويلة '.repeat(12)}`);
  for (const line of folded.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75);
  }
});

test('fingerprint changes when reminder-relevant fields change', () => {
  const base = normalizeTask({ title: 'أ', due: '2026-07-27T12:00' });
  const changed = { ...base, remindBefore: 15 };
  assert.notEqual(taskFingerprint(base), taskFingerprint(changed));
});

test('fingerprint stays compact for long Arabic notes', () => {
  const task = normalizeTask({ title: 'مهمة', note: 'ن'.repeat(1000), due: '2026-07-27T12:00' });
  assert.match(taskFingerprint(task), /^v1-[0-9a-f]{8}$/);
});
