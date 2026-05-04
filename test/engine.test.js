import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE } from '../src/server/board.js';
import { validatePlacement } from '../src/server/engine.js';

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

test('first move must touch center', () => {
  const board = emptyBoard();
  const placement = [{ r: 0, c: 0, letter: 'A' }, { r: 0, c: 1, letter: 'T' }];
  const result = validatePlacement(board, placement, /* isFirstMove */ true);
  assert.equal(result.valid, false);
  assert.match(result.reason, /center/i);
});

test('first move on center is valid geometry', () => {
  const board = emptyBoard();
  const placement = [{ r: 7, c: 7, letter: 'A' }, { r: 7, c: 8, letter: 'T' }];
  const result = validatePlacement(board, placement, true);
  assert.equal(result.valid, true);
  assert.equal(result.axis, 'row');
});

test('placement must be in a single row or column', () => {
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 7, letter: 'A' },
    { r: 8, c: 8, letter: 'T' }
  ];
  const result = validatePlacement(board, placement, true);
  assert.equal(result.valid, false);
  assert.match(result.reason, /line/i);
});

test('single-tile placement is valid (axis ambiguous → row)', () => {
  const board = emptyBoard();
  const placement = [{ r: 7, c: 7, letter: 'A' }];
  const result = validatePlacement(board, placement, true);
  assert.equal(result.valid, true);
});

test('placement with gap (no existing tile filling it) is invalid', () => {
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 9, letter: 'T' }
  ];
  const result = validatePlacement(board, placement, true);
  assert.equal(result.valid, false);
  assert.match(result.reason, /gap/i);
});

test('placement with gap filled by existing tile is valid', () => {
  const board = emptyBoard();
  board[7][8] = { letter: 'I', byPlayer: 'keith' };
  const placement = [
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 9, letter: 'T' }
  ];
  const result = validatePlacement(board, placement, false);
  assert.equal(result.valid, true);
});

test('non-first move must touch an existing tile', () => {
  const board = emptyBoard();
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  const placement = [
    { r: 0, c: 0, letter: 'B' },
    { r: 0, c: 1, letter: 'Y' }
  ];
  const result = validatePlacement(board, placement, false);
  assert.equal(result.valid, false);
  assert.match(result.reason, /touch/i);
});

test('placing on an already-occupied cell is invalid', () => {
  const board = emptyBoard();
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  const placement = [{ r: 7, c: 7, letter: 'B' }];
  const result = validatePlacement(board, placement, false);
  assert.equal(result.valid, false);
  assert.match(result.reason, /occupied/i);
});
