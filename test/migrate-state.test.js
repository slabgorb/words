import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { openDb } from '../src/server/db.js';
import wordsPlugin from '../plugins/words/plugin.js';

test('migrateLegacyState packs inline columns into plugin-shape state', () => {
  // Use a real file so openDb (which expects a path) can re-open it.
  const path = `/tmp/migrate-test-${process.pid}-${Date.now()}.db`;
  const seed = new Database(path);
  seed.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, friendly_name TEXT, color TEXT, created_at INTEGER);
    CREATE TABLE games (
      id INTEGER PRIMARY KEY, player_a_id INTEGER NOT NULL, player_b_id INTEGER NOT NULL,
      status TEXT NOT NULL, current_turn TEXT NOT NULL,
      bag TEXT NOT NULL, board TEXT NOT NULL, rack_a TEXT NOT NULL, rack_b TEXT NOT NULL,
      score_a INTEGER NOT NULL DEFAULT 0, score_b INTEGER NOT NULL DEFAULT 0,
      consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
      ended_reason TEXT, winner_side TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE moves (
      id INTEGER PRIMARY KEY, game_id INTEGER, side TEXT, kind TEXT,
      placement TEXT, words_formed TEXT, score_delta INTEGER, client_nonce TEXT, created_at INTEGER
    );
  `);
  const now = Date.now();
  seed.prepare(`INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@x', 'A', '#f00', ?), (2, 'b@x', 'B', '#0f0', ?)`).run(now, now);
  const board = Array.from({ length: 15 }, () => Array(15).fill(null));
  seed.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, current_turn,
    bag, board, rack_a, rack_b, score_a, score_b, consecutive_scoreless_turns,
    created_at, updated_at) VALUES (1, 1, 2, 'active', 'b', ?, ?, ?, ?, 165, 128, 0, ?, ?)`)
    .run(JSON.stringify(['A','B','C']), JSON.stringify(board),
         JSON.stringify(['D','E','F','G','H','I','J']),
         JSON.stringify(['K','L','M','N','O','P','Q']),
         now, now);
  seed.close();

  const db = openDb(path);
  const row = db.prepare('SELECT state FROM games WHERE id=1').get();
  const state = JSON.parse(row.state);
  assert.deepEqual(state.sides, { a: 1, b: 2 });
  assert.equal(state.activeUserId, 2, 'current_turn=b → activeUserId = player_b_id');
  assert.equal('activeSide' in state, false, 'legacy activeSide field should not survive');
  assert.equal(state.scores.a, 165);
  assert.equal(state.scores.b, 128);
  assert.equal(state.racks.a.length, 7);
  assert.equal(state.racks.b.length, 7);
  assert.equal(state.bag.length, 3);
  assert.equal(state.initialMoveDone, true);

  // Crucially, the Words plugin accepts the migrated shape.
  const result = wordsPlugin.applyAction({
    state, action: { type: 'pass' }, actorId: 2, rng: () => 0.5,
  });
  assert.equal(result.error, undefined, `plugin should accept migrated state, got: ${result.error}`);
  assert.equal(result.state.activeUserId, 1);
  db.close();
});

test('migrateStateShape patches rows already written under the broken (activeSide-only) shape', () => {
  const path = `/tmp/migrate-shape-test-${process.pid}-${Date.now()}.db`;
  const seed = new Database(path);
  // Build the post-Plan-A schema directly, and pre-populate a row with the broken state shape.
  seed.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, friendly_name TEXT, color TEXT, created_at INTEGER);
    CREATE TABLE games (
      id INTEGER PRIMARY KEY,
      player_a_id INTEGER NOT NULL,
      player_b_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      ended_reason TEXT, winner_side TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      game_type TEXT NOT NULL DEFAULT 'words',
      state TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE moves (id INTEGER PRIMARY KEY, game_id INTEGER, side TEXT, kind TEXT, placement TEXT, words_formed TEXT, score_delta INTEGER, client_nonce TEXT, created_at INTEGER);
  `);
  const now = Date.now();
  seed.prepare(`INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@x', 'A', '#f00', ?), (2, 'b@x', 'B', '#0f0', ?)`).run(now, now);
  const brokenState = {
    bag: ['A'], board: Array.from({ length: 15 }, () => Array(15).fill(null)),
    racks: { a: ['B'], b: ['C'] }, scores: { a: 0, b: 0 },
    activeSide: 'b', // legacy/broken: no sides, no activeUserId
    consecutiveScorelessTurns: 0, initialMoveDone: false,
  };
  seed.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
                VALUES (1, 1, 2, 'active', 'words', ?, ?, ?)`).run(JSON.stringify(brokenState), now, now);
  seed.close();

  const db = openDb(path);
  const row = db.prepare('SELECT state FROM games WHERE id=1').get();
  const state = JSON.parse(row.state);
  assert.deepEqual(state.sides, { a: 1, b: 2 });
  assert.equal(state.activeUserId, 2);
  assert.equal('activeSide' in state, false);
  db.close();
});
