import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import {
  createAiSession,
  getAiSession,
  setClaudeSessionId,
  markStalled,
  clearStall,
  listStalledOrInFlight,
} from '../src/server/ai/agent-session.js';

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-session-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const u1 = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('a@x', 'A', '#000', ?) RETURNING id").get(now).id;
  const u2 = db.prepare("INSERT INTO users (email, friendly_name, color, is_bot, created_at) VALUES ('bot@x', 'Bot', '#fff', 1, ?) RETURNING id").get(now).id;
  const aId = Math.min(u1, u2), bId = Math.max(u1, u2);
  const gameId = db.prepare(`INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at) VALUES (?, ?, 'active', 'cribbage', '{}', ?, ?) RETURNING id`).get(aId, bId, now, now).id;
  return { db, gameId, botUserId: u2 };
}

test('createAiSession: inserts a row with null claude_session_id and timestamps', () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  const row = getAiSession(db, gameId);
  assert.equal(row.gameId, gameId);
  assert.equal(row.botUserId, botUserId);
  assert.equal(row.personaId, 'hattie');
  assert.equal(row.claudeSessionId, null);
  assert.equal(row.stalledAt, null);
  assert.ok(row.createdAt > 0);
});

test('createAiSession: duplicate game_id rejected', () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  assert.throws(() => createAiSession(db, { gameId, botUserId, personaId: 'hattie' }), /UNIQUE/);
});

test('setClaudeSessionId: stores UUID and bumps last_used_at', async () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  const before = getAiSession(db, gameId).lastUsedAt;
  await new Promise(r => setTimeout(r, 5));
  setClaudeSessionId(db, gameId, 'uuid-1');
  const after = getAiSession(db, gameId);
  assert.equal(after.claudeSessionId, 'uuid-1');
  assert.ok(after.lastUsedAt > before);
});

test('markStalled / clearStall: round-trip', () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  markStalled(db, gameId, 'timeout');
  let row = getAiSession(db, gameId);
  assert.ok(row.stalledAt > 0);
  assert.equal(row.stallReason, 'timeout');
  clearStall(db, gameId);
  row = getAiSession(db, gameId);
  assert.equal(row.stalledAt, null);
  assert.equal(row.stallReason, null);
});

test('listStalledOrInFlight: returns active games whose activeUserId is a bot or that are stalled', () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  const state = JSON.stringify({ activeUserId: botUserId });
  db.prepare("UPDATE games SET state = ? WHERE id = ?").run(state, gameId);
  const rows = listStalledOrInFlight(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gameId, gameId);
});
