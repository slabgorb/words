import { buildDeck, shuffle } from '../../../src/shared/cards/deck.js';

export function buildInitialState({ participants, rng }) {
  const deck = shuffle(buildDeck({ decks: 2, jokers: 4 }), rng);
  const hands = { a: deck.splice(0, 11), b: deck.splice(0, 11) };
  const mortos = { a: deck.splice(0, 11), b: deck.splice(0, 11) };
  const discard = [deck.pop()];
  const stock = deck;
  const a = participants.find(p => p.side === 'a').userId;
  const b = participants.find(p => p.side === 'b').userId;

  return {
    phase: 'draw',
    dealNumber: 1,
    currentTurn: 'a',
    hasDrawn: false,
    stock,
    discard,
    hands,
    melds: { a: [], b: [] },
    mortos,
    mortoTaken: { a: false, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    sides: { a, b },
    lastEvent: null,
    winner: null,
  };
}

export function sideOf(state, userId) {
  if (state.sides.a === userId) return 'a';
  if (state.sides.b === userId) return 'b';
  return null;
}
