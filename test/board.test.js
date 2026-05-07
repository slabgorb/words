import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LETTER_VALUE, TILE_BAG, BOARD_PREMIUMS, BOARD_SIZE, getRules, VARIANTS, DEFAULT_VARIANT } from '../plugins/words/server/board.js';

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

test('VARIANTS includes both wwf and scrabble; default is wwf', () => {
  assert.deepEqual([...VARIANTS].sort(), ['scrabble', 'wwf']);
  assert.equal(DEFAULT_VARIANT, 'wwf');
});

test('getRules returns wwf rules for unknown or omitted variant', () => {
  assert.equal(getRules().variant, 'wwf');
  assert.equal(getRules('not-a-variant').variant, 'wwf');
});

test('Scrabble rules: 100-tile bag, classic letter values, corner TWs, +50 bingo', () => {
  const r = getRules('scrabble');
  assert.equal(r.tileBag.length, 100);
  assert.equal(r.tileBag.filter(t => t === '_').length, 2);
  // Classic Scrabble letter values: B=3 (WwF=4), G=2 (WwF=3), J=8 (WwF=10), U=1 (WwF=2)
  assert.equal(r.letterValue.B, 3);
  assert.equal(r.letterValue.G, 2);
  assert.equal(r.letterValue.J, 8);
  assert.equal(r.letterValue.U, 1);
  // Corner TWs (the WwF board has corners as null, Scrabble has them as TW).
  assert.equal(r.premiums[0][0], 'TW');
  assert.equal(r.premiums[0][14], 'TW');
  assert.equal(r.premiums[14][0], 'TW');
  assert.equal(r.premiums[14][14], 'TW');
  // Center is the start star (DW).
  assert.equal(r.premiums[7][7], 'DW');
  // Scrabble has 50-point bingo bonus.
  assert.equal(r.bingoBonus, 50);
});

test('WwF rules expose 35-point bingo and 104-tile bag via getRules', () => {
  const r = getRules('wwf');
  assert.equal(r.tileBag.length, 104);
  assert.equal(r.bingoBonus, 35);
  assert.equal(r.premiums[7][7], 'DW');
  assert.equal(r.premiums[0][0], null); // not a corner-TW board
});
