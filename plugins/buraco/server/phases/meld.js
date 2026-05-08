import { isValidSequence } from '../sequence.js';
import { sameCard, isJoker } from '../../../../src/shared/cards/deck.js';

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

export function applyMeldExtend(state, payload, side) {
  if (state.phase !== 'meld') return { error: 'not in meld phase' };
  const { meldIndex, cards = [] } = payload ?? {};
  const meld = state.melds[side]?.[meldIndex];
  if (!meld) return { error: `meld at index ${meldIndex} not found` };

  const hand = state.hands[side];
  for (const c of cards) {
    if (!hand.some(h => sameCard(h, c))) return { error: `card ${c.id} not in hand` };
  }

  // Try appending at high or low end and validate the resulting sequence.
  const candidates = [
    [...meld, ...cards],     // high end
    [...cards, ...meld],     // low end
  ];
  const valid = candidates.find(seq => isValidSequence(seq));
  if (!valid) return { error: 'cards do not extend the sequence' };

  const newHand = hand.filter(h => !cards.some(c => sameCard(c, h)));
  const newSideMelds = state.melds[side].map((m, i) => i === meldIndex ? valid : m);

  return {
    state: {
      ...state,
      hands: { ...state.hands, [side]: newHand },
      melds: { ...state.melds, [side]: newSideMelds },
      lastEvent: { kind: 'extend', side, summary: `${side} extended a meld by ${cards.length}` },
    },
  };
}

export function applyMeldReplaceWild(state, payload, side) {
  if (state.phase !== 'meld') return { error: 'not in meld phase' };
  const { meldIndex, slotIndex, withCard } = payload ?? {};
  const meld = state.melds[side]?.[meldIndex];
  if (!meld) return { error: `meld at index ${meldIndex} not found` };
  const wildCard = meld[slotIndex];
  if (!wildCard) return { error: `slot ${slotIndex} out of range` };

  // The slot is a wild iff it has representsRank set (annotated wild) OR is a joker.
  const isWild = !!wildCard.representsRank || isJoker(wildCard);
  if (!isWild) return { error: 'slot is not a wild' };

  const slotRank = wildCard.representsRank ?? wildCard.rank;
  const slotSuit = wildCard.representsSuit ?? wildCard.suit;
  if (withCard.rank !== slotRank || withCard.suit !== slotSuit) {
    return { error: 'withCard rank/suit must match the slot it replaces' };
  }

  const hand = state.hands[side];
  if (!hand.some(h => sameCard(h, withCard))) {
    return { error: `withCard ${withCard.id} not in hand` };
  }

  // Strip the wild's annotations when returning it to hand.
  const freedWild = { ...wildCard };
  delete freedWild.representsRank;
  delete freedWild.representsSuit;

  const newMeld = meld.map((c, i) => i === slotIndex ? withCard : c);
  const newHand = hand.filter(h => !sameCard(h, withCard)).concat(freedWild);
  const newSideMelds = state.melds[side].map((m, i) => i === meldIndex ? newMeld : m);

  return {
    state: {
      ...state,
      hands: { ...state.hands, [side]: newHand },
      melds: { ...state.melds, [side]: newSideMelds },
      lastEvent: { kind: 'meld', side, summary: `${side} replaced a wild with ${withCard.rank}${withCard.suit}` },
    },
  };
}
