import { applyScore, checkMatchWin } from '../state.js';

// Pure cut: pick a starter, apply nibs if J, transition to pegging.
// No player validation — caller decides who's allowed to trigger it
// (manual cut by non-dealer, or auto-cut after both discards land).
export function performCut(state, rng) {
  const idx = Math.floor(rng() * state.deck.length);
  const starter = state.deck[idx];
  const deck = [...state.deck.slice(0, idx), ...state.deck.slice(idx + 1)];

  let next = { ...state, deck, starter };
  if (starter.rank === 'J') {
    next = applyScore(next, state.dealer, 2); // nibs / "his heels"
  }

  const winner = checkMatchWin(next);
  if (winner) {
    return {
      state: { ...next, phase: 'match-end', winnerSide: winner, endedReason: 'reached-target', activeUserId: null },
      ended: true,
      summary: { kind: 'cut', starter, nibs: state.dealer, matchEnd: true },
    };
  }

  const nonDealer = 1 - state.dealer;
  const nonDealerUserId = nonDealer === 0 ? state.sides.a : state.sides.b;

  return {
    state: {
      ...next,
      phase: 'pegging',
      pegging: {
        running: 0,
        history: [],
        pile: [[], []],
        next: nonDealer,
        lastPlayer: null,
        saidGo: [false, false],
        lastTrick: null,
      },
      activeUserId: nonDealerUserId,
    },
    ended: false,
    summary: { kind: 'cut', starter, nibs: starter.rank === 'J' ? state.dealer : null },
  };
}

// Legacy manual cut — kept so games already in 'cut' phase before the
// auto-cut change can still be advanced via the existing client button.
export function applyCut({ state, player, rng }) {
  if (player !== 1 - state.dealer) {
    return { error: 'only non-dealer may cut' };
  }
  return performCut(state, rng);
}
