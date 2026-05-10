import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-schema-'));
  return openDb(join(dir, 'test.db'));
}

test('schema: users has is_bot column with default 0', () => {
  const db = tmpDb();
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const isBot = cols.find(c => c.name === 'is_bot');
  assert.ok(isBot, 'is_bot column exists');
  assert.equal(isBot.notnull, 1);
  assert.equal(isBot.dflt_value, '0');
});

test('schema: ai_sessions table has the documented columns', () => {
  const db = tmpDb();
  const cols = db.prepare("PRAGMA table_info(ai_sessions)").all();
  const names = cols.map(c => c.name);
  for (const required of ['game_id', 'bot_user_id', 'persona_id', 'claude_session_id',
                          'stalled_at', 'stall_reason', 'created_at', 'last_used_at']) {
    assert.ok(names.includes(required), `column ${required} present`);
  }
});

test('schema: ai_sessions.game_id is PRIMARY KEY referencing games(id)', () => {
  const db = tmpDb();
  const fk = db.prepare("PRAGMA foreign_key_list(ai_sessions)").all();
  assert.ok(fk.some(f => f.table === 'games' && f.from === 'game_id'));
  const pk = db.prepare("PRAGMA table_info(ai_sessions)").all().find(c => c.pk === 1);
  assert.equal(pk.name, 'game_id');
});
