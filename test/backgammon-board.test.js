import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPoints, BOARD_SIZE, HOME_INDICES } from '../plugins/backgammon/server/board.js';

test('initialPoints returns 24 entries', () => {
  const pts = initialPoints();
  assert.equal(pts.length, 24);
  assert.equal(BOARD_SIZE, 24);
});

test('initialPoints: A has checkers on indices 0, 11, 16, 18', () => {
  const pts = initialPoints();
  assert.deepEqual(pts[0],  { color: 'a', count: 2 });
  assert.deepEqual(pts[11], { color: 'a', count: 5 });
  assert.deepEqual(pts[16], { color: 'a', count: 3 });
  assert.deepEqual(pts[18], { color: 'a', count: 5 });
});

test('initialPoints: B has checkers on indices 23, 12, 7, 5', () => {
  const pts = initialPoints();
  assert.deepEqual(pts[23], { color: 'b', count: 2 });
  assert.deepEqual(pts[12], { color: 'b', count: 5 });
  assert.deepEqual(pts[7],  { color: 'b', count: 3 });
  assert.deepEqual(pts[5],  { color: 'b', count: 5 });
});

test('initialPoints: every other index is empty', () => {
  const pts = initialPoints();
  const occupied = new Set([0, 5, 7, 11, 12, 16, 18, 23]);
  for (let i = 0; i < 24; i++) {
    if (!occupied.has(i)) assert.deepEqual(pts[i], { color: null, count: 0 }, `index ${i}`);
  }
});

test('initialPoints: each side has 15 checkers on the board', () => {
  const pts = initialPoints();
  const sumA = pts.filter(p => p.color === 'a').reduce((s, p) => s + p.count, 0);
  const sumB = pts.filter(p => p.color === 'b').reduce((s, p) => s + p.count, 0);
  assert.equal(sumA, 15);
  assert.equal(sumB, 15);
});

test('HOME_INDICES.a = [18..23], HOME_INDICES.b = [0..5]', () => {
  assert.deepEqual(HOME_INDICES.a, [18, 19, 20, 21, 22, 23]);
  assert.deepEqual(HOME_INDICES.b, [0, 1, 2, 3, 4, 5]);
});
