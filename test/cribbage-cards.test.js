import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKS, SUITS, buildDeck, shuffle, pipValue, runValue, sameCard,
} from '../plugins/cribbage/server/cards.js';

test('RANKS has 13 entries, A through K, T for ten', () => {
  assert.deepEqual(RANKS, ['A','2','3','4','5','6','7','8','9','T','J','Q','K']);
});

test('SUITS has S, H, D, C', () => {
  assert.deepEqual(SUITS, ['S','H','D','C']);
});

test('buildDeck returns 52 unique cards', () => {
  const d = buildDeck();
  assert.equal(d.length, 52);
  const ids = new Set(d.map(c => c.rank + c.suit));
  assert.equal(ids.size, 52);
});

test('pipValue: A=1, 2..9=face, T/J/Q/K=10', () => {
  assert.equal(pipValue({ rank: 'A', suit: 'S' }), 1);
  assert.equal(pipValue({ rank: '5', suit: 'H' }), 5);
  assert.equal(pipValue({ rank: '9', suit: 'D' }), 9);
  for (const r of ['T','J','Q','K']) {
    assert.equal(pipValue({ rank: r, suit: 'C' }), 10);
  }
});

test('runValue: A=1, T=10, J=11, Q=12, K=13', () => {
  assert.equal(runValue({ rank: 'A', suit: 'S' }), 1);
  assert.equal(runValue({ rank: 'T', suit: 'S' }), 10);
  assert.equal(runValue({ rank: 'J', suit: 'S' }), 11);
  assert.equal(runValue({ rank: 'Q', suit: 'S' }), 12);
  assert.equal(runValue({ rank: 'K', suit: 'S' }), 13);
});

test('shuffle preserves the multiset', () => {
  const d = buildDeck();
  let s = 1;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out = shuffle(d.slice(), rng);
  assert.equal(out.length, 52);
  const before = d.map(c => c.rank + c.suit).sort();
  const after = out.map(c => c.rank + c.suit).sort();
  assert.deepEqual(after, before);
});

test('sameCard matches by rank+suit', () => {
  assert.equal(sameCard({ rank: 'A', suit: 'S' }, { rank: 'A', suit: 'S' }), true);
  assert.equal(sameCard({ rank: 'A', suit: 'S' }, { rank: 'A', suit: 'H' }), false);
});
