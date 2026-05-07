import { scoreHand } from '../scoring/hand.js';

function handFromPile(pile) {
  return pile.slice();
}

export function tallyShow(state) {
  const nonDealer = 1 - state.dealer;
  const ndHand = handFromPile(state.pegging.pile[nonDealer]);
  const dHand = handFromPile(state.pegging.pile[state.dealer]);
  const ndScore = scoreHand(ndHand, state.starter, { isCrib: false });
  const dScore = scoreHand(dHand, state.starter, { isCrib: false });
  const cribScore = scoreHand(state.crib.slice(0, 4), state.starter, { isCrib: true });
  return {
    nonDealer: ndScore,
    dealer: dScore,
    crib: cribScore,
  };
}

export function enterShow(state) {
  const breakdown = tallyShow(state);
  const scores = [...state.scores];
  const nonDealer = 1 - state.dealer;
  scores[nonDealer] += breakdown.nonDealer.total;
  scores[state.dealer] += breakdown.dealer.total;
  scores[state.dealer] += breakdown.crib.total;
  return {
    state: {
      ...state,
      showBreakdown: breakdown,
      scores,
      activeUserId: null,
    },
  };
}

export function applyShowNext({ state, player }) {
  const acknowledged = state.acknowledged.slice();
  acknowledged[player] = true;
  if (acknowledged[0] && acknowledged[1]) {
    const scoreDelta = {
      a: state.scores[0] - 0,
      b: state.scores[1] - 0,
    };
    return {
      state: {
        ...state,
        acknowledged,
        phase: 'done',
        endedReason: 'deal-complete',
        winnerSide: null,
      },
      ended: true,
      summary: { kind: 'next', acknowledged: player },
      scoreDelta,
    };
  }
  return {
    state: { ...state, acknowledged },
    ended: false,
    summary: { kind: 'next', acknowledged: player },
  };
}
