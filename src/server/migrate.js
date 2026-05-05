const KEITH_EMAIL = 'slabgorb@gmail.com';
const SONIA_EMAIL = 'sonia.ramosdarocha@gmail.com';

function tableExists(db, name) {
  return !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(name);
}

function tableHasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

// One-shot migration: legacy singleton-game schema → users/games schema.
// Idempotent; safe to call on every boot.
export function migrateLegacy(db) {
  const tx = db.transaction(() => {
    const hasLegacyGame = tableExists(db, 'game');
    const hasLegacyPlayers = tableExists(db, 'players');
    const usersEmpty = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    const gamesEmpty = db.prepare('SELECT COUNT(*) AS n FROM games').get().n === 0;

    // Nothing to migrate.
    if (!hasLegacyGame && !hasLegacyPlayers) return;

    // Already migrated.
    if (!usersEmpty && !gamesEmpty) {
      dropLegacy(db);
      return;
    }

    // 1. Seed Keith and Sonia.
    const insUser = db.prepare(
      'INSERT INTO users (email, friendly_name, color, created_at) VALUES (?, ?, ?, ?)'
    );
    const now = Date.now();
    if (usersEmpty) {
      insUser.run(KEITH_EMAIL, 'Keith', '#3b82f6', now);
      insUser.run(SONIA_EMAIL, 'Sonia', '#ec4899', now);
    }
    const keithId = db.prepare('SELECT id FROM users WHERE email = ?').get(KEITH_EMAIL).id;
    const soniaId = db.prepare('SELECT id FROM users WHERE email = ?').get(SONIA_EMAIL).id;
    const aId = Math.min(keithId, soniaId);
    const bId = Math.max(keithId, soniaId);
    const keithSide = keithId === aId ? 'a' : 'b';
    const soniaSide = soniaId === aId ? 'a' : 'b';

    // 2. Migrate the singleton game.
    if (gamesEmpty && hasLegacyGame) {
      const g = db.prepare('SELECT * FROM game WHERE id = 1').get();
      if (g) {
        const sideMap = (id) => (id === 'keith' ? keithSide : soniaSide);
        const rackA = keithSide === 'a' ? g.rack_keith : g.rack_sonia;
        const rackB = keithSide === 'a' ? g.rack_sonia : g.rack_keith;
        const scoreA = keithSide === 'a' ? g.score_keith : g.score_sonia;
        const scoreB = keithSide === 'a' ? g.score_sonia : g.score_keith;
        db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, current_turn,
          bag, board, rack_a, rack_b, score_a, score_b, consecutive_scoreless_turns,
          ended_reason, winner_side, created_at, updated_at)
          VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          aId, bId, g.status, sideMap(g.current_turn),
          g.bag, g.board, rackA, rackB, scoreA, scoreB,
          g.consecutive_scoreless_turns, g.ended_reason,
          g.winner ? sideMap(g.winner) : null,
          g.created_at, g.updated_at
        );
      }
    }

    // 3. Rebuild moves with game_id + side; drop player_id.
    if (tableExists(db, 'moves') && tableHasColumn(db, 'moves', 'player_id')) {
      db.exec(`
        CREATE TABLE moves_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id INTEGER NOT NULL REFERENCES games(id),
          side TEXT NOT NULL CHECK (side IN ('a', 'b')),
          kind TEXT NOT NULL CHECK (kind IN ('play', 'pass', 'swap', 'resign')),
          placement TEXT,
          words_formed TEXT,
          score_delta INTEGER NOT NULL DEFAULT 0,
          client_nonce TEXT,
          created_at INTEGER NOT NULL
        );
      `);
      db.prepare(`
        INSERT INTO moves_v2 (id, game_id, side, kind, placement, words_formed, score_delta, client_nonce, created_at)
        SELECT id, 1,
          CASE player_id WHEN 'keith' THEN ? ELSE ? END,
          kind, placement, words_formed, score_delta, client_nonce, created_at
        FROM moves
      `).run(keithSide, soniaSide);
      db.exec('DROP TABLE moves;');
      db.exec('ALTER TABLE moves_v2 RENAME TO moves;');
      db.exec(`CREATE UNIQUE INDEX moves_nonce_per_game
               ON moves(game_id, client_nonce) WHERE client_nonce IS NOT NULL;`);
    }

    // 4. Stash legacy_game_history if present.
    if (tableExists(db, 'game_history')) {
      db.exec('ALTER TABLE game_history RENAME TO legacy_game_history;');
    }

    dropLegacy(db);
  });
  tx();
}

function dropLegacy(db) {
  if (tableExists(db, 'game')) db.exec('DROP TABLE game;');
  if (tableExists(db, 'players')) db.exec('DROP TABLE players;');
}
