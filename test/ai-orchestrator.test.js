import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { createAiSession, getAiSession } from '../src/server/ai/agent-session.js';
import { createOrchestrator } from '../src/server/ai/orchestrator.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { chooseAction as cribbageChoose } from '../plugins/cribbage/server/ai/cribbage-player.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function setup(llm) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email, friendly_name, color, is_bot, created_at) VALUES ('b@x','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(42) });
  state.activeUserId = botId;
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'hattie' });

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const persona = { id: 'hattie', displayName: 'Hattie', color: '#ec4899', glyph: '♡', systemPrompt: 'you are hattie' };
  const personas = new Map([['hattie', persona]]);
  const adapters = { cribbage: { plugin: cribbagePlugin, chooseAction: cribbageChoose } };
  const orch = createOrchestrator({ db, llm, sse, personas, adapters });

  return { db, gameId, botId, humanId, events, orch };
}

test('orchestrator: happy path — chooses action, applies it, broadcasts banter+update, persists session id', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":"hello dear"}', sessionId: 'sid-A' },
  ]);
  const { db, gameId, botId, events, orch } = setup(llm);

  await orch.runTurn(gameId);

  const types = events.map(e => e.type);
  assert.ok(types.includes('bot_thinking'), 'thinking emitted');
  assert.ok(types.includes('banter'), 'banter emitted');
  assert.ok(types.includes('update'), 'update emitted');
  assert.ok(types.indexOf('banter') < types.indexOf('update'));

  const sess = getAiSession(db, gameId);
  assert.equal(sess.claudeSessionId, 'sid-A');
  assert.equal(sess.stalledAt, null);

  const game = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId);
  const state = JSON.parse(game.state);
  assert.ok(Array.isArray(state.pendingDiscards));
  const botPlayerIdx = state.sides.a === botId ? 0 : 1;
  assert.equal(state.pendingDiscards[botPlayerIdx].length, 2);
});

test('orchestrator: invalid response → retry once → success on retry', async () => {
  const llm = new FakeLlmClient([
    { text: 'I dunno', sessionId: 'sid-B' },
    { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid-B' },
  ]);
  const { db, gameId, events, orch } = setup(llm);
  await orch.runTurn(gameId);
  const sess = getAiSession(db, gameId);
  assert.equal(sess.stalledAt, null, 'not stalled — succeeded on retry');
  assert.ok(events.some(e => e.type === 'banter'));
});

test('orchestrator: two consecutive failures → stall + bot_stalled SSE + game state untouched', async () => {
  const llm = new FakeLlmClient([
    { text: 'nope', sessionId: 'sid-C' },
    { text: 'still nope', sessionId: 'sid-C' },
  ]);
  const { db, gameId, events, orch } = setup(llm);
  const before = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId).state;

  await orch.runTurn(gameId);

  const sess = getAiSession(db, gameId);
  assert.ok(sess.stalledAt > 0);
  assert.equal(sess.stallReason, 'invalid_response');

  const after = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId).state;
  assert.equal(before, after, 'game state unchanged on stall');

  const stalled = events.filter(e => e.type === 'bot_stalled');
  assert.equal(stalled.length, 1);
  assert.equal(stalled[0].payload.reason, 'invalid_response');
  assert.equal(stalled[0].payload.personaId, 'hattie');
});

test('orchestrator: timeout maps to stall reason "timeout"', async () => {
  const { TimeoutError } = await import('../src/server/ai/llm-client.js');
  const llm = new FakeLlmClient([
    { throw: new TimeoutError(30000) },
    { throw: new TimeoutError(30000) },
  ]);
  const { db, gameId, events, orch } = setup(llm);
  await orch.runTurn(gameId);
  const sess = getAiSession(db, gameId);
  assert.equal(sess.stallReason, 'timeout');
  assert.equal(events.find(e => e.type === 'bot_stalled').payload.reason, 'timeout');
});

test('orchestrator: serializes per-game — concurrent runTurn calls do not double-fire', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":"a"}', sessionId: 'sid-D' },
  ]);
  const { gameId, orch, events } = setup(llm);
  await Promise.all([orch.runTurn(gameId), orch.runTurn(gameId)]);
  const banters = events.filter(e => e.type === 'banter');
  assert.equal(banters.length, 1, 'banter fires exactly once');
});

test('orchestrator: clears stall on next successful runTurn', async () => {
  const llm = new FakeLlmClient([
    { text: 'nope', sessionId: 's' }, { text: 'still nope', sessionId: 's' },
    { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 's' },
  ]);
  const { db, gameId, orch } = setup(llm);
  await orch.runTurn(gameId);
  assert.ok(getAiSession(db, gameId).stalledAt > 0);
  await orch.runTurn(gameId);
  assert.equal(getAiSession(db, gameId).stalledAt, null);
});

test('orchestrator: scheduleTurn after _runOnce when bot remains active (instrumented)', async () => {
  let callCount = 0;
  const llm = {
    calls: [],
    async send(args) {
      this.calls.push(args);
      callCount++;
      return { text: '{"moveId":"discard:0,1","banter":"x"}', sessionId: 'sid' };
    },
  };
  const { gameId, orch } = setup(llm);
  await orch.runTurn(gameId);
  assert.equal(callCount, 1);
});

test('orchestrator: bot acts twice in a row when phase advance keeps it active', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-rec-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email, friendly_name, color, is_bot, created_at) VALUES ('b@x','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const botSide = botId === aId ? 'a' : 'b';
  const botPlayerIdx = botSide === 'a' ? 0 : 1;
  const dealerIdx = 1 - botPlayerIdx;

  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(99) });
  state.dealer = dealerIdx;
  state.pendingDiscards[1 - botPlayerIdx] = state.hands[1 - botPlayerIdx].slice(0, 2).map(c => ({...c}));
  state.activeUserId = botId;

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'hattie' });

  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":"first"}', sessionId: 'sid' },
    { text: '{"moveId":"cut","banter":"second"}', sessionId: 'sid' },
  ]);
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push(ev) };
  const persona = { id: 'hattie', displayName: 'Hattie', color: '#ec4899', glyph: '♡', systemPrompt: 'p' };
  const adapters = { cribbage: { plugin: cribbagePlugin, chooseAction: cribbageChoose } };
  const orch = createOrchestrator({ db, llm, sse, personas: new Map([['hattie', persona]]), adapters });

  await orch.runTurn(gameId);

  assert.equal(llm.calls.length, 2, 'orchestrator recursed for the cut phase');
  const banters = events.filter(e => e.type === 'banter').map(e => e.payload.text);
  assert.deepEqual(banters, ['first', 'second']);
});
