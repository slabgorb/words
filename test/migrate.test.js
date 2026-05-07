import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateLegacy } from '../src/server/migrate.js';
import { openDb, migrateLegacyState } from '../src/server/db.js';
import { listUsers, getUserByEmail } from '../src/server/users.js';
import { listGamesForUser } from '../src/server/games.js';

// Build a fixture DB shaped like the legacy schema with one in-progress game.
function buildLegacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL);
    CREATE TABLE game (
      id INTEGER PRIMARY KEY CHECK (id=1),
      status TEXT NOT NULL, current_turn TEXT NOT NULL,
      bag TEXT NOT NULL, board TEXT NOT NULL,
      rack_keith TEXT NOT NULL, rack_sonia TEXT NOT NULL,
      score_keith INTEGER NOT NULL DEFAULT 0, score_sonia INTEGER NOT NULL DEFAULT 0,
      consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
      ended_reason TEXT, winner TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id TEXT NOT NULL, kind TEXT NOT NULL,
      placement TEXT, words_formed TEXT,
      score_delta INTEGER NOT NULL DEFAULT 0,
      client_nonce TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ended_at INTEGER NOT NULL, winner TEXT,
      score_keith INTEGER NOT NULL, score_sonia INTEGER NOT NULL,
      snapshot TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO players VALUES ('keith','Keith','#3b82f6')").run();
  db.prepare("INSERT INTO players VALUES ('sonia','Sonia','#ec4899')").run();
  db.prepare(`INSERT INTO game VALUES
    (1,'active','keith',?,?,?,?,42,17,0,NULL,NULL,?,?)`).run(
    JSON.stringify(['A','B','C']),
    JSON.stringify(Array.from({length:15}, () => Array(15).fill(null))),
    JSON.stringify(['E','I','O','U','Y','Z','_']),
    JSON.stringify(['T','S','R','N','L','D','P']),
    1700000000000, 1700000001000
  );
  db.prepare(`INSERT INTO moves (player_id, kind, score_delta, client_nonce, created_at)
              VALUES ('keith', 'pass', 0, 'nonce-1', 1700000000500)`).run();
  return db;
}

// Apply the new schema in the same shape openDb would, but allow the test
// to control the order. (Do NOT call openDb on this DB — it would attempt
// to also create everything else.)
function installNewSchema(db) {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      friendly_name TEXT NOT NULL, color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_a_id INTEGER NOT NULL REFERENCES users(id),
      player_b_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
      current_turn TEXT NOT NULL CHECK (current_turn IN ('a', 'b')),
      bag TEXT NOT NULL, board TEXT NOT NULL,
      rack_a TEXT NOT NULL, rack_b TEXT NOT NULL,
      score_a INTEGER NOT NULL DEFAULT 0, score_b INTEGER NOT NULL DEFAULT 0,
      consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
      ended_reason TEXT,
      winner_side TEXT CHECK (winner_side IN ('a', 'b', 'draw') OR winner_side IS NULL),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      game_type TEXT NOT NULL DEFAULT 'words',
      state TEXT NOT NULL DEFAULT '{}',
      CHECK (player_a_id < player_b_id)
    );
    CREATE UNIQUE INDEX one_active_per_pair ON games(player_a_id, player_b_id) WHERE status='active';
  `);
}

test('migrateLegacy creates Keith and Sonia users with the configured emails', () => {
  const db = buildLegacyDb();
  installNewSchema(db);
  migrateLegacy(db);
  const users = listUsers(db);
  assert.equal(users.length, 2);
  assert.ok(getUserByEmail(db, 'slabgorb@gmail.com'));
  assert.ok(getUserByEmail(db, 'sonia.ramosdarocha@gmail.com'));
});

test('migrateLegacy preserves the active game with mapped racks/scores', () => {
  const db = buildLegacyDb();
  installNewSchema(db);
  migrateLegacy(db);
  // Pack legacy columns into state JSON (normally done by openDb after migrateLegacy).
  migrateLegacyState(db);
  const keith = getUserByEmail(db, 'slabgorb@gmail.com');
  const games = listGamesForUser(db, keith.id);
  assert.equal(games.length, 1);
  const g = games[0];
  assert.equal(g.status, 'active');
  // keith is inserted first → id 1 → side 'a'.
  assert.equal(g.state.scores.a, 42);
  assert.equal(g.state.scores.b, 17);
  assert.equal(g.currentTurn, 'a'); // 'keith' → 'a'
  assert.deepEqual(g.state.racks.a, ['E','I','O','U','Y','Z','_']);
  assert.deepEqual(g.state.racks.b, ['T','S','R','N','L','D','P']);
});

test('migrateLegacy rebuilds moves with game_id and side', () => {
  const db = buildLegacyDb();
  installNewSchema(db);
  migrateLegacy(db);
  const cols = db.prepare('PRAGMA table_info(moves)').all().map(c => c.name);
  assert.ok(cols.includes('game_id'));
  assert.ok(cols.includes('side'));
  assert.equal(cols.includes('player_id'), false);
  const row = db.prepare('SELECT * FROM moves').get();
  assert.equal(row.game_id, 1);
  assert.equal(row.side, 'a');
});

test('migrateLegacy is idempotent', () => {
  const db = buildLegacyDb();
  installNewSchema(db);
  migrateLegacy(db);
  migrateLegacy(db); // second call is a no-op
  assert.equal(listUsers(db).length, 2);
});

test('migrateLegacy renames game_history to legacy_game_history', () => {
  const db = buildLegacyDb();
  installNewSchema(db);
  migrateLegacy(db);
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='legacy_game_history'").get();
  assert.ok(t);
  const old = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_history'").get();
  assert.equal(old, undefined);
});

test('migrateLegacy drops legacy game and players tables', () => {
  const db = buildLegacyDb();
  installNewSchema(db);
  migrateLegacy(db);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game'").get(), undefined);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='players'").get(), undefined);
});

test('openDb on a fresh empty file leaves users table empty (no auto-seed without legacy data)', () => {
  const db = openDb(':memory:');
  assert.equal(listUsers(db).length, 0);
});
