import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileIdsOf, multisetEqual, multisetDiff } from '../plugins/rummikub/server/multiset.js';

const t = (id) => ({ id });

test('tileIdsOf flattens rack + table sets into a single array', () => {
  const ids = tileIdsOf({ rack: [t('a'), t('b')], table: [[t('c'), t('d')], [t('e')]] });
  assert.deepEqual(ids.sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('multisetEqual returns true for same ids in different order', () => {
  assert.equal(multisetEqual(['a', 'b', 'c'], ['c', 'a', 'b']), true);
});

test('multisetEqual returns false for different ids', () => {
  assert.equal(multisetEqual(['a', 'b'], ['a', 'c']), false);
});

test('multisetEqual returns false for different sizes', () => {
  assert.equal(multisetEqual(['a', 'b'], ['a', 'b', 'c']), false);
});

test('multisetDiff returns added/removed', () => {
  const d = multisetDiff(['a', 'b', 'c'], ['b', 'c', 'd']);
  assert.deepEqual(d.added.sort(), ['d']);
  assert.deepEqual(d.removed.sort(), ['a']);
});
