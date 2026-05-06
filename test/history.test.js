import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { appendTurnEntry, listTurnEntries } from '../src/server/history.js';

function setupDb() {
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f00', ?)").run(now);
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#0f0', ?)").run(now);
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
              VALUES (1, 1, 2, 'active', 'words', '{}', ?, ?)`).run(now, now);
  return db;
}

test('appendTurnEntry assigns turn_number 1 for the first row', () => {
  const db = setupDb();
  const row = appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['HI'], scoreDelta: 5 });
  assert.equal(row.turnNumber, 1);
  assert.equal(row.side, 'a');
  assert.equal(row.kind, 'play');
  assert.deepEqual(row.summary, { kind: 'play', words: ['HI'], scoreDelta: 5 });
  assert.equal(typeof row.createdAt, 'number');
  assert.ok(row.createdAt > 0);
});

test('appendTurnEntry increments turn_number per game', () => {
  const db = setupDb();
  appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['HI'], scoreDelta: 5 });
  const second = appendTurnEntry(db, 1, 'b', 'pass', { kind: 'pass' });
  assert.equal(second.turnNumber, 2);
});

test('listTurnEntries returns rows oldest-first', () => {
  const db = setupDb();
  appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['ONE'], scoreDelta: 3 });
  appendTurnEntry(db, 1, 'b', 'pass', { kind: 'pass' });
  appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['TWO'], scoreDelta: 4 });
  const entries = listTurnEntries(db, 1);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(e => e.turnNumber), [1, 2, 3]);
  assert.equal(entries[0].summary.words[0], 'ONE');
  assert.equal(entries[2].summary.words[0], 'TWO');
});

test('appendTurnEntry isolates turn_number across games', () => {
  const db = setupDb();
  const now = Date.now();
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
              VALUES (2, 1, 2, 'active', 'rummikub', '{}', ?, ?)`).run(now, now);
  appendTurnEntry(db, 1, 'a', 'play', { kind: 'play', words: ['A'], scoreDelta: 1 });
  appendTurnEntry(db, 1, 'b', 'pass', { kind: 'pass' });
  const first2 = appendTurnEntry(db, 2, 'a', 'draw-tile', { kind: 'draw-tile' });
  assert.equal(first2.turnNumber, 1);
});
