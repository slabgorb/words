export function applyCut({ state, player, rng }) {
  if (player !== 1 - state.dealer) {
    return { error: 'only non-dealer may cut' };
  }
  const idx = Math.floor(rng() * state.deck.length);
  const starter = state.deck[idx];
  const deck = [...state.deck.slice(0, idx), ...state.deck.slice(idx + 1)];

  const scores = [...state.scores];
  if (starter.rank === 'J') scores[state.dealer] += 2; // nibs / "his heels"

  const nonDealer = 1 - state.dealer;
  const nonDealerUserId = nonDealer === 0 ? state.sides.a : state.sides.b;

  return {
    state: {
      ...state,
      deck,
      starter,
      scores,
      phase: 'pegging',
      pegging: {
        running: 0,
        history: [],
        pile: [[], []],
        next: nonDealer,
        lastPlayer: null,
        saidGo: [false, false],
      },
      activeUserId: nonDealerUserId,
    },
    ended: false,
    summary: { kind: 'cut', starter, nibs: starter.rank === 'J' ? state.dealer : null },
  };
}
