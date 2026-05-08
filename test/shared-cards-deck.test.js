import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardId, parseCardId } from '../src/shared/cards/deck.js';

test('cardId formats natural cards as suit-rank-deckIndex', () => {
  assert.equal(cardId({ rank: 'A', suit: 'S', deckIndex: 0 }), 'S-A-0');
  assert.equal(cardId({ rank: 'T', suit: 'C', deckIndex: 1 }), 'C-T-1');
});

test('cardId formats jokers as jk-index', () => {
  assert.equal(cardId({ kind: 'joker', index: 0 }), 'jk-0');
  assert.equal(cardId({ kind: 'joker', index: 3 }), 'jk-3');
});

test('parseCardId round-trips a natural card', () => {
  const id = 'H-7-1';
  const parsed = parseCardId(id);
  assert.deepEqual(parsed, { kind: 'natural', rank: '7', suit: 'H', deckIndex: 1 });
});

test('parseCardId round-trips a joker', () => {
  assert.deepEqual(parseCardId('jk-2'), { kind: 'joker', index: 2 });
});

test('parseCardId rejects malformed ids', () => {
  assert.throws(() => parseCardId('garbage'), /invalid card id/);
});
