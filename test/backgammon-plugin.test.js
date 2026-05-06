import { test } from 'node:test';
import assert from 'node:assert/strict';
import backgammonPlugin from '../plugins/backgammon/plugin.js';
import { validatePlugin } from '../src/server/plugins.js';

test('plugin manifest passes validator', () => {
  assert.doesNotThrow(() => validatePlugin(backgammonPlugin));
});

test('manifest fields', () => {
  assert.equal(backgammonPlugin.id, 'backgammon');
  assert.equal(backgammonPlugin.displayName, 'Backgammon');
  assert.equal(backgammonPlugin.players, 2);
  assert.match(backgammonPlugin.clientDir, /plugins\/backgammon\/client/);
});
