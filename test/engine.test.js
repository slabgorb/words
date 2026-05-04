import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE } from '../src/server/board.js';
import { validatePlacement, extractWords } from '../src/server/engine.js';

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

test('extractWords on first move returns the single main word', () => {
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  assert.equal(mainWord.text, 'CAT');
  assert.deepEqual(crossWords, []);
});

test('extractWords picks up letters extending main word on both sides', () => {
  const board = emptyBoard();
  board[7][6] = { letter: 'C', byPlayer: 'keith' };
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  board[7][8] = { letter: 'T', byPlayer: 'keith' };
  // Now play 'S' before, 'S' after → SCATS
  const placement = [
    { r: 7, c: 5, letter: 'S' },
    { r: 7, c: 9, letter: 'S' }
  ];
  const { mainWord } = extractWords(board, placement, 'row');
  assert.equal(mainWord.text, 'SCATS');
  // mainWord.tiles includes both new and existing tiles, in order
  assert.equal(mainWord.tiles.length, 5);
});

test('extractWords picks up perpendicular crosswords', () => {
  const board = emptyBoard();
  // Existing word "CAT" in row 7 cols 6-8
  board[7][6] = { letter: 'C', byPlayer: 'keith' };
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  board[7][8] = { letter: 'T', byPlayer: 'keith' };
  // Play 'O' at (8,7) and 'X' at (9,7) — vertical placement, axis=col
  // Main word = AOX (existing A at (7,7) + O at (8,7) + X at (9,7)).
  // No cross-words because 'O' and 'X' have no horizontal neighbors.
  const placement = [
    { r: 8, c: 7, letter: 'O' },
    { r: 9, c: 7, letter: 'X' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'col');
  assert.equal(mainWord.text, 'AOX');
  assert.deepEqual(crossWords, []);
});

test('extractWords detects single-tile placement extending two perpendiculars', () => {
  // Setup: existing OA at (7,6),(7,7) horizontally.
  // Place 'S' at (8,6) — single tile.
  // - Main word along row 8: just 'S' (no horizontal neighbors), so main = null (length < 2).
  // - Cross-word along col 6 starting at (7,6): 'O' (row 7) + 'S' (row 8) = "OS" (length 2).
  const b2 = (function () {
    const b = Array.from({ length: 15 }, () => Array(15).fill(null));
    b[7][7] = { letter: 'A', byPlayer: 'keith' };
    b[7][6] = { letter: 'O', byPlayer: 'keith' };
    return b;
  })();
  const placement = [{ r: 8, c: 6, letter: 'S' }];
  const result = extractWords(b2, placement, 'row');
  assert.equal(result.mainWord, null);
  assert.equal(result.crossWords.length, 1);
  assert.equal(result.crossWords[0].text, 'OS');
});
