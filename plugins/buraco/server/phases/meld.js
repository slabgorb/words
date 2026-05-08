import { isValidSequence } from '../sequence.js';
import { sameCard } from '../../../../src/shared/cards/deck.js';

export function applyMeldCreate(state, payload, side) {
  if (state.phase !== 'meld') return { error: 'not in meld phase' };
  const cards = payload?.cards ?? [];
  if (cards.length < 3) return { error: 'meld needs at least 3 cards' };

  const hand = state.hands[side];
  for (const c of cards) {
    if (!hand.some(h => sameCard(h, c))) {
      return { error: `card ${c.id} not in hand` };
    }
  }

  if (!isValidSequence(cards)) return { error: 'invalid sequence' };

  const newHand = hand.filter(h => !cards.some(c => sameCard(c, h)));
  const newMelds = [...state.melds[side], cards];

  return {
    state: {
      ...state,
      hands: { ...state.hands, [side]: newHand },
      melds: { ...state.melds, [side]: newMelds },
      lastEvent: { kind: 'meld', side, summary: `${side} laid down ${cards.length} cards` },
    },
  };
}
