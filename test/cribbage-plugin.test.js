import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlugin } from '../src/server/plugins.js';
import cribbage from '../plugins/cribbage/plugin.js';

test('cribbage plugin: shape passes validatePlugin', () => {
  validatePlugin(cribbage);
  assert.equal(cribbage.id, 'cribbage');
  assert.equal(cribbage.players, 2);
  assert.equal(cribbage.displayName, 'Cribbage');
  assert.equal(cribbage.clientDir, 'plugins/cribbage/client');
});

test('cribbage plugin: registered in src/plugins/index.js', async () => {
  const { plugins } = await import('../src/plugins/index.js');
  assert.ok(plugins.cribbage, 'cribbage missing from registry');
  assert.equal(plugins.cribbage.id, 'cribbage');
});
