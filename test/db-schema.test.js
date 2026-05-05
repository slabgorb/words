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
    'ended_reason', 'winner_side',
    'created_at', 'updated_at', 'game_type', 'state']) {
    assert.ok(cols.includes(expected), `games missing column ${expected}`);
  }
  // Legacy columns (bag, board, rack_a, rack_b, etc.) must be dropped after migration
  for (const dropped of ['current_turn', 'bag', 'board', 'rack_a', 'rack_b',
    'score_a', 'score_b', 'consecutive_scoreless_turns']) {
    assert.ok(!cols.includes(dropped), `games should not have legacy column ${dropped}`);
  }
});

test('one_active_per_pair_type partial unique index exists', () => {
  const db = openDb(':memory:');
  const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name='one_active_per_pair_type'").get();
  assert.ok(idx, 'index missing');
  assert.match(idx.sql, /WHERE\s+status\s*=\s*'active'/i);
});

test('turn_log table exists with expected columns', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(turn_log)").all().map(c => c.name);
  for (const expected of ['id', 'game_id', 'turn_number', 'side', 'kind', 'summary', 'created_at']) {
    assert.ok(cols.includes(expected), `turn_log missing ${expected}`);
  }
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='turn_log_by_game'").get();
  assert.ok(idx, 'turn_log_by_game index missing');
});

test('legacy moves table is dropped', () => {
  const db = openDb(':memory:');
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='moves'").get();
  assert.equal(row, undefined, 'moves table should not exist after migration');
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='moves_nonce_per_game'").get();
  assert.equal(idx, undefined, 'moves_nonce_per_game index should be dropped');
});
