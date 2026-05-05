// Generic JSON-state helpers for the games table.
// Plugins own the *shape* of state; this module owns the *transport*.

export function readGameState(db, gameId) {
  const row = db.prepare(`SELECT state, game_type FROM games WHERE id = ?`).get(gameId);
  if (!row) return null;
  return { state: JSON.parse(row.state), gameType: row.game_type };
}

export function writeGameState(db, gameId, state) {
  const stmt = db.prepare(`UPDATE games SET state = ?, updated_at = datetime('now') WHERE id = ?`);
  const info = stmt.run(JSON.stringify(state), gameId);
  if (info.changes !== 1) throw new Error(`writeGameState: game ${gameId} not found`);
}
