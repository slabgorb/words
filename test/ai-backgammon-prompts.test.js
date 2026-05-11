import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBoard, pipCount } from '../plugins/backgammon/server/ai/prompts.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';

function startingBoard() {
  return buildInitialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng: () => 0.5,
  }).board;
}

test('pipCount: returns 167 for each side at the opening position', () => {
  const b = startingBoard();
  assert.equal(pipCount(b, 'a'), 167);
  assert.equal(pipCount(b, 'b'), 167);
});

test('renderBoard: contains both grid rows, bar line, and off line for side A', () => {
  const out = renderBoard(startingBoard(), 'a');
  assert.match(out, /13 14 15 16 17 18 \| 19 20 21 22 23 24/);
  assert.match(out, /12 11 10  9  8  7 \|  6  5  4  3  2  1/);
  assert.match(out, /bar: you=0 +opp=0/);
  assert.match(out, /off: you=0 +opp=0/);
});

test('renderBoard: bot on bar shows in the bar line', () => {
  const b = startingBoard();
  b.barA = 2;
  const out = renderBoard(b, 'a');
  assert.match(out, /bar: you=2 +opp=0/);
});

test('renderBoard: for side B, points are oriented from B perspective', () => {
  // Side B's 24-point is index 23 (A's index 0). Rendering for B should
  // place A's checkers on the equivalent of B's 24-point.
  const out = renderBoard(startingBoard(), 'b');
  // Smoke: contains both rows and the labels.
  assert.match(out, /13 14 15 16 17 18 \| 19 20 21 22 23 24/);
  assert.match(out, /bar: you=0 +opp=0/);
});
