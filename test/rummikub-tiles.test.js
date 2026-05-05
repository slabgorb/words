import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBag, COLORS, NUMBERS, isJoker, tileValue } from '../plugins/rummikub/server/tiles.js';

test('COLORS has four entries', () => {
  assert.deepEqual(COLORS, ['red', 'blue', 'orange', 'black']);
});

test('NUMBERS is 1..13', () => {
  assert.deepEqual(NUMBERS, [1,2,3,4,5,6,7,8,9,10,11,12,13]);
});

test('buildBag returns 106 tiles', () => {
  const bag = buildBag();
  assert.equal(bag.length, 106);
});

test('buildBag has 104 numbered + 2 jokers', () => {
  const bag = buildBag();
  const jokers = bag.filter(t => t.kind === 'joker');
  const numbered = bag.filter(t => t.kind === 'numbered');
  assert.equal(jokers.length, 2);
  assert.equal(numbered.length, 104);
});

test('every numbered combo (color, value) appears exactly twice', () => {
  const bag = buildBag();
  for (const color of COLORS) {
    for (const value of NUMBERS) {
      const matches = bag.filter(t => t.kind === 'numbered' && t.color === color && t.value === value);
      assert.equal(matches.length, 2, `${color} ${value} should appear twice`);
    }
  }
});

test('tile ids are unique strings', () => {
  const bag = buildBag();
  const ids = bag.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(typeof id, 'string');
});

test('isJoker correctly identifies jokers', () => {
  const bag = buildBag();
  const j = bag.find(t => t.kind === 'joker');
  const n = bag.find(t => t.kind === 'numbered');
  assert.equal(isJoker(j), true);
  assert.equal(isJoker(n), false);
});

test('tileValue returns face value for numbered tiles', () => {
  assert.equal(tileValue({ kind: 'numbered', value: 7 }), 7);
});

test('tileValue returns 30 for joker (penalty value)', () => {
  assert.equal(tileValue({ kind: 'joker' }), 30);
});

test('tileValue returns the joker representation value when annotated and asked for played value', () => {
  const joker = { kind: 'joker', representsValue: 5, representsColor: 'red' };
  assert.equal(tileValue(joker), 30);
  assert.equal(tileValue(joker, { asPlayed: true }), 5);
});
