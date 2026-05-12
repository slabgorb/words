// Phase 2: cribbage 'show' is a mechanical acknowledge — the orchestrator
// should apply the 'next' action without a blocking LLM call, and only
// then fire an optional banter side-call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { createAiSession, getAiSession } from '../src/server/ai/agent-session.js';
import { createOrchestrator } from '../src/server/ai/orchestrator.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { chooseAction as cribbageChoose, chooseBanter as cribbageBanter } from '../plugins/cribbage/server/ai/cribbage-player.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function buildShowState() {
  const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(42) });
  // Hand-rigged show state: nobody has acked. The bot is expected to
  // auto-ack. State stays in 'show' (waiting on the human) so the
  // orchestrator's auto-action recurse does NOT cascade into discard
  // and try a second LLM call — keeps this test focused on the
  // show-ack mechanics only.
  state.phase = 'show';
  state.acknowledged = [false, false];
  state.activeUserId = null;
  state.showBreakdown = { nonDealer: { total: 0, items: [] }, dealer: { total: 0, items: [] }, crib: { total: 0, items: [] } };
  return state;
}

function setupOrchestrator({ llmResponses, includeBanter = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'crib-show-auto-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email,friendly_name,color,is_bot,created_at) VALUES ('b@x','Bot','#fff',1,?) RETURNING id").get(now).id;
  const state = buildShowState();
  state.sides = { a: humanId, b: botId };

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(humanId, botId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'hattie' });

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const persona = { id: 'hattie', displayName: 'Hattie', color: '#ec4899', glyph: '♡', systemPrompt: 'you are hattie' };
  const personas = new Map([['hattie', persona]]);
  const llm = new FakeLlmClient(llmResponses);
  const adapters = {
    cribbage: includeBanter
      ? { plugin: cribbagePlugin, chooseAction: cribbageChoose, chooseBanter: cribbageBanter }
      : { plugin: cribbagePlugin, chooseAction: cribbageChoose },
  };
  const orch = createOrchestrator({ db, llm, sse, personas, adapters, logger: { warn: () => {}, error: () => {} } });
  return { db, gameId, botId, events, orch, llm };
}

test('show auto-ack: no blocking LLM call for the action, update broadcast immediately', async () => {
  // Provide one response for the side-banter call. If chooseBanter is
  // invoked synchronously the test would see the call happen during
  // runTurn; the assertions below verify it is non-blocking.
  const { db, gameId, botId, events, orch, llm } = setupOrchestrator({
    llmResponses: [{ text: '{"banter":"oh dear, what a hand"}' }],
  });

  await orch.runTurn(gameId);

  // The action applied: bot's acknowledged toggled true; phase stays
  // in 'show' (waiting on the human).
  const game = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId);
  const state = JSON.parse(game.state);
  const botIdx = state.sides.a === botId ? 0 : 1;
  assert.equal(state.phase, 'show');
  assert.equal(state.acknowledged[botIdx], true);
  assert.equal(state.acknowledged[1 - botIdx], false);

  // SSE saw 'update'; no 'bot_thinking' (that's only emitted for
  // LLM-driven chooseAction, not auto-actions).
  const types = events.map(e => e.type);
  assert.ok(types.includes('update'), 'update broadcast');
  assert.ok(!types.includes('bot_thinking'), 'no bot_thinking for auto-action');

  // No stall.
  const sess = getAiSession(db, gameId);
  assert.equal(sess.stalledAt, null);

  // Let the banter side-call resolve (microtask + fake LLM is sync).
  await delay(0);
  // The banter side-call fires asynchronously after the auto-action.
  // FakeLlmClient resolves immediately, so by now the banter event
  // should be on the wire.
  assert.equal(llm.calls.length, 1, 'banter side-call made (one LLM call)');
  assert.ok(events.some(e => e.type === 'banter' && e.payload.text === 'oh dear, what a hand'), 'banter broadcast');
});

test('show auto-ack: banter side-call failure does not surface to the user', async () => {
  // FakeLlmClient with no responses → call throws. Side-call swallows it.
  const { db, gameId, events, orch } = setupOrchestrator({ llmResponses: [] });
  await orch.runTurn(gameId);
  // Update broadcast happened despite the banter side-call failing.
  const types = events.map(e => e.type);
  assert.ok(types.includes('update'));
  // No bot_stalled emitted from the banter side-call.
  assert.ok(!events.some(e => e.type === 'bot_stalled'));
  await delay(0);
  // Still no banter (the call failed), but the action stuck.
  const game = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId);
  assert.equal(JSON.parse(game.state).phase, 'show');
});

test('show auto-ack: adapter without chooseBanter still auto-acks without crashing', async () => {
  const { db, gameId, events, orch, llm } = setupOrchestrator({
    llmResponses: [],
    includeBanter: false,
  });
  await orch.runTurn(gameId);
  const types = events.map(e => e.type);
  assert.ok(types.includes('update'));
  assert.equal(llm.calls.length, 0, 'no LLM call at all when chooseBanter absent');
  const game = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId);
  assert.equal(JSON.parse(game.state).phase, 'show');
});
