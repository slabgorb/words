import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE } from '../src/server/board.js';
import { validatePlacement, extractWords, scoreMove, applyMove } from '../src/server/engine.js';

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

test('scoreMove on first move with no premiums hit (except center DW)', () => {
  // CAT at row 7 cols 6,7,8. Center (7,7) = DW. C=4, A=1, T=1 = 6, doubled by DW = 12.
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  const score = scoreMove(board, placement, mainWord, crossWords);
  assert.equal(score, 12);
});

test('scoreMove applies premiums only to newly-placed tiles', () => {
  // Existing A at (7,7) — DW already consumed.
  // Play C at (7,6), T at (7,8) → main CAT.
  // Premiums on (7,6) and (7,8) per WwF: both null. So just letter values.
  // C=4 + A=1 (existing) + T=1 = 6, no word multiplier.
  const board = emptyBoard();
  board[7][7] = { letter: 'A', byPlayer: 'keith' };
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  const score = scoreMove(board, placement, mainWord, crossWords);
  assert.equal(score, 6);
});

test('scoreMove gives 7-letter bingo bonus of +35 (WwF)', () => {
  // Place 7 A's at row 7 cols 4..10. Center (7,7) = DW.
  // 7 * 1 = 7, * 2 (center DW) = 14. + 35 bingo = 49.
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 4, letter: 'A' },
    { r: 7, c: 5, letter: 'A' },
    { r: 7, c: 6, letter: 'A' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'A' },
    { r: 7, c: 9, letter: 'A' },
    { r: 7, c: 10, letter: 'A' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  const score = scoreMove(board, placement, mainWord, crossWords);
  assert.equal(score, 49);
});

test('scoreMove counts blank tiles as 0', () => {
  // Place "CAT" with C as a blank. Center (7,7) = DW.
  // 0 (blank) + 1 (A) + 1 (T) = 2, * 2 (DW) = 4.
  const board = emptyBoard();
  const placement = [
    { r: 7, c: 6, letter: 'C', blank: true },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const { mainWord, crossWords } = extractWords(board, placement, 'row');
  const score = scoreMove(board, placement, mainWord, crossWords);
  assert.equal(score, 4);
});

function baseState() {
  return {
    board: emptyBoard(),
    bag: ['Q','U','I','R','K','S','E','S','S','S'], // 10 tiles for predictable refill
    racks: {
      keith: ['C','A','T','S','E','E','D'],
      sonia: ['A','A','A','A','A','A','A']
    },
    scores: { keith: 0, sonia: 0 },
    currentTurn: 'keith',
    consecutiveScorelessTurns: 0
  };
}

test('applyMove places tiles on board, removes from rack, refills, advances turn', () => {
  const state = baseState();
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const next = applyMove(state, {
    playerId: 'keith',
    kind: 'play',
    placement,
    scoreDelta: 12
  });
  // Board updated
  assert.equal(next.board[7][6].letter, 'C');
  assert.equal(next.board[7][7].letter, 'A');
  assert.equal(next.board[7][8].letter, 'T');
  // Rack: removed CAT (3 tiles), refilled to 7 from front of bag (Q,U,I)
  assert.equal(next.racks.keith.length, 7);
  assert.deepEqual(next.racks.keith.slice(-3), ['Q','U','I']);
  // Bag shrunk by 3
  assert.equal(next.bag.length, 7);
  // Turn advanced
  assert.equal(next.currentTurn, 'sonia');
  // Score updated
  assert.equal(next.scores.keith, 12);
  // Scoreless counter reset
  assert.equal(next.consecutiveScorelessTurns, 0);
});

test('applyMove for pass does not mutate board, advances turn, increments scoreless counter', () => {
  const state = baseState();
  const next = applyMove(state, { playerId: 'keith', kind: 'pass' });
  assert.deepEqual(next.board, state.board);
  assert.deepEqual(next.racks.keith, state.racks.keith);
  assert.equal(next.currentTurn, 'sonia');
  assert.equal(next.consecutiveScorelessTurns, 1);
});

test('applyMove for swap exchanges tiles, advances turn, increments scoreless counter', () => {
  const state = baseState();
  const next = applyMove(state, {
    playerId: 'keith',
    kind: 'swap',
    swapTiles: ['C','A','T']
  });
  // 3 tiles removed, 3 drawn from bag front (Q,U,I), 3 returned to bag
  assert.equal(next.racks.keith.length, 7);
  assert(next.racks.keith.includes('Q'));
  assert.equal(next.bag.length, 10); // size unchanged
  assert.equal(next.currentTurn, 'sonia');
  assert.equal(next.consecutiveScorelessTurns, 1);
});

test('applyMove refill is bounded by bag size', () => {
  const state = baseState();
  state.bag = ['X','Y']; // only 2 tiles left
  const placement = [
    { r: 7, c: 6, letter: 'C' },
    { r: 7, c: 7, letter: 'A' },
    { r: 7, c: 8, letter: 'T' }
  ];
  const next = applyMove(state, {
    playerId: 'keith',
    kind: 'play',
    placement,
    scoreDelta: 12
  });
  // Drew 2 (X, Y); rack now 6 tiles (4 left after removing CAT + 2 drawn)
  assert.equal(next.racks.keith.length, 6);
  assert.equal(next.bag.length, 0);
});
