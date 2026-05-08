import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('full deal: deterministic seed → discard, cut, pegging through end, show, both ack → done', () => {
  let state = buildInitialState({ participants, rng: det(7) });
  let r = applyCribbageAction({ state, action: { type: 'discard', payload: { cards: state.hands[0].slice(0,2) } }, actorId: 1, rng: det(7) });
  assert.equal(r.error, undefined);
  state = r.state;
  r = applyCribbageAction({ state, action: { type: 'discard', payload: { cards: state.hands[1].slice(0,2) } }, actorId: 2, rng: det(7) });
  assert.equal(r.error, undefined);
  state = r.state;
  assert.equal(state.phase, 'cut');

  r = applyCribbageAction({ state, action: { type: 'cut' }, actorId: 2, rng: det(7) });
  assert.equal(r.error, undefined);
  state = r.state;
  assert.equal(state.phase, 'pegging');

  let safety = 64;
  while (state.phase === 'pegging' && safety-- > 0) {
    const pi = state.pegging.next;
    const actorId = pi === 0 ? 1 : 2;
    const hand = state.hands[pi];
    const playable = hand.find(c => state.pegging.running + ({A:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,T:10,J:10,Q:10,K:10}[c.rank]) <= 31);
    if (!playable) {
      throw new Error('legal play missing — auto-go should have advanced state');
    }
    r = applyCribbageAction({ state, action: { type: 'play', payload: { card: playable } }, actorId, rng: det(7) });
    assert.equal(r.error, undefined);
    state = r.state;
  }
  assert.equal(state.phase, 'show');
  assert.ok(state.showBreakdown);
  assert.ok(state.scores[0] >= 0);
  assert.ok(state.scores[1] >= 0);

  r = applyCribbageAction({ state, action: { type: 'next' }, actorId: 1, rng: det(7) });
  state = r.state;
  r = applyCribbageAction({ state, action: { type: 'next' }, actorId: 2, rng: det(7) });
  state = r.state;
  // Multi-deal match: second ack starts the next deal (or ends the match
  // if someone hit matchTarget). With low scores, we expect a fresh deal.
  if (state.scores[0] >= state.matchTarget || state.scores[1] >= state.matchTarget) {
    assert.equal(state.phase, 'match-end');
    assert.equal(r.ended, true);
  } else {
    assert.equal(state.phase, 'discard', 'next deal begins');
    assert.equal(state.dealer, 1, 'dealer rotates');
    assert.equal(state.dealNumber, 2);
  }
});
