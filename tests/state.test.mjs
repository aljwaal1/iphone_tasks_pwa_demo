import test from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { getElementById: () => null, querySelectorAll: () => [] }
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { dispatchEvent: () => {}, addEventListener: () => {} }
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { userAgent: '', platform: '', maxTouchPoints: 0 }
});
Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: () => ({ matches: false })
});
Object.defineProperty(globalThis, 'CustomEvent', {
  configurable: true,
  value: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
});

const { normalizeTaskList } = await import('../app-state.js');

test('import regeneration remaps recurring series relationships', () => {
  const imported = normalizeTaskList([
    { id: 'series-1', title: 'متكررة', due: '2026-07-31T08:00', repeat: 'monthly', seriesId: 'series-1' },
    { id: 'done-1', title: 'نسخة مكتملة', done: true, occurrenceOf: 'series-1' }
  ], { regenerateIds: true });
  const current = imported.find((task) => task.repeat === 'monthly');
  const completed = imported.find((task) => task.done);
  assert.notEqual(current.id, 'series-1');
  assert.equal(current.seriesId, current.id);
  assert.equal(completed.occurrenceOf, current.id);
});
