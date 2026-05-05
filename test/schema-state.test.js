import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';

test('games has game_type column with default "words"', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(games)").all();
  const col = cols.find(c => c.name === 'game_type');
  assert.ok(col, 'game_type column missing');
  assert.equal(col.type, 'TEXT');
  assert.equal(col.notnull, 1);
  assert.equal(col.dflt_value, "'words'");
});

test('games has state column (JSON text, default {})', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(games)").all();
  const col = cols.find(c => c.name === 'state');
  assert.ok(col, 'state column missing');
  assert.equal(col.type, 'TEXT');
  assert.equal(col.notnull, 1);
});

test('one_active_per_pair_type partial unique index exists', () => {
  const db = openDb(':memory:');
  const idx = db.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='one_active_per_pair_type'"
  ).get();
  assert.ok(idx, 'one_active_per_pair_type index missing');
  assert.match(idx.sql, /game_type/);
  assert.match(idx.sql, /WHERE\s+status\s*=\s*'active'/i);
});

test('legacy one_active_per_pair index is removed', () => {
  const db = openDb(':memory:');
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='one_active_per_pair'"
  ).get();
  assert.equal(idx, undefined, 'legacy index should be dropped');
});
