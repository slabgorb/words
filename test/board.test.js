import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LETTER_VALUE, TILE_BAG, BOARD_PREMIUMS, BOARD_SIZE } from '../src/server/board.js';

test('board is 15x15', () => {
  assert.equal(BOARD_SIZE, 15);
  assert.equal(BOARD_PREMIUMS.length, 15);
  for (const row of BOARD_PREMIUMS) assert.equal(row.length, 15);
});

test('center square is double-word (WwF)', () => {
  assert.equal(BOARD_PREMIUMS[7][7], 'DW');
});

test('WwF tile bag has 104 tiles including 2 blanks', () => {
  assert.equal(TILE_BAG.length, 104);
  const blanks = TILE_BAG.filter(t => t === '_').length;
  assert.equal(blanks, 2);
});

test('letter values match WwF', () => {
  // Spot-check known WwF values
  assert.equal(LETTER_VALUE.A, 1);
  assert.equal(LETTER_VALUE.Q, 10);
  assert.equal(LETTER_VALUE.J, 10);
  assert.equal(LETTER_VALUE.X, 8);
  assert.equal(LETTER_VALUE.Z, 10);
  assert.equal(LETTER_VALUE._, 0);
});

test('TW squares are positioned per WwF (not corners)', () => {
  // WwF has TW at (0,3),(0,11),(3,0),(3,14),(11,0),(11,14),(14,3),(14,11)
  assert.equal(BOARD_PREMIUMS[0][0], null);
  assert.equal(BOARD_PREMIUMS[0][3], 'TW');
  assert.equal(BOARD_PREMIUMS[14][11], 'TW');
});
