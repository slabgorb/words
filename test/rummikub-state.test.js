import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/rummikub/server/state.js';

const participants = [
  { userId: 1, side: 'a' },
  { userId: 2, side: 'b' },
];
let counter = 0;
const det = () => { counter += 0.137; return counter % 1; };

test('initialState deals 14 to each rack and 78 to pool (106 - 28)', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.equal(s.racks.a.length, 14);
  assert.equal(s.racks.b.length, 14);
  assert.equal(s.pool.length, 78);
});

test('initialState: total tiles is 106', () => {
  const s = buildInitialState({ participants, rng: det });
  const total = s.racks.a.length + s.racks.b.length + s.pool.length + s.table.flat().length;
  assert.equal(total, 106);
});

test('initialState: table starts empty', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.deepEqual(s.table, []);
});

test('initialState: activeUserId is one of the participants', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.ok(s.activeUserId === 1 || s.activeUserId === 2);
});

test('initialState: sides map participants', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.equal(s.sides.a, 1);
  assert.equal(s.sides.b, 2);
});

test('initialState: tile ids are unique across racks + pool + table', () => {
  const s = buildInitialState({ participants, rng: det });
  const allIds = [
    ...s.racks.a.map(t => t.id),
    ...s.racks.b.map(t => t.id),
    ...s.pool.map(t => t.id),
  ];
  assert.equal(new Set(allIds).size, 106);
});

test('initialState: initial-meld flags both false; passes/scores zero', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.deepEqual(s.initialMeldComplete, { a: false, b: false });
  assert.deepEqual(s.scores, { a: 0, b: 0 });
});

test('initialState: deterministic given same RNG', () => {
  let c1 = 0; const r1 = () => { c1 += 0.137; return c1 % 1; };
  let c2 = 0; const r2 = () => { c2 += 0.137; return c2 % 1; };
  const s1 = buildInitialState({ participants, rng: r1 });
  const s2 = buildInitialState({ participants, rng: r2 });
  assert.deepEqual(s1.racks.a.map(t => t.id), s2.racks.a.map(t => t.id));
  assert.deepEqual(s1.pool.map(t => t.id), s2.pool.map(t => t.id));
});
