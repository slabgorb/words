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

test('orchestrator: happy path — chooses action, applies it, broadcasts banter+update', async () => {
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

test('orchestrator: bot acts twice in a row when discard auto-cuts into a pegging lead', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-rec-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email, friendly_name, color, is_bot, created_at) VALUES ('b@x','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const botSide = botId === aId ? 'a' : 'b';
  const botPlayerIdx = botSide === 'a' ? 0 : 1;
  const dealerIdx = 1 - botPlayerIdx;

  // Bot is non-dealer, so after auto-cut the bot leads pegging and the
  // orchestrator should recurse once to make the bot play its first card.
  // Hand-craft hands so we know exactly which card the bot will play.
  const botHand = [
    { id: 'C-A-0', rank: 'A', suit: 'C', deckIndex: 0 },
    { id: 'C-2-0', rank: '2', suit: 'C', deckIndex: 0 },
    { id: 'C-3-0', rank: '3', suit: 'C', deckIndex: 0 },
    { id: 'C-4-0', rank: '4', suit: 'C', deckIndex: 0 },
    { id: 'C-5-0', rank: '5', suit: 'C', deckIndex: 0 },
    { id: 'C-6-0', rank: '6', suit: 'C', deckIndex: 0 },
  ];
  const humanHand = [
    { id: 'D-A-0', rank: 'A', suit: 'D', deckIndex: 0 },
    { id: 'D-2-0', rank: '2', suit: 'D', deckIndex: 0 },
    { id: 'D-3-0', rank: '3', suit: 'D', deckIndex: 0 },
    { id: 'D-4-0', rank: '4', suit: 'D', deckIndex: 0 },
    { id: 'D-5-0', rank: '5', suit: 'D', deckIndex: 0 },
    { id: 'D-6-0', rank: '6', suit: 'D', deckIndex: 0 },
  ];
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(99) });
  state.dealer = dealerIdx;
  state.hands = botPlayerIdx === 0 ? [botHand, humanHand] : [humanHand, botHand];
  state.pendingDiscards[1 - botPlayerIdx] = humanHand.slice(0, 2).map(c => ({...c}));
  state.activeUserId = botId;
  // Pad the deck with non-J cards so auto-cut never grants nibs (which
  // would end the match in a contrived 121-target scenario).
  state.deck = [{ id: 'S-7-0', rank: '7', suit: 'S', deckIndex: 0 }];

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'hattie' });

  // Bot discards C-A and C-2 (indexes 0,1); pegging hand becomes 3,4,5,6 of clubs.
  // First card the bot can lead with: any of those — we mock 'play:3C'.
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":"first"}', sessionId: 'sid' },
    { text: '{"moveId":"play:3C","banter":"second"}', sessionId: 'sid' },
  ]);
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push(ev) };
  const persona = { id: 'hattie', displayName: 'Hattie', color: '#ec4899', glyph: '♡', systemPrompt: 'p' };
  const adapters = { cribbage: { plugin: cribbagePlugin, chooseAction: cribbageChoose } };
  const orch = createOrchestrator({ db, llm, sse, personas: new Map([['hattie', persona]]), adapters });

  await orch.runTurn(gameId);

  assert.equal(llm.calls.length, 2, 'orchestrator recursed for the pegging lead after auto-cut');
  const banters = events.filter(e => e.type === 'banter').map(e => e.payload.text);
  assert.deepEqual(banters, ['first', 'second']);
});

test('orchestrator: auto-executes initial-roll without an LLM call', async () => {
  const backgammonPlugin = (await import('../plugins/backgammon/plugin.js')).default;
  const { chooseAction } = await import('../plugins/backgammon/server/ai/backgammon-player.js');
  const { buildInitialState: buildBgState } = await import('../plugins/backgammon/server/state.js');

  const dir = mkdtempSync(join(tmpdir(), 'orch-bg-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email,friendly_name,color,is_bot,created_at) VALUES ('b','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];

  const state = buildBgState({ participants });
  state.turn.phase = 'initial-roll';
  state.activeUserId = botId;

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'backgammon', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'colonel-pip' });

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const persona = { id: 'colonel-pip', displayName: 'Colonel Pip', color: '#445566', glyph: 'A', systemPrompt: 'x' };
  const personas = new Map([['colonel-pip', persona]]);

  // FakeLlmClient with NO responses queued — if the orchestrator calls it, the test fails.
  const llm = new FakeLlmClient([]);
  const adapters = { backgammon: { plugin: backgammonPlugin, chooseAction } };
  const orch = createOrchestrator({ db, llm, sse, personas, adapters, logger: { warn: () => {}, error: () => {} } });

  await orch.runTurn(gameId);

  assert.equal(llm.calls.length, 0, 'no LLM call for auto-action');

  const game = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId);
  const newState = JSON.parse(game.state);
  const sess = getAiSession(db, gameId);
  assert.equal(sess.stalledAt, null, 'auto-action did not stall');
  // The bot rolled at least one initial die; that side should have a recorded value.
  const botSide = newState.sides.a === botId ? 'a' : 'b';
  assert.ok(newState.initialRoll[botSide] !== null, 'bot recorded an initial roll');
});

