import { sameCard } from '../cards.js';

export function applyDiscard({ state, action, player }) {
  const cards = action.payload?.cards;
  if (!Array.isArray(cards) || cards.length !== 2) {
    return { error: 'discard requires two cards' };
  }
  if (sameCard(cards[0], cards[1])) {
    return { error: 'duplicate cards in discard' };
  }
  if (state.pendingDiscards[player] != null) {
    return { error: 'already discarded' };
  }
  const hand = state.hands[player];
  const inHand = (c) => hand.some(h => sameCard(h, c));
  if (!inHand(cards[0]) || !inHand(cards[1])) {
    return { error: 'card not in your hand' };
  }

  const pending = [...state.pendingDiscards];
  pending[player] = cards.map(c => ({ ...c }));
  const next = { ...state, pendingDiscards: pending };

  if (pending[0] && pending[1]) {
    // Both submitted — build crib, shrink hands, advance to cut.
    const crib = [...pending[0], ...pending[1]];
    const newHands = state.hands.map((h, i) =>
      h.filter(c => !pending[i].some(d => sameCard(d, c)))
    );
    const nonDealer = 1 - state.dealer;
    const nonDealerUserId = nonDealer === 0 ? state.sides.a : state.sides.b;
    return {
      state: {
        ...next,
        hands: newHands,
        crib,
        pendingDiscards: [null, null],
        phase: 'cut',
        activeUserId: nonDealerUserId,
      },
      ended: false,
      summary: { kind: 'discard' },
    };
  }
  return { state: next, ended: false, summary: { kind: 'discard' } };
}
