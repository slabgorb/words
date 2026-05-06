import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateLegalMoves, isLegalMove } from '../plugins/backgammon/server/validate.js';

function emptyBoard() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  return { points, barA: 0, barB: 0, bornOffA: 0, bornOffB: 0 };
}

test('A on bar: only bar-entry moves are legal', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[0] = { color: 'a', count: 2 };  // checker also on 24-point — irrelevant while barred
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  // Only entries onto indices 2 (die=3) and 4 (die=5)
  const entries = moves.filter(m => m.from === 'bar');
  assert.equal(entries.length, 2);
  assert.ok(entries.some(m => m.to === 2 && m.die === 3));
  assert.ok(entries.some(m => m.to === 4 && m.die === 5));
  // No point-to-point moves
  assert.equal(moves.length, 2);
});

test('A on bar: blocked entry points reject', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 2 };  // blocks die=3 entry
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  // Only die=5 entry (onto index 4) is legal.
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0], { from: 'bar', to: 4, die: 5 });
});

test('B on bar: enters into A home, die=4 onto index 20', () => {
  const b = emptyBoard();
  b.barB = 1;
  const moves = enumerateLegalMoves(b, [4, 6], 'b');
  // die=4 → 20, die=6 → 18
  assert.ok(moves.some(m => m.from === 'bar' && m.to === 20 && m.die === 4));
  assert.ok(moves.some(m => m.from === 'bar' && m.to === 18 && m.die === 6));
  assert.equal(moves.length, 2);
});

test('A on bar with NO legal entry: returns empty list', () => {
  const b = emptyBoard();
  b.barA = 1;
  for (let i = 0; i < 6; i++) b.points[i] = { color: 'b', count: 2 };
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  assert.deepEqual(moves, []);
});

test('isLegalMove: A bar entry onto blot is legal', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 1 };  // blot
  assert.equal(isLegalMove(b, [3], 'a', 'bar', 2), true);
});

test('isLegalMove: A bar entry onto blocked point is illegal', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 2 };
  assert.equal(isLegalMove(b, [3], 'a', 'bar', 2), false);
});

test('isLegalMove: A point-to-point illegal while on bar', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[10] = { color: 'a', count: 2 };
  assert.equal(isLegalMove(b, [3], 'a', 10, 13), false);
});
