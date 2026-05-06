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

import { applyMove, enterFromBar, bearOff, isPointBlocked } from '../plugins/backgammon/server/board.js';

function emptyBoard() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  return { points, barA: 0, barB: 0, bornOffA: 0, bornOffB: 0 };
}

test('applyMove: A point-to-point onto empty point', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  const next = applyMove(b, 'a', 0, 5);
  assert.deepEqual(next.points[0], { color: 'a', count: 1 });
  assert.deepEqual(next.points[5], { color: 'a', count: 1 });
});

test('applyMove: A onto own stack increments count', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  b.points[5] = { color: 'a', count: 3 };
  const next = applyMove(b, 'a', 0, 5);
  assert.deepEqual(next.points[5], { color: 'a', count: 4 });
});

test('applyMove: emptying a point sets color back to null', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  const next = applyMove(b, 'a', 0, 5);
  assert.deepEqual(next.points[0], { color: null, count: 0 });
});

test('applyMove: A hits a B blot — B checker goes to barB', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  b.points[5] = { color: 'b', count: 1 };
  const next = applyMove(b, 'a', 0, 5);
  assert.deepEqual(next.points[5], { color: 'a', count: 1 });
  assert.equal(next.barB, 1);
});

test('enterFromBar: A enters with die=3 onto index 2', () => {
  const b = emptyBoard();
  b.barA = 2;
  const next = enterFromBar(b, 'a', 2);
  assert.equal(next.barA, 1);
  assert.deepEqual(next.points[2], { color: 'a', count: 1 });
});

test('enterFromBar: A entering on B blot hits it', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 1 };
  const next = enterFromBar(b, 'a', 2);
  assert.equal(next.barA, 0);
  assert.equal(next.barB, 1);
  assert.deepEqual(next.points[2], { color: 'a', count: 1 });
});

test('enterFromBar: B enters with die=4 onto index 20 (24-4)', () => {
  const b = emptyBoard();
  b.barB = 1;
  const next = enterFromBar(b, 'b', 20);
  assert.equal(next.barB, 0);
  assert.deepEqual(next.points[20], { color: 'b', count: 1 });
});

test('bearOff: A bears off from index 21, increments bornOffA', () => {
  const b = emptyBoard();
  b.points[21] = { color: 'a', count: 2 };
  const next = bearOff(b, 'a', 21);
  assert.equal(next.bornOffA, 1);
  assert.deepEqual(next.points[21], { color: 'a', count: 1 });
});

test('bearOff: B bears off from index 0, increments bornOffB', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'b', count: 1 };
  const next = bearOff(b, 'b', 0);
  assert.equal(next.bornOffB, 1);
  assert.deepEqual(next.points[0], { color: null, count: 0 });
});

test('isPointBlocked: 2+ opponent checkers blocks', () => {
  const b = emptyBoard();
  b.points[5] = { color: 'b', count: 2 };
  assert.equal(isPointBlocked(b, 'a', 5), true);
});

test('isPointBlocked: own checkers do not block', () => {
  const b = emptyBoard();
  b.points[5] = { color: 'a', count: 5 };
  assert.equal(isPointBlocked(b, 'a', 5), false);
});

test('isPointBlocked: single blot does not block', () => {
  const b = emptyBoard();
  b.points[5] = { color: 'b', count: 1 };
  assert.equal(isPointBlocked(b, 'a', 5), false);
});
