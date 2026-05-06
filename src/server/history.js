// Generic helpers for the shared turn_log table. Plugins own the shape of
// `summary`; this module owns persistence and ordering.

export function appendTurnEntry(db, gameId, side, kind, summary) {
  const now = Date.now();
  const max = db.prepare(
    'SELECT COALESCE(MAX(turn_number), 0) AS m FROM turn_log WHERE game_id = ?'
  ).get(gameId).m;
  const turnNumber = max + 1;
  const info = db.prepare(`
    INSERT INTO turn_log (game_id, turn_number, side, kind, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(gameId, turnNumber, side, kind, JSON.stringify(summary), now);
  return {
    id: info.lastInsertRowid,
    gameId,
    turnNumber,
    side,
    kind,
    summary,
    createdAt: now,
  };
}

export function listTurnEntries(db, gameId) {
  const rows = db.prepare(`
    SELECT id, game_id AS gameId, turn_number AS turnNumber, side, kind, summary, created_at AS createdAt
    FROM turn_log WHERE game_id = ? ORDER BY id ASC
  `).all(gameId);
  return rows.map(r => ({ ...r, summary: JSON.parse(r.summary) }));
}
