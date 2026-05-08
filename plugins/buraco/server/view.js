import { sideOf } from './state.js';

export function buracoPublicView({ state, viewerId }) {
  const me = sideOf(state, viewerId);
  const sides = ['a', 'b'];

  const hands = {};
  for (const s of sides) {
    hands[s] = me === s ? state.hands[s] : state.hands[s].length;
  }

  return {
    phase: state.phase,
    dealNumber: state.dealNumber,
    currentTurn: state.currentTurn,
    hasDrawn: state.hasDrawn,
    stock: state.stock.length,
    discard: state.discard,
    hands,
    melds: state.melds,
    mortos: { a: state.mortos.a.length, b: state.mortos.b.length },
    mortoTaken: state.mortoTaken,
    scores: state.scores,
    sides: state.sides,
    lastEvent: state.lastEvent,
    winner: state.winner,
  };
}
