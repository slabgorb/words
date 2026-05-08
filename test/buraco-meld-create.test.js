import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMeldCreate } from '../plugins/buraco/server/phases/meld.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

function baseMeldState({ hand }) {
  return {
    phase: 'meld',
    hasDrawn: true,
    currentTurn: 'a',
    hands: { a: hand, b: [] },
    melds: { a: [], b: [] },
    stock: [], discard: [], mortos: { a: [], b: [] }, mortoTaken: { a: false, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null, dealNumber: 1,
  };
}

test('valid create: 3 same-suit consecutive cards from hand', () => {
  const s0 = baseMeldState({ hand: [C('5','H'), C('6','H'), C('7','H'), C('K','S')] });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.hands.a.length, 1);
  assert.equal(r.state.melds.a.length, 1);
  assert.equal(r.state.melds.a[0].length, 3);
});

test('invalid sequence rejected', () => {
  const s0 = baseMeldState({ hand: [C('5','H'), C('6','S'), C('7','H')] });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','S'), C('7','H')] }, 'a');
  assert.match(r.error, /invalid sequence/i);
  assert.equal(r.state, undefined);
});

test('rejected when not all cards are in hand', () => {
  const s0 = baseMeldState({ hand: [C('5','H'), C('6','H')] });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.match(r.error, /not in hand/i);
});

test('rejected when not in meld phase', () => {
  const s0 = { ...baseMeldState({ hand: [C('5','H'), C('6','H'), C('7','H')] }), phase: 'draw', hasDrawn: false };
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.match(r.error, /meld phase/i);
});
