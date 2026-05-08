import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canLay } from '../plugins/buraco/client/sequence-validator.js';

const C = (rank, suit) => ({ id: `${suit}-${rank}-0`, rank, suit, deckIndex: 0 });

test('canLay accepts a valid 3-card sequence', () => {
  assert.equal(canLay([C('5','H'), C('6','H'), C('7','H')]), true);
});
test('canLay rejects 2 cards', () => {
  assert.equal(canLay([C('5','H'), C('6','H')]), false);
});
test('canLay rejects mixed suits', () => {
  assert.equal(canLay([C('5','H'), C('6','S'), C('7','H')]), false);
});
