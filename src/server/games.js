import { freshGameDeal, emptyBoard } from './db.js';

function rowToGame(row) {
  if (!row) return null;
  return {
    id: row.id,
    playerAId: row.player_a_id,
    playerBId: row.player_b_id,
    status: row.status,
    currentTurn: row.current_turn,
    bag: JSON.parse(row.bag),
    board: JSON.parse(row.board),
    rackA: JSON.parse(row.rack_a),
    rackB: JSON.parse(row.rack_b),
    scoreA: row.score_a,
    scoreB: row.score_b,
    consecutiveScorelessTurns: row.consecutive_scoreless_turns,
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

export function createGame(db, userId1, userId2) {
  if (userId1 === userId2) throw new Error('cannot start a game with self');
  const aId = Math.min(userId1, userId2);
  const bId = Math.max(userId1, userId2);
  const { bag, rackA, rackB } = freshGameDeal();
  const startSide = Math.random() < 0.5 ? 'a' : 'b';
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, current_turn, bag, board,
      rack_a, rack_b, score_a, score_b, consecutive_scoreless_turns,
      ended_reason, winner_side, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, ?, ?)
  `).run(aId, bId, startSide, JSON.stringify(bag), JSON.stringify(emptyBoard()),
         JSON.stringify(rackA), JSON.stringify(rackB), now, now);
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

export function persistMove(db, gameId, nextState, moveRecord) {
  const tx = db.transaction(() => {
    if (moveRecord.clientNonce) {
      const existing = db.prepare(
        'SELECT id FROM moves WHERE game_id = ? AND client_nonce = ?'
      ).get(gameId, moveRecord.clientNonce);
      if (existing) return { moveId: existing.id, idempotent: true };
    }
    db.prepare(`UPDATE games SET
      status = ?, current_turn = ?, bag = ?, board = ?,
      rack_a = ?, rack_b = ?, score_a = ?, score_b = ?,
      consecutive_scoreless_turns = ?, ended_reason = ?, winner_side = ?,
      updated_at = ? WHERE id = ?`).run(
      nextState.status ?? (nextState.endedReason ? 'ended' : 'active'),
      nextState.currentTurn,
      JSON.stringify(nextState.bag),
      JSON.stringify(nextState.board),
      JSON.stringify(nextState.rackA),
      JSON.stringify(nextState.rackB),
      nextState.scoreA,
      nextState.scoreB,
      nextState.consecutiveScorelessTurns,
      nextState.endedReason ?? null,
      nextState.winnerSide ?? null,
      Date.now(),
      gameId
    );
    const info = db.prepare(`INSERT INTO moves
      (game_id, side, kind, placement, words_formed, score_delta, client_nonce, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      gameId,
      moveRecord.side,
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

export function resetGameForPair(db, prevGameId) {
  const prev = getGameById(db, prevGameId);
  if (!prev) throw new Error('game not found');
  return createGame(db, prev.playerAId, prev.playerBId);
}
