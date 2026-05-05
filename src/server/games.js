import { freshGameDeal, emptyBoard } from './db.js';

function rowToGame(row) {
  if (!row) return null;
  const state = JSON.parse(row.state);
  return {
    id: row.id,
    playerAId: row.player_a_id,
    playerBId: row.player_b_id,
    status: row.status,
    gameType: row.game_type,
    state,                              // raw plugin state
    // Words-flat compatibility fields, derived from state:
    currentTurn: state.activeSide,
    bag: state.bag,
    board: state.board,
    rackA: state.racks?.a,
    rackB: state.racks?.b,
    scoreA: state.scores?.a,
    scoreB: state.scores?.b,
    consecutiveScorelessTurns: state.consecutiveScorelessTurns,
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

export function initialWordsState() {
  const { bag, rackA, rackB } = freshGameDeal();
  const startSide = Math.random() < 0.5 ? 'a' : 'b';
  return {
    bag,
    board: emptyBoard(),
    racks: { a: rackA, b: rackB },
    scores: { a: 0, b: 0 },
    activeSide: startSide,
    consecutiveScorelessTurns: 0,
    initialMoveDone: false,
  };
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

// Backwards-compatible wrapper for existing callers that just want a Words game
export function createWordsGame(db, userId1, userId2) {
  return createGame(db, {
    playerAId: userId1,
    playerBId: userId2,
    gameType: 'words',
    initialState: initialWordsState(),
  });
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
    const newState = {
      bag: nextState.bag,
      board: nextState.board,
      racks: { a: nextState.rackA, b: nextState.rackB },
      scores: { a: nextState.scoreA, b: nextState.scoreB },
      activeSide: nextState.currentTurn,
      consecutiveScorelessTurns: nextState.consecutiveScorelessTurns,
      initialMoveDone: (nextState.scoreA ?? 0) > 0 || (nextState.scoreB ?? 0) > 0,
    };
    db.prepare(`UPDATE games SET
      status = ?, state = ?,
      ended_reason = ?, winner_side = ?,
      updated_at = ? WHERE id = ?`).run(
      nextState.status ?? (nextState.endedReason ? 'ended' : 'active'),
      JSON.stringify(newState),
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
  return createWordsGame(db, prev.playerAId, prev.playerBId);
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
