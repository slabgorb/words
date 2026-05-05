import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard, freshGameDeal } from '../src/server/db.js';
import { BOARD_SIZE } from '../plugins/words/server/board.js';

test('emptyBoard returns a 15x15 array of nulls', () => {
  const b = emptyBoard();
  assert.equal(b.length, BOARD_SIZE);
  for (const row of b) {
    assert.equal(row.length, BOARD_SIZE);
    assert.ok(row.every(c => c === null));
  }
});

test('freshGameDeal hands out two 7-tile racks and a remaining bag', () => {
  const { bag, rackA, rackB } = freshGameDeal();
  assert.equal(rackA.length, 7);
  assert.equal(rackB.length, 7);
  // The Words With Friends bag has 104 tiles. After dealing 14, 90 remain.
  assert.equal(bag.length, 90);
});

test('freshGameDeal returns independent racks (no aliasing)', () => {
  const { rackA, rackB } = freshGameDeal();
  rackA.push('X');
  assert.equal(rackB.length, 7);
});
