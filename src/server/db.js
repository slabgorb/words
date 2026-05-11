import Database from 'better-sqlite3';
import { migrateLegacy } from './migrate.js';

// Tables that must exist before the legacy migration runs.
const SCHEMA_PRE = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  friendly_name TEXT NOT NULL,
  color         TEXT NOT NULL,
  glyph         TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_a_id     INTEGER NOT NULL REFERENCES users(id),
  player_b_id     INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL CHECK (status IN ('active', 'ended')),
  current_turn    TEXT NOT NULL CHECK (current_turn IN ('a', 'b')),
  bag             TEXT NOT NULL,
  board           TEXT NOT NULL,
  rack_a          TEXT NOT NULL,
  rack_b          TEXT NOT NULL,
  score_a         INTEGER NOT NULL DEFAULT 0,
  score_b         INTEGER NOT NULL DEFAULT 0,
  consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
  ended_reason    TEXT,
  winner_side     TEXT CHECK (winner_side IN ('a', 'b', 'draw') OR winner_side IS NULL),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CHECK (player_a_id < player_b_id)
);
`;
// Note: the per-pair unique active-game index is created game-type-aware
// later in openDb (one_active_per_pair_type). The legacy name
// one_active_per_pair is dropped there if a previous build created it.

// Tables/indexes that reference game_id — only safe after migrateLegacy rewrites moves.
const SCHEMA_POST = `
CREATE TABLE IF NOT EXISTS moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id),
  side          TEXT NOT NULL CHECK (side IN ('a', 'b')),
  kind          TEXT NOT NULL CHECK (kind IN ('play', 'pass', 'swap', 'resign')),
  placement     TEXT,
  words_formed  TEXT,
  score_delta   INTEGER NOT NULL DEFAULT 0,
  client_nonce  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS moves_nonce_per_game
  ON moves(game_id, client_nonce) WHERE client_nonce IS NOT NULL;
`;

export function migrateLegacyState(db) {
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);

  const legacyCols = [
    'bag', 'board', 'rack_a', 'rack_b',
    'score_a', 'score_b', 'current_turn',
    'consecutive_scoreless_turns'
  ];
  const presentLegacy = legacyCols.filter(c => cols.includes(c));
  if (presentLegacy.length === 0) return; // columns already dropped

  // Pack each row's legacy data into state JSON using the plugin shape
  // (sides + activeUserId), so applyAction works without a second pass.
  const rows = db.prepare(`SELECT * FROM games`).all();
  const updateState = db.prepare(`UPDATE games SET state = ? WHERE id = ?`);

  const update = db.transaction((rows) => {
    for (const row of rows) {
      const turn = row.current_turn ?? 'a';
      const activeUserId = turn === 'a' ? row.player_a_id : row.player_b_id;
      const state = {
        bag: row.bag ? JSON.parse(row.bag) : [],
        board: row.board ? JSON.parse(row.board) : [],
        racks: {
          a: row.rack_a ? JSON.parse(row.rack_a) : [],
          b: row.rack_b ? JSON.parse(row.rack_b) : [],
        },
        scores: { a: row.score_a ?? 0, b: row.score_b ?? 0 },
        sides: { a: row.player_a_id, b: row.player_b_id },
        activeUserId,
        consecutiveScorelessTurns: row.consecutive_scoreless_turns ?? 0,
        initialMoveDone: (row.score_a ?? 0) > 0 || (row.score_b ?? 0) > 0,
        endedReason: null,
        winnerSide: null,
      };
      updateState.run(JSON.stringify(state), row.id);
    }
  });
  update(rows);

  // Drop the legacy columns. SQLite supports ALTER TABLE … DROP COLUMN since 3.35.
  for (const col of presentLegacy) {
    db.exec(`ALTER TABLE games DROP COLUMN ${col}`);
  }
}

// Patch any rows whose state JSON was written by an earlier (broken) version
// of migrateLegacyState — they have `activeSide` but no `sides`/`activeUserId`,
// so the Words plugin refuses to act on them.
export function migrateStateShape(db) {
  const rows = db.prepare(`
    SELECT id, player_a_id, player_b_id, state FROM games
    WHERE json_extract(state, '$.sides') IS NULL
       OR json_extract(state, '$.activeUserId') IS NULL
  `).all();
  if (rows.length === 0) return;

  const updateState = db.prepare(`UPDATE games SET state = ? WHERE id = ?`);
  const update = db.transaction((rows) => {
    for (const row of rows) {
      const state = JSON.parse(row.state);
      // Only legacy Words states (which carry `activeSide`) need this patch.
      // Skipping anything else avoids stamping `activeUserId` onto plugin
      // shapes (e.g. backgammon's `state.board`) that legitimately don't have one.
      if (!state.activeSide) continue;

      const aSide = state.activeSide ?? 'a';
      state.sides = state.sides ?? { a: row.player_a_id, b: row.player_b_id };
      state.activeUserId = state.activeUserId
        ?? (aSide === 'a' ? row.player_a_id : row.player_b_id);
      delete state.activeSide;
      updateState.run(JSON.stringify(state), row.id);
    }
  });
  update(rows);
}

export function openDb(filePath = 'game.db') {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_PRE);
  migrateLegacy(db);
  db.exec(SCHEMA_POST);

  // --- Users schema delta ---
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes('glyph')) {
    db.exec("ALTER TABLE users ADD COLUMN glyph TEXT");
  }

  // --- AI players schema delta (story: 2026-05-10-ai-players-cribbage) ---
  if (!userCols.includes('is_bot')) {
    db.exec("ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_sessions (
      game_id           INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      bot_user_id       INTEGER NOT NULL REFERENCES users(id),
      persona_id        TEXT NOT NULL,
      claude_session_id TEXT,
      stalled_at        INTEGER,
      stall_reason      TEXT,
      created_at        INTEGER NOT NULL,
      last_used_at      INTEGER NOT NULL
    )
  `);

  const aiCols = db.prepare("PRAGMA table_info(ai_sessions)").all().map(c => c.name);
  if (!aiCols.includes('pending_sequence')) {
    db.exec("ALTER TABLE ai_sessions ADD COLUMN pending_sequence TEXT");
  }

  // --- Plugin host schema delta ---
  const gameCols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);

  if (!gameCols.includes('game_type')) {
    db.exec("ALTER TABLE games ADD COLUMN game_type TEXT NOT NULL DEFAULT 'words'");
  }

  if (!gameCols.includes('state')) {
    db.exec("ALTER TABLE games ADD COLUMN state TEXT NOT NULL DEFAULT '{}'");
  }

  db.exec("DROP INDEX IF EXISTS one_active_per_pair");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_pair_type
    ON games (player_a_id, player_b_id, game_type)
    WHERE status = 'active'
  `);

  // Migrate legacy Words columns into state JSON
  migrateLegacyState(db);
  // Patch any rows that were migrated under an earlier broken shape.
  migrateStateShape(db);

  // History log — single shared table across game types.
  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id     INTEGER NOT NULL REFERENCES games(id),
      turn_number INTEGER NOT NULL,
      side        TEXT NOT NULL CHECK (side IN ('a','b')),
      kind        TEXT NOT NULL,
      summary     TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS turn_log_by_game ON turn_log(game_id, id);
  `);

  // Drop the dormant legacy moves table — never read or written by current code.
  db.exec('DROP INDEX IF EXISTS moves_nonce_per_game');
  db.exec('DROP TABLE IF EXISTS moves');

  return db;
}
