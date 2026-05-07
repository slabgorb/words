import { sameCard, pipValue } from '../cards.js';
import { scorePeggingPlay } from '../scoring/pegging.js';
import { enterShow } from './show.js';

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

  // Apply play
  const hands = state.hands.map(h => h.slice());
  hands[player].splice(handIdx, 1);
  const history = [...peg.history, card];
  const pile = peg.pile.map(p => p.slice());
  pile[player] = [...pile[player], card];
  const running = peg.running + v;

  // Score the play
  const events = scorePeggingPlay(history, running);
  const scores = [...state.scores];
  for (const e of events) scores[player] += e.points;

  let nextPeg = {
    ...peg,
    running,
    history,
    pile,
    lastPlayer: player,
    next: 1 - player,
  };

  // 31 → reset run
  if (running === 31) {
    nextPeg = {
      ...nextPeg,
      running: 0,
      history: [],
      saidGo: [false, false],
      next: 1 - player,
    };
  }

  // End-of-pegging if both hands empty
  const handsEmpty = hands[0].length === 0 && hands[1].length === 0;
  if (handsEmpty) {
    if (running !== 31) {
      // Award last-card +1
      scores[player] += 1;
      events.push({ kind: 'last-card', points: 1, cards: [card], say: 'last card for one' });
    }
    const baseState = { ...state, hands, pegging: { ...nextPeg, running: 0, history: [], saidGo: [false, false] }, scores };
    const showed = enterShow(baseState);
    return {
      state: { ...showed.state, phase: 'show' },
      ended: false,
      summary: { kind: 'play', card, events },
    };
  }

  // Auto-go loop: while next player has no legal card, mark goes; on
  // both-go, end the run with last-card +1 to lastPlayer.
  let working = { state: { ...state, hands, pegging: nextPeg, scores }, summary: { kind: 'play', card, events } };
  working = autoGoLoop(working);

  // Check end-of-pegging again after auto-go (run reset may have emptied things differently)
  if (working.state.hands[0].length === 0 && working.state.hands[1].length === 0) {
    const showed = enterShow({ ...working.state });
    return {
      state: { ...showed.state, phase: 'show' },
      ended: false,
      summary: working.summary,
    };
  }

  // Set activeUserId from peg.next
  const nextUserId = working.state.pegging.next === 0 ? working.state.sides.a : working.state.sides.b;
  return {
    state: { ...working.state, activeUserId: nextUserId },
    ended: false,
    summary: working.summary,
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
    // mark go for next player
    const saidGo = peg.saidGo.slice();
    saidGo[next] = true;
    const other = 1 - next;
    const otherCanPlay = st.hands[other].length > 0 && hasPlayable(st.hands[other], peg.running);
    if (otherCanPlay) {
      st = { ...st, pegging: { ...peg, saidGo, next: other } };
      continue;
    }
    // both can't play OR opponent has no cards: end the run
    const lp = peg.lastPlayer;
    const scores = [...st.scores];
    scores[lp] += 1;
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
      scores,
    };
    if (st.hands[0].length === 0 && st.hands[1].length === 0) break;
  }

  return { state: st, summary: { ...summary, events } };
}
