import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMeldReplaceWild } from '../plugins/buraco/server/phases/meld.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });
const J = (i, color) => ({ id: `jk-${i}`, kind: 'joker', index: i, color });
const W = (card, r, s) => ({ ...card, representsRank: r, representsSuit: s });

function baseStateWithMeld({ hand, meld }) {
  return {
    phase: 'meld', hasDrawn: true, currentTurn: 'a',
    hands: { a: hand, b: [] },
    melds: { a: [meld], b: [] },
    stock: [], discard: [], mortos: { a: [], b: [] }, mortoTaken: { a: false, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null, dealNumber: 1,
  };
}

test('valid replaceWild: natural in, wild back to hand', () => {
  const meld = [C('5','H'), W(J(0,'red'),'6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('6','H')], meld });
  const r = applyMeldReplaceWild(s0, { meldIndex: 0, slotIndex: 1, withCard: C('6','H') }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.melds.a[0][1].rank, '6');
  assert.equal(r.state.melds.a[0][1].suit, 'H');
  assert.equal(r.state.hands.a.length, 1);
  assert.equal(r.state.hands.a[0].id, 'jk-0');
  assert.equal(r.state.hands.a[0].representsRank, undefined);
  assert.equal(r.state.hands.a[0].representsSuit, undefined);
});

test('replaceWild rejected when slot is not a wild', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('6','H',1)], meld });
  const r = applyMeldReplaceWild(s0, { meldIndex: 0, slotIndex: 1, withCard: C('6','H',1) }, 'a');
  assert.match(r.error, /not a wild/i);
});

test('replaceWild rejected when withCard rank doesn\'t match slot', () => {
  const meld = [C('5','H'), W(J(0,'red'),'6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('9','H')], meld });
  const r = applyMeldReplaceWild(s0, { meldIndex: 0, slotIndex: 1, withCard: C('9','H') }, 'a');
  assert.match(r.error, /rank|match/i);
});

test('replaceWild rejected when withCard not in hand', () => {
  const meld = [C('5','H'), W(J(0,'red'),'6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [], meld });
  const r = applyMeldReplaceWild(s0, { meldIndex: 0, slotIndex: 1, withCard: C('6','H') }, 'a');
  assert.match(r.error, /not in hand/i);
});
