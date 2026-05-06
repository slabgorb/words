import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLegEnd } from '../plugins/backgammon/server/match.js';

function emptyBoard() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  return { points, barA: 0, barB: 0, bornOffA: 0, bornOffB: 0 };
}

test('classifyLegEnd: single — opponent has borne off ≥ 1', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.bornOffB = 5;
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'single', multiplier: 1 });
});

test('classifyLegEnd: gammon — opponent has 0 borne off, none in winners home/bar', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.points[10] = { color: 'b', count: 15 };  // outside A's home, not on bar
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'gammon', multiplier: 2 });
});

test('classifyLegEnd: backgammon — opponent has 0 borne off + checker in winners home', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.points[20] = { color: 'b', count: 1 };  // in A's home (indices 18..23)
  b.points[10] = { color: 'b', count: 14 };
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'backgammon', multiplier: 3 });
});

test('classifyLegEnd: backgammon — opponent on bar', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.barB = 1;
  b.points[10] = { color: 'b', count: 14 };
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'backgammon', multiplier: 3 });
});

test('classifyLegEnd: B winner mirrored', () => {
  const b = emptyBoard();
  b.bornOffB = 15;
  b.points[3] = { color: 'a', count: 1 };  // in B home (indices 0..5)
  b.points[10] = { color: 'a', count: 14 };
  assert.deepEqual(classifyLegEnd(b, 'b'), { type: 'backgammon', multiplier: 3 });
});
