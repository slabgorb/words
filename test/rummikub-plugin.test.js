import { test } from 'node:test';
import assert from 'node:assert/strict';
import rummikubPlugin from '../plugins/rummikub/plugin.js';
import { validatePlugin } from '../src/server/plugins.js';

test('plugin manifest passes validator', () => {
  assert.doesNotThrow(() => validatePlugin(rummikubPlugin));
});

test('manifest fields', () => {
  assert.equal(rummikubPlugin.id, 'rummikub');
  assert.equal(rummikubPlugin.displayName, 'Rummikub');
  assert.equal(rummikubPlugin.players, 2);
  assert.match(rummikubPlugin.clientDir, /plugins\/rummikub\/client/);
});

test('initialState produces full game state', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  const s = rummikubPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  assert.equal(s.racks.a.length, 14);
  assert.equal(s.racks.b.length, 14);
  assert.equal(s.pool.length, 78);
});

test('publicView is wired through', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  const state = rummikubPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  const view = rummikubPlugin.publicView({ state, viewerId: 1 });
  assert.ok(view.racks.a);
  assert.equal(view.racks.b, undefined);
});
