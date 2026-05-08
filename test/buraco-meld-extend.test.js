import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMeldExtend } from '../plugins/buraco/server/phases/meld.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

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

test('extend high end of a sequence', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('8','H')], meld });
  const r = applyMeldExtend(s0, { meldIndex: 0, cards: [C('8','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.melds.a[0].length, 4);
  assert.equal(r.state.hands.a.length, 0);
});

test('extend low end of a sequence', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('4','H')], meld });
  const r = applyMeldExtend(s0, { meldIndex: 0, cards: [C('4','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.melds.a[0].length, 4);
});

test('extend with discontiguous card rejected', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('9','H')], meld });
  const r = applyMeldExtend(s0, { meldIndex: 0, cards: [C('9','H')] }, 'a');
  assert.match(r.error, /sequence|extend/i);
});

test('extend wrong-suit card rejected', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('8','S')], meld });
  const r = applyMeldExtend(s0, { meldIndex: 0, cards: [C('8','S')] }, 'a');
  assert.match(r.error, /suit|sequence/i);
});

test('extend nonexistent meld rejected', () => {
  const s0 = baseStateWithMeld({ hand: [C('8','H')], meld: [C('5','H'), C('6','H'), C('7','H')] });
  const r = applyMeldExtend(s0, { meldIndex: 5, cards: [C('8','H')] }, 'a');
  assert.match(r.error, /meld.*not found|index/i);
});
