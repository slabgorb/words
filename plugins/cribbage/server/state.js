import { buildDeck, shuffle } from './cards.js';

export function buildInitialState({ participants, rng }) {
  const a = participants.find(p => p.side === 'a').userId;
  const b = participants.find(p => p.side === 'b').userId;

  const deck = shuffle(buildDeck(), rng);
  const hands = [deck.slice(0, 6), deck.slice(6, 12)];
  const remaining = deck.slice(12);

  return {
    phase: 'discard',
    dealer: 0,
    deck: remaining,
    hands,
    pendingDiscards: [null, null],
    crib: [],
    starter: null,
    pegging: null,
    scores: [0, 0],
    showBreakdown: null,
    acknowledged: [false, false],
    sides: { a, b },
    activeUserId: null, // simultaneous discard phase
    endedReason: null,
    winnerSide: null,
  };
}

export function playerIndex(state, userId) {
  if (state.sides.a === userId) return 0;
  if (state.sides.b === userId) return 1;
  return -1;
}
