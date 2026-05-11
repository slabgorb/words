import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAction } from '../plugins/backgammon/server/ai/backgammon-player.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { InvalidLlmMove, InvalidLlmResponse } from '../src/server/ai/errors.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';

function preRoll() {
  const s = buildInitialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    options: {},
  });
  s.turn.phase = 'pre-roll';
  s.turn.activePlayer = 'a';
  s.activeUserId = 1;
  return s;
}

const persona = { id: 'colonel-pip', displayName: 'Colonel Pip', systemPrompt: 'you are colonel pip' };

test('chooseAction: picks roll, returns action + banter, no sequenceTail', async () => {
  const llm = new FakeLlmClient([{ text: '{"moveId":"roll","banter":"steady"}' }]);
  const r = await chooseAction({ llm, persona, sessionId: null, state: preRoll(), botPlayerIdx: 0 });
  assert.deepEqual(r.action, { type: 'roll' });
  assert.equal(r.banter, 'steady');
  assert.deepEqual(r.sequenceTail, []);
});

test('chooseAction: picks a sequence in moving phase and returns sequenceTail', async () => {
  const state = preRoll();
  state.turn.phase = 'moving';
  state.turn.dice = { values: [5, 3], remaining: [5, 3], throwParams: [] };
  // Pick whichever id is the first legal seq; we know there's at least one.
  const llm = new FakeLlmClient([{ text: '{"moveId":"seq:1","banter":""}' }]);
  const r = await chooseAction({ llm, persona, sessionId: null, state, botPlayerIdx: 0 });
  assert.equal(r.action.type, 'move');
  assert.ok(Array.isArray(r.sequenceTail));
  assert.equal(r.sequenceTail.length, 1);
  assert.equal(r.sequenceTail[0].type, 'move');
});

test('chooseAction: throws InvalidLlmMove for unknown moveId', async () => {
  const llm = new FakeLlmClient([{ text: '{"moveId":"bogus","banter":""}' }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: preRoll(), botPlayerIdx: 0 }),
    InvalidLlmMove,
  );
});

test('chooseAction: throws InvalidLlmResponse for malformed text', async () => {
  const llm = new FakeLlmClient([{ text: 'not json at all' }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: preRoll(), botPlayerIdx: 0 }),
    InvalidLlmResponse,
  );
});

test('chooseAction: throws when no legal moves (e.g. wrong phase)', async () => {
  const state = preRoll();
  state.turn.phase = 'match-end';  // not a phase the adapter handles
  const llm = new FakeLlmClient([]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state, botPlayerIdx: 0 }),
    /no legal moves/,
  );
});
