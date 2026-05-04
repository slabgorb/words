import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, getGameState, persistMove, resetGame } from '../src/server/db.js';

test('openDb creates schema, seeds players, seeds active game', () => {
  const db = openDb(':memory:');
  const players = db.prepare('SELECT * FROM players ORDER BY id').all();
  assert.equal(players.length, 2);
  assert.equal(players[0].id, 'keith');
  const state = getGameState(db);
  assert.equal(state.status, 'active');
  assert.equal(state.currentTurn, 'keith');
  assert.equal(state.racks.keith.length, 7);
  assert.equal(state.racks.sonia.length, 7);
  assert.equal(state.bag.length, 104 - 14);
});

test('persistMove updates state and inserts moves row', () => {
  const db = openDb(':memory:');
  const state = getGameState(db);
  state.scores.keith = 12;
  const result = persistMove(db, state, {
    playerId: 'keith', kind: 'play', placement: [{ r:7, c:7, letter:'A' }],
    wordsFormed: ['A'], scoreDelta: 12, clientNonce: 'n1'
  });
  assert.equal(result.idempotent, false);
  const after = getGameState(db);
  assert.equal(after.scores.keith, 12);
  const moves = db.prepare('SELECT * FROM moves').all();
  assert.equal(moves.length, 1);
});

test('persistMove with duplicate nonce is idempotent', () => {
  const db = openDb(':memory:');
  const state = getGameState(db);
  persistMove(db, state, { playerId:'keith', kind:'pass', clientNonce:'dup' });
  const second = persistMove(db, state, { playerId:'keith', kind:'pass', clientNonce:'dup' });
  assert.equal(second.idempotent, true);
  const moves = db.prepare('SELECT * FROM moves').all();
  assert.equal(moves.length, 1);
});

test('resetGame archives and reinitializes', () => {
  const db = openDb(':memory:');
  resetGame(db);
  const history = db.prepare('SELECT COUNT(*) AS n FROM game_history').get().n;
  assert.equal(history, 1);
  const state = getGameState(db);
  assert.equal(state.status, 'active');
});
