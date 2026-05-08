import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipValue, runValue } from '../plugins/cribbage/server/values.js';

test('pipValue: A=1, 2..9=face, T/J/Q/K=10', () => {
  assert.equal(pipValue({ rank: 'A', suit: 'S' }), 1);
  assert.equal(pipValue({ rank: '5', suit: 'H' }), 5);
  assert.equal(pipValue({ rank: '9', suit: 'D' }), 9);
  for (const r of ['T','J','Q','K']) {
    assert.equal(pipValue({ rank: r, suit: 'C' }), 10);
  }
});

test('runValue: A=1, T=10, J=11, Q=12, K=13', () => {
  assert.equal(runValue({ rank: 'A', suit: 'S' }), 1);
  assert.equal(runValue({ rank: 'T', suit: 'S' }), 10);
  assert.equal(runValue({ rank: 'J', suit: 'S' }), 11);
  assert.equal(runValue({ rank: 'Q', suit: 'S' }), 12);
  assert.equal(runValue({ rank: 'K', suit: 'S' }), 13);
});
