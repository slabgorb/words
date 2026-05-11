function rowToSession(row) {
  if (!row) return null;
  return {
    gameId: row.game_id,
    botUserId: row.bot_user_id,
    personaId: row.persona_id,
    claudeSessionId: row.claude_session_id,
    stalledAt: row.stalled_at,
    stallReason: row.stall_reason,
    pendingSequence: row.pending_sequence ? JSON.parse(row.pending_sequence) : null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function createAiSession(db, { gameId, botUserId, personaId }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO ai_sessions (game_id, bot_user_id, persona_id, claude_session_id,
                             stalled_at, stall_reason, created_at, last_used_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)
  `).run(gameId, botUserId, personaId, now, now);
}

export function getAiSession(db, gameId) {
  return rowToSession(db.prepare("SELECT * FROM ai_sessions WHERE game_id = ?").get(gameId));
}

export function setClaudeSessionId(db, gameId, claudeSessionId) {
  db.prepare("UPDATE ai_sessions SET claude_session_id = ?, last_used_at = ? WHERE game_id = ?")
    .run(claudeSessionId, Date.now(), gameId);
}

export function markStalled(db, gameId, reason) {
  db.prepare("UPDATE ai_sessions SET stalled_at = ?, stall_reason = ?, pending_sequence = NULL, last_used_at = ? WHERE game_id = ?")
    .run(Date.now(), reason, Date.now(), gameId);
}

export function clearStall(db, gameId) {
  db.prepare("UPDATE ai_sessions SET stalled_at = NULL, stall_reason = NULL, last_used_at = ? WHERE game_id = ?")
    .run(Date.now(), gameId);
}

// Used at server boot to find bot turns that were in-flight or stalled
// when the server stopped, so the orchestrator can resume them.
export function listStalledOrInFlight(db) {
  return db.prepare(`
    SELECT s.* FROM ai_sessions s
    JOIN games g ON g.id = s.game_id
    WHERE g.status = 'active'
      AND (
        s.stalled_at IS NOT NULL
        OR json_extract(g.state, '$.activeUserId') = s.bot_user_id
        OR json_extract(g.state, '$.activeUserId') IS NULL
      )
  `).all().map(rowToSession);
}

export function setPendingSequence(db, gameId, sequence) {
  const value = (Array.isArray(sequence) && sequence.length > 0) ? JSON.stringify(sequence) : null;
  db.prepare("UPDATE ai_sessions SET pending_sequence = ?, last_used_at = ? WHERE game_id = ?")
    .run(value, Date.now(), gameId);
}

export function clearPendingSequence(db, gameId) {
  db.prepare("UPDATE ai_sessions SET pending_sequence = NULL, last_used_at = ? WHERE game_id = ?")
    .run(Date.now(), gameId);
}
