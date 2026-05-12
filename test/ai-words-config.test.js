import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSolverConfig,
  buildSolverBoard,
  buildSolverTiles,
  placementFromResult,
} from '../plugins/words/server/ai/config.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('buildSolverConfig: wwf variant has 35-point bingo and wwf letter values', () => {
  const cfg = buildSolverConfig('wwf');
  // bingo is the Bingo type — either { score } or { multiplier }; we use score.
  assert.equal(cfg.bingo.score, 35);
  // J is 10 in wwf, 8 in scrabble.
  const j = cfg.tiles.find(t => t.character === 'J');
  assert.equal(j.score, 10);
});

test('buildSolverConfig: scrabble variant has 50-point bingo and scrabble letter values', () => {
  const cfg = buildSolverConfig('scrabble');
  assert.equal(cfg.bingo.score, 50);
  const j = cfg.tiles.find(t => t.character === 'J');
  assert.equal(j.score, 8);
});

test('buildSolverConfig: blanks live in blanksCount, not in tiles[]', () => {
  const cfg = buildSolverConfig('wwf');
  assert.equal(cfg.blanksCount, 2);
  const blank = cfg.tiles.find(t => t.character === '_');
  assert.equal(blank, undefined);
});

test('buildSolverConfig: bonuses use BONUS_CHARACTER / BONUS_WORD type constants', async () => {
  const { BONUS_CHARACTER, BONUS_WORD } = await import('@scrabble-solver/constants');
  const cfg = buildSolverConfig('wwf');
  // Every bonus must use one of the two type constants.
  for (const b of cfg.bonuses) {
    assert.ok(b.type === BONUS_CHARACTER || b.type === BONUS_WORD,
      `bonus at (${b.x},${b.y}) has invalid type ${String(b.type)}`);
    assert.ok(b.multiplier === 2 || b.multiplier === 3,
      `bonus at (${b.x},${b.y}) has invalid multiplier ${b.multiplier}`);
  }
  // At least one of each kind should be present in a real ruleset.
  assert.ok(cfg.bonuses.some(b => b.type === BONUS_WORD && b.multiplier === 3), 'TW present');
  assert.ok(cfg.bonuses.some(b => b.type === BONUS_CHARACTER && b.multiplier === 3), 'TL present');
});

test('buildSolverBoard: empty Board instance has all cells empty', () => {
  const state = buildInitialState({ participants: [{userId:1,side:'a'},{userId:2,side:'b'}], rng: det() });
  const board = buildSolverBoard(state);
  assert.equal(board.rowsCount, 15);
  assert.equal(board.columnsCount, 15);
  assert.equal(board.isEmpty(), true);
});

test('buildSolverBoard: populated cells reflect placed tiles', () => {
  const state = buildInitialState({ participants: [{userId:1,side:'a'},{userId:2,side:'b'}], rng: det() });
  state.board[7][7] = { letter: 'C', byPlayer: 'a', blank: false };
  state.board[7][8] = { letter: 'A', byPlayer: 'a', blank: false };
  state.board[7][9] = { letter: 'T', byPlayer: 'a', blank: false };
  const board = buildSolverBoard(state);
  // Board is row-major: board.rows[y][x]. Our state.board is also [r][c] i.e. [y][x].
  assert.equal(board.rows[7][7].tile.character, 'C');
  assert.equal(board.rows[7][8].tile.character, 'A');
  assert.equal(board.rows[7][9].tile.character, 'T');
  assert.equal(board.rows[7][7].isEmpty, false);
});

test('buildSolverBoard: blank tiles on the board carry isBlank: true', () => {
  const state = buildInitialState({ participants: [{userId:1,side:'a'},{userId:2,side:'b'}], rng: det() });
  state.board[7][7] = { letter: 'E', byPlayer: 'a', blank: true };
  const board = buildSolverBoard(state);
  assert.equal(board.rows[7][7].tile.character, 'E');
  assert.equal(board.rows[7][7].tile.isBlank, true);
});

test('buildSolverTiles: rack maps each letter to a Tile instance; blank becomes isBlank tile', async () => {
  const { Tile } = await import('@scrabble-solver/types');
  const tiles = buildSolverTiles(['A','E','I','R','S','T','_']);
  assert.equal(tiles.length, 7);
  for (const t of tiles) assert.ok(t instanceof Tile, 'each item is a Tile instance');
  const blank = tiles.find(t => t.isBlank === true);
  assert.ok(blank, 'blank tile present');
  const nonBlank = tiles.find(t => t.character === 'A');
  assert.equal(nonBlank.isBlank, false);
});

test('placementFromResult: translates result cells into a Words move action', () => {
  // Synthetic ResultJson-ish object. result.cells is CellJson[] with .tile.
  const result = {
    points: 12,
    cells: [
      { x: 7, y: 7, isEmpty: false, tile: { character: 'C', isBlank: false } },
      { x: 8, y: 7, isEmpty: false, tile: { character: 'A', isBlank: false } },
      { x: 9, y: 7, isEmpty: false, tile: { character: 'T', isBlank: false } },
    ],
  };
  const action = placementFromResult(result);
  assert.equal(action.type, 'move');
  assert.equal(action.payload.placement.length, 3);
  const first = action.payload.placement[0];
  assert.equal(first.r, 7);
  assert.equal(first.c, 7);
  assert.equal(first.letter, 'C');
  assert.equal(first.blank, false);
});

test('placementFromResult: blank tile carries blank: true with the chosen letter', () => {
  const result = {
    points: 8,
    cells: [
      { x: 5, y: 5, isEmpty: false, tile: { character: 'E', isBlank: true } },
      { x: 6, y: 5, isEmpty: false, tile: { character: 'R', isBlank: false } },
    ],
  };
  const action = placementFromResult(result);
  assert.equal(action.payload.placement[0].blank, true);
  assert.equal(action.payload.placement[0].letter, 'E');
  assert.equal(action.payload.placement[1].blank, false);
});
