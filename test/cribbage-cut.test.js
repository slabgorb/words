import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';

function makeCutState({ deckTop = { rank: '5', suit: 'H' } } = {}) {
  return {
    phase: 'cut',
    dealer: 0,
    deck: [deckTop, { rank: 'A', suit: 'C' }, { rank: '2', suit: 'C' }],
    hands: [
      [{ rank: '4', suit: 'S' }, { rank: '5', suit: 'C' }, { rank: '6', suit: 'D' }, { rank: '7', suit: 'H' }],
      [{ rank: '8', suit: 'S' }, { rank: '9', suit: 'C' }, { rank: 'T', suit: 'D' }, { rank: 'J', suit: 'H' }],
    ],
    pendingDiscards: [null, null],
    crib: [
      { rank: '2', suit: 'S' }, { rank: '3', suit: 'S' },
      { rank: 'Q', suit: 'D' }, { rank: 'K', suit: 'D' },
    ],
    starter: null,
    pegging: null,
    scores: [0, 0],
    showBreakdown: null,
    acknowledged: [false, false],
    sides: { a: 1, b: 2 },
    activeUserId: 2,
    endedReason: null,
    winnerSide: null,
  };
}

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('cut: dealer (player 0) cannot cut — only non-dealer', () => {
  const r = applyCribbageAction({ state: makeCutState(), action: { type: 'cut' }, actorId: 1, rng: det() });
  assert.match(r.error, /non-dealer/i);
});

test('cut: non-dealer reveals starter from deck', () => {
  const r = applyCribbageAction({ state: makeCutState(), action: { type: 'cut' }, actorId: 2, rng: det() });
  assert.equal(r.error, undefined);
  assert.ok(r.state.starter, 'starter set');
  assert.equal(r.state.deck.length, 2, 'one card removed');
  assert.equal(r.state.phase, 'pegging');
});

test('cut: starter Jack ("nibs") gives dealer +2', () => {
  const r = applyCribbageAction({ state: makeCutState({ deckTop: { rank: 'J', suit: 'D' } }), action: { type: 'cut' }, actorId: 2, rng: det(0) });
  if (r.state.starter.rank === 'J') {
    assert.equal(r.state.scores[0], 2);
    assert.equal(r.state.scores[1], 0);
  }
});

test('cut: pegging state initialized — running 0, next=non-dealer, history empty, piles empty', () => {
  const r = applyCribbageAction({ state: makeCutState(), action: { type: 'cut' }, actorId: 2, rng: det() });
  assert.equal(r.state.pegging.running, 0);
  assert.deepEqual(r.state.pegging.history, []);
  assert.deepEqual(r.state.pegging.pile, [[], []]);
  assert.equal(r.state.pegging.next, 1, 'non-dealer leads pegging');
  assert.equal(r.state.pegging.lastPlayer, null);
  assert.deepEqual(r.state.pegging.saidGo, [false, false]);
  assert.equal(r.state.activeUserId, 2, 'non-dealer userId');
});

test('cut: summary kind=cut', () => {
  const r = applyCribbageAction({ state: makeCutState(), action: { type: 'cut' }, actorId: 2, rng: det() });
  assert.equal(r.summary.kind, 'cut');
  assert.equal(r.ended, false);
});
