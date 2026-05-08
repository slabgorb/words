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

import {
  RANKS, SUITS, buildDeck, shuffle, sameCard, isJoker, isNaturalTwo,
} from '../src/shared/cards/deck.js';

test('RANKS has 13 entries, A through K with T for ten', () => {
  assert.deepEqual(RANKS, ['A','2','3','4','5','6','7','8','9','T','J','Q','K']);
});

test('SUITS has S, H, D, C in canonical order', () => {
  assert.deepEqual(SUITS, ['S','H','D','C']);
});

test('buildDeck({decks:1, jokers:0}) returns 52 unique cards each with id', () => {
  const d = buildDeck({ decks: 1, jokers: 0 });
  assert.equal(d.length, 52);
  const ids = new Set(d.map(c => c.id));
  assert.equal(ids.size, 52);
  for (const c of d) {
    assert.ok(typeof c.id === 'string', `card missing id: ${JSON.stringify(c)}`);
    assert.ok(typeof c.rank === 'string');
    assert.ok(typeof c.suit === 'string');
    assert.equal(c.deckIndex, 0);
  }
});

test('buildDeck({decks:2, jokers:4}) returns 108 unique cards (52*2 + 4 jokers)', () => {
  const d = buildDeck({ decks: 2, jokers: 4 });
  assert.equal(d.length, 108);
  const ids = new Set(d.map(c => c.id));
  assert.equal(ids.size, 108);
  const naturals = d.filter(c => !isJoker(c));
  const jokers = d.filter(c => isJoker(c));
  assert.equal(naturals.length, 104);
  assert.equal(jokers.length, 4);
  const colors = jokers.map(c => c.color).sort();
  assert.deepEqual(colors, ['black', 'black', 'red', 'red']);
});

test('buildDeck({decks:0,...}) throws (must be 1 or 2)', () => {
  assert.throws(() => buildDeck({ decks: 0, jokers: 0 }), /decks must be 1 or 2/);
});

test('shuffle is deterministic for the same seeded rng', () => {
  const d1 = buildDeck({ decks: 1, jokers: 0 });
  const d2 = buildDeck({ decks: 1, jokers: 0 });
  function det(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  shuffle(d1, det(42));
  shuffle(d2, det(42));
  assert.deepEqual(d1.map(c => c.id), d2.map(c => c.id));
});

test('shuffle preserves the multiset', () => {
  const d = buildDeck({ decks: 2, jokers: 4 });
  const before = d.map(c => c.id).sort();
  shuffle(d, Math.random);
  const after = d.map(c => c.id).sort();
  assert.deepEqual(after, before);
});

test('sameCard compares by id only', () => {
  const a = { id: 'S-A-0', rank: 'A', suit: 'S', deckIndex: 0 };
  const b = { id: 'S-A-0', rank: 'A', suit: 'S', deckIndex: 0 };
  const c = { id: 'S-A-1', rank: 'A', suit: 'S', deckIndex: 1 };
  assert.equal(sameCard(a, b), true);
  assert.equal(sameCard(a, c), false);
});

test('isJoker', () => {
  assert.equal(isJoker({ kind: 'joker', index: 0 }), true);
  assert.equal(isJoker({ rank: 'A', suit: 'S' }), false);
});

test('isNaturalTwo: a 2 is wild relative to a meld of a different suit', () => {
  // 2♣ is wild in a hearts meld; 2♣ is the natural two in a clubs meld
  assert.equal(isNaturalTwo({ rank: '2', suit: 'C' }, 'C'), true);
  assert.equal(isNaturalTwo({ rank: '2', suit: 'C' }, 'H'), false);
  assert.equal(isNaturalTwo({ rank: '5', suit: 'C' }, 'C'), false);
  assert.equal(isNaturalTwo({ kind: 'joker', index: 0 }, 'C'), false);
});
