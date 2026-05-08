import { sameCard } from '../../../../src/shared/cards/deck.js';
import { isBuracoLimpo, isBuracoSujo } from '../sequence.js';

const OPP = { a: 'b', b: 'a' };

export function applyDiscard(state, payload, side) {
  if (state.phase !== 'meld') return { error: 'not in meld phase' };
  const card = payload?.card;
  if (!card) return { error: 'no card provided' };
  const hand = state.hands[side];
  if (!hand.some(h => sameCard(h, card))) return { error: `card ${card.id} not in hand` };

  let newHand = hand.filter(h => !sameCard(h, card));
  let newDiscard = [...state.discard, card];
  let mortoTaken = state.mortoTaken;
  let mortos = state.mortos;
  let phase = 'draw';
  let summary = `${side} discarded ${card.rank ?? card.kind}`;

  if (newHand.length === 0) {
    if (!mortoTaken[side]) {
      newHand = mortos[side];
      mortos = { ...mortos, [side]: [] };
      mortoTaken = { ...mortoTaken, [side]: true };
      summary += `; took morto`;
    } else {
      const hasBuraco = state.melds[side].some(m => isBuracoLimpo(m) || isBuracoSujo(m));
      if (!hasBuraco) return { error: 'cannot go out: no buraco on the table' };
      phase = 'deal-end';
      summary += `; went out`;
    }
  }

  return {
    state: {
      ...state,
      hands: { ...state.hands, [side]: newHand },
      discard: newDiscard,
      mortos,
      mortoTaken,
      phase,
      currentTurn: phase === 'deal-end' ? state.currentTurn : OPP[side],
      hasDrawn: phase === 'deal-end' ? state.hasDrawn : false,
      lastEvent: { kind: 'discard', side, summary },
    },
  };
}
