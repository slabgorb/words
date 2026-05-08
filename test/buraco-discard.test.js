import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscard } from '../plugins/buraco/server/phases/discard.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

function st({ hand, melds = [], mortoTaken = false }) {
  return {
    phase: 'meld', hasDrawn: true, currentTurn: 'a',
    hands: { a: hand, b: [] },
    melds: { a: melds, b: [] },
    stock: [], discard: [], mortos: { a: [], b: [] },
    mortoTaken: { a: mortoTaken, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null, dealNumber: 1,
  };
}

test('valid discard: card to top of pile, phase=draw, swap turn, hasDrawn=false', () => {
  const s0 = st({ hand: [C('5','H'), C('K','S')] });
  const r = applyDiscard(s0, { card: C('K','S') }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.discard[r.state.discard.length - 1].id, 'S-K-0');
  assert.equal(r.state.phase, 'draw');
  assert.equal(r.state.currentTurn, 'b');
  assert.equal(r.state.hasDrawn, false);
});

test('discard card not in hand rejected', () => {
  const s0 = st({ hand: [C('5','H')] });
  const r = applyDiscard(s0, { card: C('K','S') }, 'a');
  assert.match(r.error, /not in hand/i);
});

test('discard outside meld phase rejected', () => {
  const s0 = { ...st({ hand: [C('5','H')] }), phase: 'draw' };
  const r = applyDiscard(s0, { card: C('5','H') }, 'a');
  assert.match(r.error, /meld phase/i);
});

test('discard that empties hand AND morto taken AND buraco → going out', () => {
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  const s0 = st({ hand: [C('K','D')], melds: [buraco], mortoTaken: true });
  const r = applyDiscard(s0, { card: C('K','D') }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.phase, 'deal-end');
});

test('discard that empties hand without buraco → error', () => {
  const s0 = st({ hand: [C('K','D')], melds: [], mortoTaken: true });
  const r = applyDiscard(s0, { card: C('K','D') }, 'a');
  assert.match(r.error, /cannot go out/i);
});

test('discard that empties hand, morto not taken → auto-pickup, but turn still ends', () => {
  const s0 = st({ hand: [C('K','D')], melds: [], mortoTaken: false });
  const s1 = { ...s0, mortos: { a: [C('A','C'), C('2','C'), C('3','C')], b: [] } };
  const r = applyDiscard(s1, { card: C('K','D') }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.mortoTaken.a, true);
  assert.equal(r.state.hands.a.length, 3);
  assert.equal(r.state.phase, 'draw');
  assert.equal(r.state.currentTurn, 'b');
});
