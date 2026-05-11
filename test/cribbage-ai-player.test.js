import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { chooseAction } from '../plugins/cribbage/server/ai/cribbage-player.js';

const CARD = (rank, suit) => ({ rank, suit });

const persona = {
  id: 'hattie',
  displayName: 'Hattie',
  systemPrompt: 'you are hattie',
};

function discardState() {
  return {
    phase: 'discard',
    dealer: 1,
    hands: [[CARD('A','H'), CARD('5','H'), CARD('K','D'), CARD('7','S'), CARD('3','C'), CARD('Q','H')], []],
    scores: [0, 0],
    matchTarget: 121,
    sides: { a: 1, b: 2 },
  };
}

test('chooseAction: returns matching action when LLM picks a valid moveId', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":"oh dear"}', sessionId: 'sid-1' },
  ]);
  const r = await chooseAction({
    llm, persona, sessionId: null,
    state: discardState(), botPlayerIdx: 0,
  });
  assert.equal(r.action.type, 'discard');
  assert.equal(r.action.payload.cards.length, 2);
  assert.equal(r.banter, 'oh dear');
  assert.equal(r.sessionId, 'sid-1');
});

test('chooseAction: passes systemPrompt only on first call (sessionId=null)', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid-1' },
  ]);
  await chooseAction({ llm, persona, sessionId: null, state: discardState(), botPlayerIdx: 0 });
  assert.equal(llm.calls[0].systemPrompt, 'you are hattie');
});

test('chooseAction: omits systemPrompt on resume (sessionId set)', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid-1' },
  ]);
  await chooseAction({ llm, persona, sessionId: 'sid-1', state: discardState(), botPlayerIdx: 0 });
  assert.equal(llm.calls[0].sessionId, 'sid-1');
  assert.equal(llm.calls[0].systemPrompt, null);
});

test('chooseAction: throws InvalidLlmMove when moveId is not in legal moves', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:99,99","banter":"oops"}', sessionId: 'sid-1' },
  ]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: discardState(), botPlayerIdx: 0 }),
    err => err.name === 'InvalidLlmMove' && /discard:99,99/.test(err.message),
  );
});

test('chooseAction: throws InvalidLlmResponse when JSON cannot be parsed', async () => {
  const llm = new FakeLlmClient([
    { text: 'I dunno', sessionId: 'sid-1' },
  ]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: discardState(), botPlayerIdx: 0 }),
    err => err.name === 'InvalidLlmResponse',
  );
});

test('chooseAction: propagates underlying LlmClient errors as-is', async () => {
  const llm = new FakeLlmClient([{ throw: new Error('subprocess died') }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: discardState(), botPlayerIdx: 0 }),
    /subprocess died/,
  );
});

test('chooseAction: pegging phase — picks among playable cards', async () => {
  const state = {
    phase: 'pegging',
    hands: [[CARD('5','H'), CARD('2','D')], []],
    scores: [60, 58],
    matchTarget: 121,
    pegging: { running: 25, history: [], pile: [[],[]], next: 0 },
    sides: { a:1, b:2 },
  };
  const llm = new FakeLlmClient([
    { text: '{"moveId":"play:2D","banter":"a small one"}', sessionId: 'sid-1' },
  ]);
  const r = await chooseAction({ llm, persona, sessionId: null, state, botPlayerIdx: 0 });
  assert.equal(r.action.type, 'play');
  assert.deepEqual(r.action.payload.card, CARD('2','D'));
  assert.equal(r.banter, 'a small one');
});
