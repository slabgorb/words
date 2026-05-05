import Database from 'better-sqlite3';
import { TILE_BAG, BOARD_SIZE } from './board.js';
import { migrateLegacy } from './migrate.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  friendly_name TEXT NOT NULL,
  color         TEXT NOT NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_pair
  ON games(player_a_id, player_b_id) WHERE status = 'active';

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

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

export function freshGameDeal() {
  const bag = shuffle(TILE_BAG);
  const rackA = bag.splice(0, 7);
  const rackB = bag.splice(0, 7);
  return { bag, rackA, rackB };
}

export function openDb(filePath = 'game.db') {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrateLegacy(db);
  return db;
}
