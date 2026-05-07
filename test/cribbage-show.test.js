import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';
import { tallyShow } from '../plugins/cribbage/server/phases/show.js';

const c = (rank, suit) => ({ rank, suit });

function showState(overrides = {}) {
  return {
    phase: 'show',
    dealer: 0,
    deck: [],
    hands: [[], []],
    pendingDiscards: [null, null],
    crib: [c('2','S'), c('3','D'), c('Q','C'), c('K','H')],
    starter: c('A','H'),
    pegging: { running: 0, history: [], pile: [
      [c('5','H'), c('6','H'), c('7','H'), c('8','H')],   // dealer's played cards
      [c('5','D'), c('6','D'), c('7','D'), c('8','D')],   // non-dealer's played cards
    ], next: 0, lastPlayer: 0, saidGo: [false,false] },
    scores: [3, 5],
    showBreakdown: null,
    acknowledged: [false, false],
    sides: { a: 1, b: 2 },
    activeUserId: null,
    endedReason: null,
    winnerSide: null,
    ...overrides,
  };
}

test('tallyShow: produces breakdown for non-dealer, dealer, crib (in count order)', () => {
  const s = showState();
  const breakdown = tallyShow(s);
  assert.ok(breakdown.nonDealer);
  assert.ok(breakdown.dealer);
  assert.ok(breakdown.crib);
  assert.equal(typeof breakdown.nonDealer.total, 'number');
});

test('show next: first ack does not advance phase', () => {
  const s = { ...showState(), showBreakdown: { nonDealer: { items: [], total: 0 }, dealer: { items: [], total: 0 }, crib: { items: [], total: 0 } } };
  const r = applyCribbageAction({ state: s, action: { type: 'next' }, actorId: 1, rng: () => 0 });
  assert.equal(r.state.phase, 'show');
  assert.deepEqual(r.state.acknowledged, [true, false]);
});

test('show next: both acks → phase=done, ended=true', () => {
  const s = { ...showState(), showBreakdown: { nonDealer: { items: [], total: 0 }, dealer: { items: [], total: 0 }, crib: { items: [], total: 0 } }, acknowledged: [false, true] };
  const r = applyCribbageAction({ state: s, action: { type: 'next' }, actorId: 1, rng: () => 0 });
  assert.equal(r.state.phase, 'done');
  assert.equal(r.ended, true);
  assert.equal(r.state.endedReason, 'deal-complete');
});

test('enterShow: computes breakdown and adds totals to scores', async () => {
  const { enterShow } = await import('../plugins/cribbage/server/phases/show.js');
  const s = showState({ scores: [0, 0] });
  const { state: next } = enterShow(s);
  assert.ok(next.showBreakdown);
  assert.equal(typeof next.showBreakdown.nonDealer.total, 'number');
  const nonDealer = 1 - s.dealer;
  assert.equal(next.scores[nonDealer], next.showBreakdown.nonDealer.total);
  assert.equal(next.scores[s.dealer],
    next.showBreakdown.dealer.total + next.showBreakdown.crib.total);
});
