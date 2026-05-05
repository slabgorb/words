import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { openDb, migrateLegacyState } from '../src/server/db.js';

test('games has game_type column with default "words"', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(games)").all();
  const col = cols.find(c => c.name === 'game_type');
  assert.ok(col, 'game_type column missing');
  assert.equal(col.type, 'TEXT');
  assert.equal(col.notnull, 1);
  assert.equal(col.dflt_value, "'words'");
});

test('games has state column (JSON text, default {})', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(games)").all();
  const col = cols.find(c => c.name === 'state');
  assert.ok(col, 'state column missing');
  assert.equal(col.type, 'TEXT');
  assert.equal(col.notnull, 1);
});

test('one_active_per_pair_type partial unique index exists', () => {
  const db = openDb(':memory:');
  const idx = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='one_active_per_pair_type'"
  ).get();
  assert.ok(idx, 'one_active_per_pair_type index missing');
  assert.match(idx.sql, /game_type/);
  assert.match(idx.sql, /WHERE\s+status\s*=\s*'active'/i);
});

test('legacy one_active_per_pair index is removed', () => {
  const db = openDb(':memory:');
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='one_active_per_pair'"
  ).get();
  assert.equal(idx, undefined, 'legacy index should be dropped');
});

test('legacy Words columns are migrated into state JSON and then dropped', () => {
  // Build a fake legacy DB by manually creating the pre-delta schema
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, friendly_name TEXT, color TEXT, created_at TEXT);
    CREATE TABLE games (
      id INTEGER PRIMARY KEY,
      player_a_id INTEGER, player_b_id INTEGER,
      status TEXT,
      bag TEXT, board TEXT, rack_a TEXT, rack_b TEXT,
      score_a INTEGER DEFAULT 0, score_b INTEGER DEFAULT 0,
      current_turn TEXT DEFAULT 'a',
      consecutive_scoreless_turns INTEGER DEFAULT 0,
      ended_reason TEXT, winner_side TEXT,
      created_at TEXT, updated_at TEXT,
      game_type TEXT NOT NULL DEFAULT 'words',
      state TEXT NOT NULL DEFAULT '{}'
    );
    INSERT INTO users VALUES (1, 'a@b', 'Alice', '#f00', '2026-01-01');
    INSERT INTO users VALUES (2, 'b@b', 'Bob',   '#0f0', '2026-01-01');
    INSERT INTO games (id, player_a_id, player_b_id, status, bag, board, rack_a, rack_b, score_a, score_b, current_turn, consecutive_scoreless_turns, created_at, updated_at)
    VALUES (1, 1, 2, 'active', '["A","B"]', '[[null]]', '["X","Y"]', '["P","Q"]', 12, 7, 'b', 1, '2026-01-01', '2026-01-01');
  `);

  // Run the migration directly
  migrateLegacyState(db);

  // Legacy columns are gone
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  assert.ok(!cols.includes('bag'), 'bag should be dropped');
  assert.ok(!cols.includes('board'), 'board should be dropped');
  assert.ok(!cols.includes('rack_a'), 'rack_a should be dropped');
  assert.ok(!cols.includes('rack_b'), 'rack_b should be dropped');
  assert.ok(!cols.includes('score_a'), 'score_a should be dropped');
  assert.ok(!cols.includes('score_b'), 'score_b should be dropped');
  assert.ok(!cols.includes('current_turn'), 'current_turn should be dropped');
  assert.ok(!cols.includes('consecutive_scoreless_turns'), 'consecutive_scoreless_turns should be dropped');

  // state JSON contains everything
  const row = db.prepare("SELECT state, game_type FROM games WHERE id = 1").get();
  assert.equal(row.game_type, 'words');
  const state = JSON.parse(row.state);
  assert.deepEqual(state.bag, ['A', 'B']);
  assert.deepEqual(state.board, [[null]]);
  assert.deepEqual(state.racks, { a: ['X', 'Y'], b: ['P', 'Q'] });
  assert.deepEqual(state.scores, { a: 12, b: 7 });
  assert.deepEqual(state.sides, { a: 1, b: 2 });
  assert.equal(state.activeUserId, 2, 'current_turn=b → activeUserId = player_b_id');
  assert.equal('activeSide' in state, false, 'legacy activeSide field should not survive');
  assert.equal(state.consecutiveScorelessTurns, 1);
});

test('migration is idempotent on already-migrated DBs', () => {
  const db = openDb(':memory:');  // already in delta shape, no legacy cols
  // Should be a no-op, not throw
  migrateLegacyState(db);
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  assert.ok(cols.includes('state'));
});
