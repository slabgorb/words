import Database from 'better-sqlite3';
import { TILE_BAG, BOARD_SIZE } from './board.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  color     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS game (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  status          TEXT NOT NULL,
  current_turn    TEXT NOT NULL REFERENCES players(id),
  bag             TEXT NOT NULL,
  board           TEXT NOT NULL,
  rack_keith      TEXT NOT NULL,
  rack_sonia      TEXT NOT NULL,
  score_keith     INTEGER NOT NULL DEFAULT 0,
  score_sonia     INTEGER NOT NULL DEFAULT 0,
  consecutive_scoreless_turns INTEGER NOT NULL DEFAULT 0,
  ended_reason    TEXT,
  winner          TEXT REFERENCES players(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     TEXT NOT NULL REFERENCES players(id),
  kind          TEXT NOT NULL,
  placement     TEXT,
  words_formed  TEXT,
  score_delta   INTEGER NOT NULL DEFAULT 0,
  client_nonce  TEXT UNIQUE,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ended_at    INTEGER NOT NULL,
  winner      TEXT,
  score_keith INTEGER NOT NULL,
  score_sonia INTEGER NOT NULL,
  snapshot    TEXT NOT NULL
);
`;

function shuffle(arr) {
  // Fisher–Yates, seeded by Math.random — fine for two-player personal use.
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function emptyBoardJSON() {
  return JSON.stringify(Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null)));
}

function freshGameRow(now) {
  const bag = shuffle(TILE_BAG);
  const rackKeith = bag.splice(0, 7);
  const rackSonia = bag.splice(0, 7);
  return {
    id: 1,
    status: 'active',
    current_turn: 'keith',
    bag: JSON.stringify(bag),
    board: emptyBoardJSON(),
    rack_keith: JSON.stringify(rackKeith),
    rack_sonia: JSON.stringify(rackSonia),
    score_keith: 0,
    score_sonia: 0,
    consecutive_scoreless_turns: 0,
    ended_reason: null,
    winner: null,
    created_at: now,
    updated_at: now
  };
}

export function openDb(filePath = 'game.db') {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Seed players if absent
  const playerCount = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  if (playerCount === 0) {
    const insP = db.prepare('INSERT INTO players (id,name,color) VALUES (?,?,?)');
    insP.run('keith', 'Keith', '#3b82f6');
    insP.run('sonia', 'Sonia', '#ec4899');
  }
  // Seed game if absent
  const gameRow = db.prepare('SELECT id FROM game WHERE id=1').get();
  if (!gameRow) {
    const now = Date.now();
    const fresh = freshGameRow(now);
    db.prepare(`INSERT INTO game (id,status,current_turn,bag,board,rack_keith,rack_sonia,score_keith,score_sonia,consecutive_scoreless_turns,ended_reason,winner,created_at,updated_at)
                VALUES (@id,@status,@current_turn,@bag,@board,@rack_keith,@rack_sonia,@score_keith,@score_sonia,@consecutive_scoreless_turns,@ended_reason,@winner,@created_at,@updated_at)`).run(fresh);
  }
  return db;
}

// Read the current game state, deserialized.
export function getGameState(db) {
  const row = db.prepare('SELECT * FROM game WHERE id=1').get();
  return {
    status: row.status,
    currentTurn: row.current_turn,
    bag: JSON.parse(row.bag),
    board: JSON.parse(row.board),
    racks: { keith: JSON.parse(row.rack_keith), sonia: JSON.parse(row.rack_sonia) },
    scores: { keith: row.score_keith, sonia: row.score_sonia },
    consecutiveScorelessTurns: row.consecutive_scoreless_turns,
    endedReason: row.ended_reason,
    winner: row.winner
  };
}

// Persist a new state, append a moves row, all in one transaction.
// Returns { moveId, idempotent }.
export function persistMove(db, nextState, moveRecord) {
  const tx = db.transaction(() => {
    // Idempotency: if nonce already used, return the existing move id.
    if (moveRecord.clientNonce) {
      const existing = db.prepare('SELECT id FROM moves WHERE client_nonce=?').get(moveRecord.clientNonce);
      if (existing) return { moveId: existing.id, idempotent: true };
    }
    db.prepare(`UPDATE game SET
      status=@status, current_turn=@current_turn, bag=@bag, board=@board,
      rack_keith=@rack_keith, rack_sonia=@rack_sonia,
      score_keith=@score_keith, score_sonia=@score_sonia,
      consecutive_scoreless_turns=@consecutive_scoreless_turns,
      ended_reason=@ended_reason, winner=@winner, updated_at=@updated_at
      WHERE id=1`).run({
      status: nextState.status ?? (nextState.endedReason ? 'ended' : 'active'),
      current_turn: nextState.currentTurn,
      bag: JSON.stringify(nextState.bag),
      board: JSON.stringify(nextState.board),
      rack_keith: JSON.stringify(nextState.racks.keith),
      rack_sonia: JSON.stringify(nextState.racks.sonia),
      score_keith: nextState.scores.keith,
      score_sonia: nextState.scores.sonia,
      consecutive_scoreless_turns: nextState.consecutiveScorelessTurns,
      ended_reason: nextState.endedReason ?? null,
      winner: nextState.winner ?? null,
      updated_at: Date.now()
    });
    const info = db.prepare(`INSERT INTO moves (player_id,kind,placement,words_formed,score_delta,client_nonce,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      moveRecord.playerId,
      moveRecord.kind,
      moveRecord.placement ? JSON.stringify(moveRecord.placement) : null,
      moveRecord.wordsFormed ? JSON.stringify(moveRecord.wordsFormed) : null,
      moveRecord.scoreDelta ?? 0,
      moveRecord.clientNonce ?? null,
      Date.now()
    );
    return { moveId: info.lastInsertRowid, idempotent: false };
  });
  return tx();
}

// Reset the active game, archiving the current one to history.
export function resetGame(db) {
  const now = Date.now();
  const tx = db.transaction(() => {
    const cur = db.prepare('SELECT * FROM game WHERE id=1').get();
    db.prepare(`INSERT INTO game_history (ended_at,winner,score_keith,score_sonia,snapshot)
      VALUES (?,?,?,?,?)`).run(now, cur.winner, cur.score_keith, cur.score_sonia, JSON.stringify(cur));
    db.prepare('DELETE FROM moves').run();
    const fresh = freshGameRow(now);
    db.prepare(`UPDATE game SET status=@status, current_turn=@current_turn, bag=@bag, board=@board,
      rack_keith=@rack_keith, rack_sonia=@rack_sonia, score_keith=@score_keith, score_sonia=@score_sonia,
      consecutive_scoreless_turns=@consecutive_scoreless_turns, ended_reason=@ended_reason, winner=@winner,
      created_at=@created_at, updated_at=@updated_at WHERE id=1`).run(fresh);
  });
  tx();
}