test('orchestrator: caches sequenceTail, drains one move per wake-up', async () => {
  const { openDb } = await import('../src/server/db.js');
  const { createAiSession, getAiSession } = await import('../src/server/ai/agent-session.js');
  const { createOrchestrator } = await import('../src/server/ai/orchestrator.js');
  const backgammonPlugin = (await import('../plugins/backgammon/plugin.js')).default;
  const { chooseAction } = await import('../plugins/backgammon/server/ai/backgammon-player.js');
  const { buildInitialState } = await import('../plugins/backgammon/server/state.js');

  const dir = mkdtempSync(join(tmpdir(), 'orch-bg-seq-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email,friendly_name,color,is_bot,created_at) VALUES ('b','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants });
  state.turn = { activePlayer: 'a', phase: 'moving', dice: { values: [5, 3], remaining: [5, 3], throwParams: [] } };
  state.activeUserId = botId;
  state.sides = { a: botId, b: humanId };

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'backgammon', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'colonel-pip' });

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const persona = { id: 'colonel-pip', displayName: 'Colonel Pip', color: '#445566', glyph: '▲', systemPrompt: 'x' };
  const personas = new Map([['colonel-pip', persona]]);
  // Only one LLM call expected — the first wake-up. The second drains cache.
  const llm = new FakeLlmClient([{ text: '{"moveId":"seq:1","banter":"hmph"}' }]);
  const adapters = { backgammon: { plugin: backgammonPlugin, chooseAction } };
  const orch = createOrchestrator({ db, llm, sse, personas, adapters });

  await orch.runTurn(gameId);

  // After first turn: bot moved once, tail has 1 move queued.
  let sess = getAiSession(db, gameId);
  assert.ok(Array.isArray(sess.pendingSequence), 'pendingSequence stored');
  assert.equal(sess.pendingSequence.length, 1);
  assert.equal(llm.calls.length, 1, 'LLM called exactly once');

  await orch.runTurn(gameId);

  // After second turn: tail drained, LLM still only called once.
  sess = getAiSession(db, gameId);
  assert.equal(sess.pendingSequence, null);
  assert.equal(llm.calls.length, 1, 'LLM still called exactly once — cache drained without LLM');
});

test('orchestrator: unknown persona stalls instead of throwing', async () => {
  const llm = new FakeLlmClient([]);
  const dir = mkdtempSync(join(tmpdir(), 'orch-bad-'));
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
  createAiSession(db, { gameId, botUserId: botId, personaId: 'ghost' });  // persona not in catalog

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  // Empty personas map — persona lookup will fail
  const orch = createOrchestrator({
    db, llm, sse,
    personas: new Map(),
    adapters: { cribbage: { plugin: cribbagePlugin, chooseAction: cribbageChoose } },
    logger: { warn: () => {}, error: () => {} },
  });

  await orch.runTurn(gameId);  // should not throw

  const sess = getAiSession(db, gameId);
  assert.equal(sess.stallReason, 'invalid_response');
  assert.ok(events.some(e => e.type === 'bot_stalled'));
});

test('orchestrator: bot acts on backgammon initial-roll without explicit activeUserId', async () => {
  // Regression test: verify the orchestrator's "should I act" gate lets the
  // bot through when state.activeUserId is null (which is what deriveActiveUserId
  // returns for backgammon's initial-roll phase). Without the fix, the bot
  // silently no-ops and the game is stuck.
  const { openDb } = await import('../src/server/db.js');
  const { createAiSession } = await import('../src/server/ai/agent-session.js');
  const { createOrchestrator } = await import('../src/server/ai/orchestrator.js');
  const backgammonPlugin = (await import('../plugins/backgammon/plugin.js')).default;
  const { chooseAction } = await import('../plugins/backgammon/server/ai/backgammon-player.js');
  const { buildInitialState } = await import('../plugins/backgammon/server/state.js');

  const dir = mkdtempSync(join(tmpdir(), 'orch-bg-initial-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email,friendly_name,color,is_bot,created_at) VALUES ('b','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];

  // Vanilla state — DO NOT inject activeUserId. This is what game creation
  // produces in production.
  const state = buildInitialState({ participants });
  state.sides = { a: botId, b: humanId };
  // state.activeUserId is intentionally absent/null here.

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'backgammon', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'colonel-pip' });

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const persona = { id: 'colonel-pip', displayName: 'Colonel Pip', color: '#445566', glyph: '▲', systemPrompt: 'x' };
  const personas = new Map([['colonel-pip', persona]]);
  const llm = new FakeLlmClient([]);  // no LLM calls expected — initial-roll is auto-action
  const adapters = { backgammon: { plugin: backgammonPlugin, chooseAction } };
  const orch = createOrchestrator({ db, llm, sse, personas, adapters });

  await orch.runTurn(gameId);

  // The bot should have rolled for its side. Check that initialRoll[botSide] is now set.
  const after = JSON.parse(db.prepare("SELECT state FROM games WHERE id = ?").get(gameId).state);
  const botSide = after.sides.a === botId ? 'a' : 'b';
  assert.ok(after.initialRoll[botSide] != null,
    `bot should have rolled for side ${botSide}; got initialRoll=${JSON.stringify(after.initialRoll)}`);
  assert.equal(llm.calls.length, 0, 'no LLM call for auto-action');
});
