import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBoard } from '../plugins/backgammon/server/ai/board-eval.js';

function emptyBoard() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  return { points, barA: 0, barB: 0, bornOffA: 0, bornOffB: 0 };
}

function point(b, idx, color, count) {
  b.points[idx] = { color, count };
  return b;
}

test('evaluateBoard: pip lead translates to positive total', () => {
  // Side A: 1 checker at index 23 (1 pip).
  // Side B: 1 checker at index 0  (1 pip — symmetric, but with bornOff
  // tipping the scale).
  const b = emptyBoard();
  point(b, 23, 'a', 1);
  b.bornOffA = 14;            // side A has borne off 14 → small pip total
  point(b, 0, 'b', 15);       // side B has 15 checkers at pip 1 (well behind)
  const a = evaluateBoard(b, 'a');
  assert.ok(a.pipDelta > 0, `pipDelta should favor A, got ${a.pipDelta}`);
  assert.ok(a.total > 0);
});

test('evaluateBoard: own blots in an opponent shot lane incur a blot penalty', () => {
  const safe = emptyBoard();
  point(safe, 12, 'a', 2);    // anchored pair, no blot
  point(safe, 13, 'b', 1);    // opponent directly behind
  const blotty = emptyBoard();
  point(blotty, 12, 'a', 1);  // blot
  point(blotty, 13, 'b', 1);  // direct shot at distance 1 (11/36 hit)
  const safeEval = evaluateBoard(safe, 'a');
  const blotEval = evaluateBoard(blotty, 'a');
  assert.equal(safeEval.blotPenalty, 0, 'no blots → zero penalty');
  assert.ok(blotEval.blotPenalty < -2, `blotty: distance-1 direct shot, got ${blotEval.blotPenalty}`);
});

test('evaluateBoard: building a 5-prime is rewarded', () => {
  const noPrime = emptyBoard();
  point(noPrime, 0, 'a', 2);
  const prime5 = emptyBoard();
  for (let i = 1; i <= 5; i++) point(prime5, i, 'a', 2);
  const a = evaluateBoard(noPrime, 'a');
  const b = evaluateBoard(prime5, 'a');
  assert.ok(b.primeBonus >= 10, `5-prime should be ≥10, got ${b.primeBonus}`);
  assert.ok(a.primeBonus <= 4, `single point should be ≤4, got ${a.primeBonus}`);
});

test('evaluateBoard: opponent on bar is a hit bonus', () => {
  const noHit = emptyBoard();
  const hit = emptyBoard();
  hit.barB = 1;
  const a = evaluateBoard(noHit, 'a');
  const b = evaluateBoard(hit, 'a');
  assert.equal(b.hitBonus - a.hitBonus, 8, 'one opponent checker on bar = +8');
});

test('evaluateBoard: home-board points are rewarded for side A (indices 18-23)', () => {
  const empty = emptyBoard();
  const homeBuilt = emptyBoard();
  point(homeBuilt, 18, 'a', 2);
  point(homeBuilt, 19, 'a', 2);
  point(homeBuilt, 20, 'a', 2);
  const a = evaluateBoard(empty, 'a');
  const b = evaluateBoard(homeBuilt, 'a');
  assert.equal(b.homeBoardBonus - a.homeBoardBonus, 9, '3 home-board points = +9');
});

test('evaluateBoard: side B mirror — home board is indices 0-5', () => {
  const homeBuilt = emptyBoard();
  point(homeBuilt, 0, 'b', 2);
  point(homeBuilt, 1, 'b', 2);
  const eval_ = evaluateBoard(homeBuilt, 'b');
  assert.equal(eval_.homeBoardBonus, 6);
});
