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

test('initialState produces full game state with default match length', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  const s = backgammonPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  assert.equal(s.match.target, 3);
  assert.equal(s.board.points.length, 24);
  assert.equal(s.turn.phase, 'initial-roll');
});

test('publicView wired through plugin manifest', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  const state = backgammonPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  const view = backgammonPlugin.publicView({ state, viewerId: 1 });
  assert.equal(view.youAre, 'a');
});

test('applyAction wired through plugin manifest (roll-initial flow)', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  let state = backgammonPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  state = backgammonPlugin.applyAction({
    state, actorId: 1, rng,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: [] } },
  }).state;
  const result = backgammonPlugin.applyAction({
    state, actorId: 2, rng,
    action: { type: 'roll-initial', payload: { value: 3, throwParams: [] } },
  });
  assert.equal(result.state.turn.activePlayer, 'a');
  assert.equal(result.state.turn.phase, 'moving');
});

test('plugin appears in host registry', async () => {
  const { plugins } = await import('../src/plugins/index.js');
  assert.equal(plugins.backgammon, backgammonPlugin);
});
