import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';
import { createAiSession } from '../src/server/ai/agent-session.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

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
  const state = buildInitialState({ participants, rng: det(7) });
  state.activeUserId = botId;
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'hattie' });

  let scheduled = 0;
  const llm = { send: async () => { scheduled++; return { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid' }; } };
  const { orchestrator } = bootAiSubsystem({
    db, sse: { broadcast: () => {} }, llm, personaDir,
  });
  await new Promise(r => setImmediate(r));
  await orchestrator.runTurn(gameId);
  assert.ok(scheduled >= 1);
});
