import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDictionary } from '../src/server/dictionary.js';

test('dictionary loads and contains common words', () => {
  const dict = loadDictionary();
  assert.equal(dict.isWord('HELLO'), true);
  assert.equal(dict.isWord('QUIRK'), true);
  assert.equal(dict.isWord('XYZZY'), false);
});

test('dictionary lookups are case-insensitive', () => {
  const dict = loadDictionary();
  assert.equal(dict.isWord('hello'), true);
  assert.equal(dict.isWord('Hello'), true);
});
