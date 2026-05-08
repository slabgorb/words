import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardIdsOf, multisetEqual } from '../src/shared/cards/card-multiset.js';

test('cardIdsOf flattens nested arrays of cards into id list', () => {
  const state = {
    hand: [{ id: 'S-A-0' }, { id: 'H-2-1' }],
    melds: [[{ id: 'C-3-0' }, { id: 'C-4-0' }]],
    discard: [{ id: 'D-5-1' }],
  };
  const ids = cardIdsOf(state).sort();
  assert.deepEqual(ids, ['C-3-0', 'C-4-0', 'D-5-1', 'H-2-1', 'S-A-0']);
});

test('cardIdsOf handles empty arrays', () => {
  assert.deepEqual(cardIdsOf({ hand: [], melds: [] }), []);
});

test('multisetEqual returns true for permutations of the same ids', () => {
  assert.equal(multisetEqual(['a', 'b', 'c'], ['c', 'a', 'b']), true);
});

test('multisetEqual returns false when an id is added', () => {
  assert.equal(multisetEqual(['a', 'b'], ['a', 'b', 'c']), false);
});

test('multisetEqual returns false when an id is removed', () => {
  assert.equal(multisetEqual(['a', 'b', 'c'], ['a', 'b']), false);
});

test('multisetEqual returns false when an id is duplicated incorrectly', () => {
  assert.equal(multisetEqual(['a', 'b'], ['a', 'a']), false);
});
