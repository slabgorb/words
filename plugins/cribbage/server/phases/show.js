import { scoreHand } from '../scoring/hand.js';
import { checkMatchWin, startNextDeal } from '../state.js';

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

// Tournament order: non-dealer counts first, then dealer's hand, then crib.
// If a player reaches the match target mid-show, later pots don't count
// (this is how "pegged out" works — you stop counting the moment someone
// hits the target). prevScores captures the score before *any* show
// points landed, so the back peg shows the whole show as one slide.
export function enterShow(state) {
  const breakdown = tallyShow(state);
  const target = state.matchTarget ?? 121;
  const nonDealer = 1 - state.dealer;
  const prevScores = state.scores.slice();
  const scores = state.scores.slice();

  scores[nonDealer] = Math.min(scores[nonDealer] + breakdown.nonDealer.total, target);
  if (scores[nonDealer] >= target) {
    return { state: { ...state, showBreakdown: breakdown, scores, prevScores, activeUserId: null } };
  }
  scores[state.dealer] = Math.min(scores[state.dealer] + breakdown.dealer.total, target);
  if (scores[state.dealer] >= target) {
    return { state: { ...state, showBreakdown: breakdown, scores, prevScores, activeUserId: null } };
  }
  scores[state.dealer] = Math.min(scores[state.dealer] + breakdown.crib.total, target);
  return { state: { ...state, showBreakdown: breakdown, scores, prevScores, activeUserId: null } };
}

export function applyShowNext({ state, player, rng }) {
  const acknowledged = state.acknowledged.slice();
  acknowledged[player] = true;
  if (!(acknowledged[0] && acknowledged[1])) {
    return {
      state: { ...state, acknowledged },
      ended: false,
      summary: { kind: 'next', acknowledged: player },
    };
  }

  const winner = checkMatchWin(state);
  if (winner) {
    return {
      state: { ...state, acknowledged, phase: 'match-end', winnerSide: winner, endedReason: 'reached-target', activeUserId: null },
      ended: true,
      summary: { kind: 'next', acknowledged: player, matchEnd: true },
      scoreDelta: { a: state.scores[0], b: state.scores[1] },
    };
  }

  const next = startNextDeal({ ...state, acknowledged }, rng);
  return {
    state: next,
    ended: false,
    summary: { kind: 'next', acknowledged: player, dealNumber: next.dealNumber },
  };
}
