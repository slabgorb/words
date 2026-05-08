import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';

const c = (rank, suit = 'S', deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

function pegState(overrides = {}) {
  return {
    phase: 'pegging',
    dealer: 0,
    deck: [],
    hands: [
      [c('5','C'), c('6','C'), c('7','C'), c('8','C')],
      [c('5','D'), c('6','D'), c('7','D'), c('8','D')],
    ],
    pendingDiscards: [null, null],
    crib: [c('2','S'), c('3','S'), c('Q','D'), c('K','D')],
    starter: c('A','H'),
    pegging: {
      running: 0, history: [], pile: [[], []],
      next: 1, lastPlayer: null, saidGo: [false, false],
    },
    scores: [0, 0],
    showBreakdown: null,
    acknowledged: [false, false],
    sides: { a: 1, b: 2 },
    activeUserId: 2,
    endedReason: null,
    winnerSide: null,
    ...overrides,
  };
}

const det = () => () => 0.42;

test('play: rejects when not actor turn', () => {
  const r = applyCribbageAction({ state: pegState(), action: { type: 'play', payload: { card: c('5','C') } }, actorId: 1, rng: det() });
  assert.match(r.error, /not your turn/i);
});

test('play: rejects card not in actor hand', () => {
  const r = applyCribbageAction({ state: pegState(), action: { type: 'play', payload: { card: c('K','S') } }, actorId: 2, rng: det() });
  assert.match(r.error, /not in your hand/i);
});

test('play: rejects card that would push running over 31', () => {
  const s = pegState({
    pegging: { running: 28, history: [c('K','S'), c('K','H'), c('8','C')], pile: [[c('K','S'), c('8','C')], [c('K','H')]], next: 1, lastPlayer: 0, saidGo: [false,false] },
    hands: [[c('A','C'),c('A','D'),c('A','H')],[c('5','D'),c('5','H')]],
  });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('5','D') } }, actorId: 2, rng: det() });
  assert.match(r.error, /over 31/i);
});

test('play: legal play removes card from hand, appends to history, updates running', () => {
  const s = pegState();
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('8','D') } }, actorId: 2, rng: det() });
  assert.equal(r.error, undefined);
  assert.equal(r.state.pegging.running, 8);
  assert.equal(r.state.pegging.history.length, 1);
  assert.equal(r.state.pegging.pile[1].length, 1);
  assert.equal(r.state.hands[1].length, 3);
  assert.equal(r.state.pegging.next, 0);
  assert.equal(r.state.activeUserId, 1);
});

test('play: hitting 15 scores +2', () => {
  const s = pegState({
    pegging: { running: 7, history: [c('7','S')], pile: [[],[c('7','S')]], next: 0, lastPlayer: 1, saidGo: [false,false] },
  });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('8','C') } }, actorId: 1, rng: det() });
  assert.equal(r.state.scores[0], 2);
});

test('play: hitting 31 scores +2 and resets run', () => {
  const s = pegState({
    pegging: { running: 21, history: [c('K','S'), c('J','C')], pile: [[c('J','C')],[c('K','S')]], next: 1, lastPlayer: 0, saidGo: [false,false] },
    hands: [[c('A','C')],[c('T','D'),c('5','D')]],
  });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('T','D') } }, actorId: 2, rng: det() });
  assert.equal(r.state.scores[1], 2);
  assert.equal(r.state.pegging.running, 0);
  assert.deepEqual(r.state.pegging.history, []);
  assert.deepEqual(r.state.pegging.saidGo, [false, false]);
});

test('play: auto-go when next player has no playable card; opponent gets +1 last-card on run-end', () => {
  const s2 = pegState({
    pegging: { running: 22, history: [c('K','S'), c('Q','C'), c('2','D')], pile: [[c('K','S'), c('2','D')],[c('Q','C')]], next: 1, lastPlayer: 0, saidGo: [false,false] },
    hands: [[c('Q','D')],[c('8','D')]],
  });
  const r2 = applyCribbageAction({ state: s2, action: { type: 'play', payload: { card: c('8','D') } }, actorId: 2, rng: det() });
  assert.equal(r2.state.scores[1], 1, 'last-card +1 to player 1');
  assert.deepEqual(r2.state.pegging.saidGo, [false, false], 'reset on run-end');
  assert.equal(r2.state.pegging.running, 0);
});

test('play: end-of-pegging when both hands empty → advance to show', () => {
  const s = pegState({
    pegging: { running: 4, history: [c('4','D')], pile: [[],[c('4','D')]], next: 0, lastPlayer: 1, saidGo: [false,false] },
    hands: [[c('A','C')],[]],
  });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('A','C') } }, actorId: 1, rng: det() });
  assert.ok(r.summary.events.some(e => e.kind === 'last-card'), 'last-card event fires');
  assert.equal(r.state.phase, 'show');
});

test('play: summary kind=play with score events', () => {
  const s = pegState({ pegging: { running: 7, history: [c('7','S')], pile: [[],[c('7','S')]], next: 0, lastPlayer: 1, saidGo: [false,false] } });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('8','C') } }, actorId: 1, rng: det() });
  assert.equal(r.summary.kind, 'play');
  assert.ok(Array.isArray(r.summary.events));
  assert.ok(r.summary.events.some(e => e.kind === 'fifteen'));
});
