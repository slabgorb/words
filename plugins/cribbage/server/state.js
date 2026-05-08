import { buildDeck, shuffle } from './cards.js';

const DEFAULT_MATCH_TARGET = 121;

export function buildInitialState({ participants, rng }) {
  const a = participants.find(p => p.side === 'a').userId;
  const b = participants.find(p => p.side === 'b').userId;

  const deck = shuffle(buildDeck(), rng);
  const hands = [deck.slice(0, 6), deck.slice(6, 12)];
  const remaining = deck.slice(12);

  // Coin flip for the opening dealer. Cribbage tradition is "low card
  // cuts the deck deals first" — a coin flip is the digital analogue.
  const openingDealer = rng() < 0.5 ? 0 : 1;

  return {
    matchTarget: DEFAULT_MATCH_TARGET,
    dealNumber: 1,
    phase: 'discard',
    dealer: openingDealer,
    deck: remaining,
    hands,
    pendingDiscards: [null, null],
    crib: [],
    starter: null,
    pegging: null,
    scores: [0, 0],
    prevScores: [0, 0],
    showBreakdown: null,
    acknowledged: [false, false],
    sides: { a, b },
    activeUserId: null,
    endedReason: null,
    winnerSide: null,
  };
}

export function playerIndex(state, userId) {
  if (state.sides.a === userId) return 0;
  if (state.sides.b === userId) return 1;
  return -1;
}

// Single source of truth for score mutations. Captures the pre-mutation
// score into prevScores[side] so the back peg renders at the position
// the front peg occupied immediately before this scoring event. Caps the
// score at matchTarget so the peg never overshoots the game hole.
export function applyScore(state, side, points) {
  if (!points) return state;
  const target = state.matchTarget ?? DEFAULT_MATCH_TARGET;
  const prev = state.prevScores ?? [0, 0];
  const prevScores = prev.slice();
  prevScores[side] = state.scores[side];
  const scores = state.scores.slice();
  scores[side] = Math.min(state.scores[side] + points, target);
  return { ...state, scores, prevScores };
}

export function checkMatchWin(state) {
  const target = state.matchTarget ?? DEFAULT_MATCH_TARGET;
  if (state.scores[0] >= target) return 'a';
  if (state.scores[1] >= target) return 'b';
  return null;
}

// Re-deals for the next deal of an ongoing match. Rotates dealer,
// reshuffles, deals 6 cards each, resets per-deal state. Scores and
// match progress (matchTarget, dealNumber++, prevScores) are preserved.
export function startNextDeal(state, rng) {
  const deck = shuffle(buildDeck(), rng);
  const hands = [deck.slice(0, 6), deck.slice(6, 12)];
  const remaining = deck.slice(12);
  return {
    ...state,
    dealNumber: state.dealNumber + 1,
    phase: 'discard',
    dealer: 1 - state.dealer,
    deck: remaining,
    hands,
    pendingDiscards: [null, null],
    crib: [],
    starter: null,
    pegging: null,
    showBreakdown: null,
    acknowledged: [false, false],
    activeUserId: null,
  };
}
