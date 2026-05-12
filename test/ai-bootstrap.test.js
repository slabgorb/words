import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';
import { createAiSession } from '../src/server/ai/agent-session.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { buildInitialState as cribbageBuildInitialState } from '../plugins/cribbage/server/state.js';
import { buildInitialState as backgammonBuildInitialState } from '../plugins/backgammon/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-boot-'));
  const personaDir = join(dir, 'personas');
  mkdirSync(personaDir);
  writeFileSync(join(personaDir, 'hattie.yaml'),
    'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: hi\n');
  return { dbPath: join(dir, 'db.db'), personaDir };
}

test('bootAiSubsystem: seeds at least one bot user if none exist', () => {
  const { dbPath, personaDir } = tmp();
  const db = openDb(dbPath);
  const sse = { broadcast: () => {} };
  const llm = { send: async () => ({ text: '{"moveId":"x","banter":""}' }) };
  bootAiSubsystem({ db, sse, llm, personaDir });
  const bots = db.prepare("SELECT * FROM users WHERE is_bot = 1").all();
  assert.ok(bots.length >= 1);
});

test('bootAiSubsystem: returns orchestrator that can be invoked', () => {
  const { dbPath, personaDir } = tmp();
  const db = openDb(dbPath);
  const { orchestrator } = bootAiSubsystem({
    db, sse: { broadcast: () => {} },
    llm: { send: async () => ({ text: '{"moveId":"x","banter":""}' }) },
    personaDir,
  });
  assert.equal(typeof orchestrator.runTurn, 'function');
  assert.equal(typeof orchestrator.scheduleTurn, 'function');
});

test('bootAiSubsystem: schedules pending bot turns from listStalledOrInFlight', async () => {
  const { dbPath, personaDir } = tmp();
  const db = openDb(dbPath);
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botRow = db.prepare("INSERT INTO users (email, friendly_name, color, is_bot, created_at) VALUES ('b@x','Bot','#fff',1,?) RETURNING id").get(now);
  const botId = botRow.id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = cribbageBuildInitialState({ participants, rng: det(7) });
  state.activeUserId = botId;
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'hattie' });

  let scheduled = 0;
  const llm = { send: async () => { scheduled++; return { text: '{"moveId":"discard:0,5","banter":""}', sessionId: 'sid' }; } };
  const { orchestrator } = bootAiSubsystem({
    db, sse: { broadcast: () => {} }, llm, personaDir,
  });
  await new Promise(r => setImmediate(r));
  await orchestrator.runTurn(gameId);
  assert.ok(scheduled >= 1);
});

test('bootAiSubsystem: registers backgammon adapter', async () => {
  const { openDb: openDbFunc } = await import('../src/server/db.js');
  const { bootAiSubsystem: bootFunc } = await import('../src/server/ai/index.js');
  const { createAiSession: createSessionFunc } = await import('../src/server/ai/agent-session.js');
  const { buildInitialState: bgBuildInitialState } = await import('../plugins/backgammon/server/state.js');

  const dir = mkdtempSync(join(tmpdir(), 'boot-bg-'));
  const db = openDbFunc(join(dir, 'test.db'));
  const llm = { send: async () => ({ text: '{"moveId":"x","banter":""}' }) };

  // Use the real persona dir; we just need it to load.
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootFunc({ db, sse: { broadcast() {} }, llm, personaDir });

  const now = Date.now();
  const h = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('h','H','#000',?) RETURNING id").get(now).id;
  const bot = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get().id;
  const aId = Math.min(h, bot), bId = Math.max(h, bot);
  const state = bgBuildInitialState({ participants: [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }] });
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'backgammon', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createSessionFunc(db, { gameId, botUserId: bot, personaId: 'colonel-pip' });

  // No throw means the adapter is registered. scheduleTurn would otherwise
  // stall with "no AI adapter for game_type backgammon".
  assert.doesNotThrow(() => orchestrator.scheduleTurn(gameId));
});

test('bootAiSubsystem: registers words adapter', async () => {
  const { openDb: openDbFunc } = await import('../src/server/db.js');
  const { bootAiSubsystem: bootFunc } = await import('../src/server/ai/index.js');
  const { createAiSession: createSessionFunc } = await import('../src/server/ai/agent-session.js');
  const { buildInitialState: wordsBuildInitialState } = await import('../plugins/words/server/state.js');

  const dir = mkdtempSync(join(tmpdir(), 'boot-words-'));
  const db = openDbFunc(join(dir, 'test.db'));
  const llm = { send: async () => ({ text: '{"moveId":"x","banter":""}' }) };
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootFunc({ db, sse: { broadcast() {} }, llm, personaDir });

  const now = Date.now();
  const h = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('hw','Hw','#000',?) RETURNING id").get(now).id;
  const bot = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get().id;
  const aId = Math.min(h, bot), bId = Math.max(h, bot);
  const seed = 7;
  let s = seed;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const state = wordsBuildInitialState({ participants: [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }], rng });
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'words', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createSessionFunc(db, { gameId, botUserId: bot, personaId: 'samantha' });

  // No throw = adapter registered. scheduleTurn would otherwise stall
  // with "no AI adapter for game_type words".
  assert.doesNotThrow(() => orchestrator.scheduleTurn(gameId));
});
