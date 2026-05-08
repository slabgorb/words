import { sameCard } from '../../../../src/shared/cards/deck.js';
import { pipValue } from '../values.js';
import { scorePeggingPlay } from '../scoring/pegging.js';
import { enterShow } from './show.js';
import { applyScore, checkMatchWin } from '../state.js';

function endIfWon(stateAfter, summary) {
  const winner = checkMatchWin(stateAfter);
  if (!winner) return null;
  return {
    state: { ...stateAfter, phase: 'match-end', winnerSide: winner, endedReason: 'reached-target', activeUserId: null },
    ended: true,
    summary: { ...summary, matchEnd: true },
  };
}

export function applyPlay({ state, action, player }) {
  const peg = state.pegging;
  if (peg.next !== player) return { error: 'not your turn' };

  const card = action.payload?.card;
  if (!card) return { error: 'card required' };
  const handIdx = state.hands[player].findIndex(h => sameCard(h, card));
  if (handIdx < 0) return { error: 'card not in your hand' };

  const v = pipValue(card);
  if (peg.running + v > 31) {
    return { error: 'play would push running total over 31' };
  }

  const hands = state.hands.map(h => h.slice());
  hands[player].splice(handIdx, 1);
  const history = [...peg.history, card];
  const pile = peg.pile.map(p => p.slice());
  pile[player] = [...pile[player], card];
  const running = peg.running + v;

  const events = scorePeggingPlay(history, running);
  const eventPoints = events.reduce((sum, e) => sum + e.points, 0);

  let nextPeg = {
    ...peg,
    running,
    history,
    pile,
    lastPlayer: player,
    next: 1 - player,
  };

  if (running === 31) {
    nextPeg = {
      ...nextPeg,
      running: 0,
      history: [],
      saidGo: [false, false],
      next: 1 - player,
    };
  }

  let working = applyScore({ ...state, hands, pegging: nextPeg }, player, eventPoints);

  // Pegging score may end the match mid-deal.
  const won = endIfWon(working, { kind: 'play', card, events });
  if (won) return won;

  const handsEmpty = hands[0].length === 0 && hands[1].length === 0;
  if (handsEmpty) {
    let endState = working;
    let endEvents = events;
    if (running !== 31) {
      endState = applyScore(endState, player, 1);
      endEvents = [...events, { kind: 'last-card', points: 1, cards: [card], say: 'last card for one' }];
      const wonAfterLast = endIfWon(endState, { kind: 'play', card, events: endEvents });
      if (wonAfterLast) return wonAfterLast;
    }
    const baseState = { ...endState, pegging: { ...nextPeg, running: 0, history: [], saidGo: [false, false] } };
    const showed = enterShow(baseState);
    const wonAfterShow = endIfWon(showed.state, { kind: 'play', card, events: endEvents });
    if (wonAfterShow) return { ...wonAfterShow, state: { ...wonAfterShow.state, phase: 'match-end' } };
    return {
      state: { ...showed.state, phase: 'show' },
      ended: false,
      summary: { kind: 'play', card, events: endEvents },
    };
  }

  // Auto-go loop
  let loop = autoGoLoop({ state: working, summary: { kind: 'play', card, events } });

  // Win during auto-go (last-card peg)
  const wonAfterGo = endIfWon(loop.state, loop.summary);
  if (wonAfterGo) return wonAfterGo;

  if (loop.state.hands[0].length === 0 && loop.state.hands[1].length === 0) {
    const showed = enterShow({ ...loop.state });
    const wonAfterShow = endIfWon(showed.state, loop.summary);
    if (wonAfterShow) return { ...wonAfterShow, state: { ...wonAfterShow.state, phase: 'match-end' } };
    return {
      state: { ...showed.state, phase: 'show' },
      ended: false,
      summary: loop.summary,
    };
  }

  const nextUserId = loop.state.pegging.next === 0 ? loop.state.sides.a : loop.state.sides.b;
  return {
    state: { ...loop.state, activeUserId: nextUserId },
    ended: false,
    summary: loop.summary,
  };
}

function hasPlayable(hand, running) {
  return hand.some(c => running + pipValue(c) <= 31);
}

function autoGoLoop({ state, summary }) {
  let st = state;
  let events = summary.events.slice();

  while (true) {
    const peg = st.pegging;
    const next = peg.next;
    if (st.hands[next].length > 0 && hasPlayable(st.hands[next], peg.running)) {
      break;
    }
    const saidGo = peg.saidGo.slice();
    saidGo[next] = true;
    const other = 1 - next;
    const otherCanPlay = st.hands[other].length > 0 && hasPlayable(st.hands[other], peg.running);
    if (otherCanPlay) {
      st = { ...st, pegging: { ...peg, saidGo, next: other } };
      continue;
    }
    const lp = peg.lastPlayer;
    st = applyScore(st, lp, 1);
    events.push({ kind: 'last-card', points: 1, cards: peg.history.slice(-1), say: 'last card for one' });
    st = {
      ...st,
      pegging: {
        ...peg,
        running: 0,
        history: [],
        saidGo: [false, false],
        next: 1 - lp,
      },
    };
    if (st.hands[0].length === 0 && st.hands[1].length === 0) break;
  }

  return { state: st, summary: { ...summary, events } };
}
