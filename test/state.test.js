import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { readGameState, writeGameState } from '../src/server/state.js';

test('readGameState returns parsed state and game_type', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f', 1)").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#g', 1)").run();
  db.prepare(`
    INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (1, 1, 2, 'active', 'words', ?, 1, 1)
  `).run(JSON.stringify({ scores: { a: 0, b: 0 } }));

  const result = readGameState(db, 1);
  assert.equal(result.gameType, 'words');
  assert.deepEqual(result.state, { scores: { a: 0, b: 0 } });
});

test('writeGameState round-trips an arbitrary state object', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f', 1)").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#g', 1)").run();
  db.prepare(`
    INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (1, 1, 2, 'active', 'words', '{}', 1, 1)
  `).run();

  writeGameState(db, 1, { foo: 'bar', n: 42 });
  const result = readGameState(db, 1);
  assert.deepEqual(result.state, { foo: 'bar', n: 42 });
});

test('writeGameState throws on missing game', () => {
  const db = openDb(':memory:');
  assert.throws(() => writeGameState(db, 999, {}), /not found/);
});
