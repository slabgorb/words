import { sequencePoints, isBuracoLimpo, isBuracoSujo } from '../sequence.js';
import { buildInitialState } from '../state.js';

const SCORE_TARGET = 3000;

export function computeDealScore({ melds, handCardsLeft, mortoTaken, wentOut }) {
  let buracoLimpo = 0;
  let buracoSujo = 0;
  let meldPoints = 0;
  for (const m of melds) {
    meldPoints += sequencePoints(m);
    if (isBuracoLimpo(m)) buracoLimpo++;
    else if (isBuracoSujo(m)) buracoSujo++;
  }
  const buracoBonus = buracoLimpo * 200 + buracoSujo * 100;
  const goingOutBonus = wentOut ? 100 : 0;
  const mortoBonus = mortoTaken ? 0 : -100;
  const handPenalty = handCardsLeft === 0 ? 0 : -handCardsLeft;
  const total = meldPoints + buracoBonus + goingOutBonus + mortoBonus + handPenalty;
  return { meldPoints, buracoLimpo, buracoSujo, goingOutBonus, mortoBonus, handPenalty, total };
}

export function applyDealEnd(state, rng) {
  const wentOutSide = state.hands.a.length === 0 ? 'a' : 'b';
  const sides = ['a', 'b'];
  const newScores = { a: { ...state.scores.a }, b: { ...state.scores.b } };
  for (const side of sides) {
    const score = computeDealScore({
      melds: state.melds[side],
      handCardsLeft: state.hands[side].length,
      mortoTaken: state.mortoTaken[side],
      wentOut: side === wentOutSide,
    });
    newScores[side] = {
      total: state.scores[side].total + score.total,
      deals: [...state.scores[side].deals, score],
    };
  }

  if (newScores.a.total >= SCORE_TARGET || newScores.b.total >= SCORE_TARGET) {
    const winner = newScores.a.total > newScores.b.total ? 'a'
      : newScores.b.total > newScores.a.total ? 'b'
      : wentOutSide;
    return {
      state: {
        ...state,
        scores: newScores,
        phase: 'game-end',
        winner,
        lastEvent: { kind: 'deal-end', side: wentOutSide, summary: `${winner} wins ${newScores[winner].total}–${newScores[winner === 'a' ? 'b' : 'a'].total}` },
      },
    };
  }

  const fresh = buildInitialState({
    participants: [{ userId: 0, side: 'a' }, { userId: 0, side: 'b' }],
    rng,
  });
  return {
    state: {
      ...state,
      phase: 'draw',
      dealNumber: state.dealNumber + 1,
      currentTurn: wentOutSide === 'a' ? 'b' : 'a',
      hasDrawn: false,
      stock: fresh.stock,
      discard: fresh.discard,
      hands: fresh.hands,
      mortos: fresh.mortos,
      mortoTaken: { a: false, b: false },
      melds: { a: [], b: [] },
      scores: newScores,
      lastEvent: { kind: 'deal-end', side: wentOutSide, summary: `deal ${state.dealNumber} ended` },
    },
  };
}
