import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import {
  createGame, listGamesForUser, sideForUser, findActiveGameForPair,
} from '../src/server/games.js';

function withTwoUsers() {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  return { db, a, b };
}

function makeGame(db, p1, p2, gameType = 'stub', initialState = {}) {
  return createGame(db, { playerAId: p1, playerBId: p2, gameType, initialState });
}

test('createGame canonicalizes pair (a < b regardless of arg order)', () => {
  const { db, a, b } = withTwoUsers();
  const g = makeGame(db, b.id, a.id);
  assert.equal(g.playerAId, Math.min(a.id, b.id));
  assert.equal(g.playerBId, Math.max(a.id, b.id));
  assert.equal(g.status, 'active');
});

test('createGame rejects self-pairing', () => {
  const { db, a } = withTwoUsers();
  assert.throws(() => makeGame(db, a.id, a.id), /self/i);
});

test('sideForUser returns a or b correctly', () => {
  const { db, a, b } = withTwoUsers();
  const g = makeGame(db, a.id, b.id);
  assert.equal(sideForUser(g, a.id), 'a');
  assert.equal(sideForUser(g, b.id), 'b');
  assert.equal(sideForUser(g, 999), null);
});

test('listGamesForUser returns games where user is a or b', () => {
  const { db, a, b } = withTwoUsers();
  const g = makeGame(db, a.id, b.id);
  const xs = listGamesForUser(db, a.id);
  assert.equal(xs.length, 1);
  assert.equal(xs[0].id, g.id);
});

test('findActiveGameForPair returns the active game regardless of arg order', () => {
  const { db, a, b } = withTwoUsers();
  const g = makeGame(db, a.id, b.id);
  assert.equal(findActiveGameForPair(db, a.id, b.id).id, g.id);
  assert.equal(findActiveGameForPair(db, b.id, a.id).id, g.id);
});

test('findActiveGameForPair returns null when no active game exists', () => {
  const { db, a, b } = withTwoUsers();
  assert.equal(findActiveGameForPair(db, a.id, b.id), null);
});

test('findActiveGameForPair ignores ended games', () => {
  const { db, a, b } = withTwoUsers();
  const g = makeGame(db, a.id, b.id);
  db.prepare("UPDATE games SET status='ended' WHERE id = ?").run(g.id);
  assert.equal(findActiveGameForPair(db, a.id, b.id), null);
});
