function rowToGame(row) {
  if (!row) return null;
  const state = JSON.parse(row.state);
  // Map activeUserId → 'a'/'b' for backwards-compat consumers (lobby, /me, SSE clients)
  const currentTurn =
    state.sides?.a === state.activeUserId ? 'a' :
    state.sides?.b === state.activeUserId ? 'b' :
    state.activeSide ?? null;  // fallback for not-yet-migrated rows
  return {
    id: row.id,
    playerAId: row.player_a_id,
    playerBId: row.player_b_id,
    status: row.status,
    gameType: row.game_type,
    state,
    currentTurn,
    endedReason: row.ended_reason,
    winnerSide: row.winner_side,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function sideForUser(game, userId) {
  if (game.playerAId === userId) return 'a';
  if (game.playerBId === userId) return 'b';
  return null;
}

export function createGame(db, { playerAId, playerBId, gameType, initialState }) {
  if (playerAId === playerBId) throw new Error('cannot start a game with self');
  const aId = Math.min(playerAId, playerBId);
  const bId = Math.max(playerAId, playerBId);
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, ?, ?)
  `).run(aId, bId, gameType, JSON.stringify(initialState), now, now);
  return getGameById(db, info.lastInsertRowid);
}

export function getGameById(db, id) {
  return rowToGame(db.prepare('SELECT * FROM games WHERE id = ?').get(id));
}

export function listGamesForUser(db, userId) {
  return db.prepare(
    'SELECT * FROM games WHERE player_a_id = ? OR player_b_id = ? ORDER BY updated_at DESC'
  ).all(userId, userId).map(rowToGame);
}

export function findActiveGameForPair(db, userId1, userId2) {
  const aId = Math.min(userId1, userId2);
  const bId = Math.max(userId1, userId2);
  return rowToGame(db.prepare(
    "SELECT * FROM games WHERE player_a_id = ? AND player_b_id = ? AND status = 'active'"
  ).get(aId, bId));
}

export function endGame(db, id, { endedReason, winnerSide, finalState }) {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE games SET
      status = 'ended', state = ?,
      ended_reason = ?, winner_side = ?,
      updated_at = ? WHERE id = ?`).run(
      JSON.stringify(finalState),
      endedReason ?? null,
      winnerSide ?? null,
      Date.now(),
      id
    );
  });
  tx();
  return getGameById(db, id);
}
