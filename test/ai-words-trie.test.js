import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEnableTrie } from '../plugins/words/server/ai/trie.js';

test('trie recognises known ENABLE2K words and rejects garbage', () => {
  const trie = getEnableTrie();
  // ENABLE2K contains common Scrabble words.
  assert.equal(trie.has('CAT'), true);
  assert.equal(trie.has('SLATIER'), true);  // valid 7-letter
  assert.equal(trie.has('AE'), true);       // valid 2-letter (QI is not in ENABLE2K)
  assert.equal(trie.has('XYZZY'), false);
  assert.equal(trie.has('SHOULDNTBEINENABLE'), false);
});

test('getEnableTrie is memoised — same instance returned across calls', () => {
  const a = getEnableTrie();
  const b = getEnableTrie();
  assert.equal(a, b);
});
