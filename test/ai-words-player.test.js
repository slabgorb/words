import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseAction } from '../plugins/words/server/ai/words-player.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { InvalidLlmMove, InvalidLlmResponse } from '../src/server/ai/errors.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function state() {
  const s = buildInitialState({
    participants: [{userId:1,side:'a'},{userId:2,side:'b'}],
    rng: det(),
  });
  s.racks.a = ['C','A','T','S','D','O','G'];
  s.activeUserId = 1;
  return s;
}

const persona = { id: 'samantha', displayName: 'Samantha', systemPrompt: 'you are samantha' };

test('chooseAction: picks the slot named in the LLM response', async () => {
  // We don't know which slots will appear without running the engine, so
  // echo back whichever id appears first in the prompt — same trick the
  // backgammon test uses.
  const llm = {
    send: async ({ prompt }) => {
      const m = prompt.match(/^ {2}([a-z-]+):/m);
      return { text: `{"moveId":"${m[1]}","banter":"good"}` };
    },
  };
  const r = await chooseAction({ llm, persona, sessionId: null, state: state(), botPlayerIdx: 0 });
  assert.ok(['move','pass','swap'].includes(r.action.type));
  assert.equal(r.banter, 'good');
});

test('chooseAction: throws InvalidLlmMove for unknown moveId', async () => {
  const llm = new FakeLlmClient([{ text: '{"moveId":"bogus","banter":""}' }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: state(), botPlayerIdx: 0 }),
    InvalidLlmMove,
  );
});

test('chooseAction: throws InvalidLlmResponse for malformed text', async () => {
  const llm = new FakeLlmClient([{ text: 'not json at all' }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: state(), botPlayerIdx: 0 }),
    InvalidLlmResponse,
  );
});

test('chooseAction: returns sessionId echoed from llm.send result', async () => {
  const llm = {
    send: async ({ prompt }) => {
      const m = prompt.match(/^ {2}([a-z-]+):/m);
      return { text: `{"moveId":"${m[1]}","banter":""}`, sessionId: 'sess-123' };
    },
  };
  const r = await chooseAction({ llm, persona, sessionId: null, state: state(), botPlayerIdx: 0 });
  assert.equal(r.sessionId, 'sess-123');
});
