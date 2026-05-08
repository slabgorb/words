import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMeldCreate } from '../plugins/buraco/server/phases/meld.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

function st({ hand, melds = [], mortoTaken = false, morto = [] }) {
  return {
    phase: 'meld', hasDrawn: true, currentTurn: 'a',
    hands: { a: hand, b: [] },
    melds: { a: melds, b: [] },
    stock: [], discard: [],
    mortos: { a: morto, b: [] },
    mortoTaken: { a: mortoTaken, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null, dealNumber: 1,
  };
}

test('hand empties via meld and morto not taken → auto-pickup; phase still meld; still side a', () => {
  const morto = [C('A','S'), C('2','S'), C('3','S')];
  const s0 = st({
    hand: [C('5','H'), C('6','H'), C('7','H')],
    morto,
    mortoTaken: false,
  });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.mortoTaken.a, true);
  assert.equal(r.state.mortos.a.length, 0);
  assert.equal(r.state.hands.a.length, morto.length);
  assert.equal(r.state.phase, 'meld');
});

test('hand empties via meld, morto taken, has buraco → phase=deal-end (going out)', () => {
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  const s0 = st({
    hand: [C('5','H'), C('6','H'), C('7','H')],
    melds: [buraco],
    mortoTaken: true,
  });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.phase, 'deal-end');
});

test('hand empties via meld, morto taken, NO buraco → error (cannot go out)', () => {
  const s0 = st({
    hand: [C('5','H'), C('6','H'), C('7','H')],
    melds: [],
    mortoTaken: true,
  });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.match(r.error, /cannot go out|no buraco/i);
});
