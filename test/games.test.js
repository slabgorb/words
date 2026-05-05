import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import {
  createWordsGame, getGameById, listGamesForUser, resetGameForPair, sideForUser,
  findActiveGameForPair
} from '../src/server/games.js';
import { TILE_BAG } from '../plugins/words/server/board.js';

function withTwoUsers() {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  return { db, a, b };
}

test('createWordsGame canonicalizes pair (a < b regardless of arg order)', () => {
  const { db, a, b } = withTwoUsers();
  const g = createWordsGame(db, b.id, a.id);
  assert.equal(g.playerAId, Math.min(a.id, b.id));
  assert.equal(g.playerBId, Math.max(a.id, b.id));
  assert.equal(g.status, 'active');
  assert.match(g.currentTurn, /^[ab]$/);
  assert.equal(g.rackA.length, 7);
  assert.equal(g.rackB.length, 7);
  // Bag is whatever's left after dealing 14 from TILE_BAG.
  // Don't hardcode 90 vs 86 here — derive from TILE_BAG length.
  assert.equal(g.rackA.length + g.rackB.length + g.bag.length, TILE_BAG.length);
});

test('createWordsGame rejects duplicate active pair', () => {
  const { db, a, b } = withTwoUsers();
  createWordsGame(db, a.id, b.id);
  assert.throws(() => createWordsGame(db, a.id, b.id), /one[_ ]active[_ ]per[_ ]pair|UNIQUE/i);
});

test('createWordsGame rejects self-pairing', () => {
  const { db, a } = withTwoUsers();
  assert.throws(() => createWordsGame(db, a.id, a.id), /self/i);
});

test('sideForUser returns a or b correctly', () => {
  const { db, a, b } = withTwoUsers();
  const g = createWordsGame(db, a.id, b.id);
  assert.equal(sideForUser(g, a.id), 'a');
  assert.equal(sideForUser(g, b.id), 'b');
  assert.equal(sideForUser(g, 999), null);
});

test('listGamesForUser returns games where user is a or b', () => {
  const { db, a, b } = withTwoUsers();
  const g = createWordsGame(db, a.id, b.id);
  const xs = listGamesForUser(db, a.id);
  assert.equal(xs.length, 1);
  assert.equal(xs[0].id, g.id);
});


test('resetGameForPair marks current ended game and creates a fresh active game for the same pair', () => {
  const { db, a, b } = withTwoUsers();
  const g = createWordsGame(db, a.id, b.id);
  // Simulate ended state
  db.prepare("UPDATE games SET status='ended', ended_reason='resigned' WHERE id = ?").run(g.id);
  const fresh = resetGameForPair(db, g.id);
  assert.notEqual(fresh.id, g.id);
  assert.equal(fresh.status, 'active');
  assert.equal(getGameById(db, g.id).status, 'ended');
});

test('findActiveGameForPair returns the active game regardless of arg order', () => {
  const { db, a, b } = withTwoUsers();
  const g = createWordsGame(db, a.id, b.id);
  assert.equal(findActiveGameForPair(db, a.id, b.id).id, g.id);
  assert.equal(findActiveGameForPair(db, b.id, a.id).id, g.id);
});

test('findActiveGameForPair returns null when no active game exists', () => {
  const { db, a, b } = withTwoUsers();
  assert.equal(findActiveGameForPair(db, a.id, b.id), null);
});

test('findActiveGameForPair ignores ended games', () => {
  const { db, a, b } = withTwoUsers();
  const g = createWordsGame(db, a.id, b.id);
  db.prepare("UPDATE games SET status='ended' WHERE id = ?").run(g.id);
  assert.equal(findActiveGameForPair(db, a.id, b.id), null);
});
