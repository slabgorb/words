import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';

test('openDb creates users table with email/friendly_name/color', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  assert.deepEqual(cols.sort(), ['color', 'created_at', 'email', 'friendly_name', 'id']);
});

test('openDb creates games table with pair canonicalization check', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  for (const expected of ['id', 'player_a_id', 'player_b_id', 'status',
    'current_turn', 'bag', 'board', 'rack_a', 'rack_b', 'score_a', 'score_b',
    'consecutive_scoreless_turns', 'ended_reason', 'winner_side',
    'created_at', 'updated_at', 'game_type', 'state']) {
    assert.ok(cols.includes(expected), `games missing column ${expected}`);
  }
});

test('one_active_per_pair_type partial unique index exists', () => {
  const db = openDb(':memory:');
  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name='one_active_per_pair_type'").get();
  assert.ok(idx, 'index missing');
  assert.match(idx.sql, /WHERE\s+status\s*=\s*'active'/i);
});

test('moves table has game_id and side columns; client_nonce unique per game', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(moves)").all().map(c => c.name);
  for (const expected of ['id', 'game_id', 'side', 'kind', 'placement',
    'words_formed', 'score_delta', 'client_nonce', 'created_at']) {
    assert.ok(cols.includes(expected), `moves missing ${expected}`);
  }
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='moves_nonce_per_game'").get();
  assert.ok(idx, 'moves_nonce_per_game index missing');
});
