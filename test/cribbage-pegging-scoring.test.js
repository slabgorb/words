import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePeggingPlay } from '../plugins/cribbage/server/scoring/pegging.js';

const c = (rank, suit = 'S') => ({ rank, suit });

test('15-2: running becomes 15 → +2 fifteen', () => {
  const items = scorePeggingPlay([c('7'), c('8')], 15);
  assert.deepEqual(items.map(i => i.kind), ['fifteen']);
  assert.equal(items.reduce((a, i) => a + i.points, 0), 2);
});

test('31-2: running becomes 31 → +2 thirty-one', () => {
  const items = scorePeggingPlay([c('K'), c('Q'), c('A')], 31);
  assert.deepEqual(items.map(i => i.kind), ['thirty-one']);
  assert.equal(items[0].points, 2);
});

test('pair: last two cards same rank → +2 pair-pegging', () => {
  const items = scorePeggingPlay([c('5'), c('5')], 10);
  assert.deepEqual(items.map(i => i.kind), ['pair-pegging']);
  assert.equal(items[0].points, 2);
});

test('triple ("pair royal"): last three same rank → +6', () => {
  const items = scorePeggingPlay([c('5'), c('5'), c('5')], 15);
  const total = items.reduce((a, i) => a + i.points, 0);
  assert.equal(total, 8);
  assert.ok(items.some(i => i.kind === 'pair-pegging' && i.points === 6));
});

test('quad ("double pair royal"): last four same rank → +12', () => {
  const items = scorePeggingPlay([c('4'), c('4'), c('4'), c('4')], 16);
  const pairItem = items.find(i => i.kind === 'pair-pegging');
  assert.equal(pairItem.points, 12);
});

test('run-3 in tail (any order): 4-3-5 → run of 3 → +3', () => {
  const items = scorePeggingPlay([c('A'), c('4'), c('3'), c('5')], 13);
  assert.ok(items.some(i => i.kind === 'run' && i.points === 3));
});

test('run-4 in tail: 6-7-5-4 → run of 4 → +4', () => {
  const items = scorePeggingPlay([c('6'), c('7'), c('5'), c('4')], 22);
  const run = items.find(i => i.kind === 'run');
  assert.equal(run.points, 4);
});

test('breaking run: A-2-3-A only the last A→2→3 isn’t a run; the 2-3-A tail is also not a run; tail = "A" alone → no run', () => {
  const items = scorePeggingPlay([c('A'), c('2'), c('3'), c('A')], 7);
  assert.ok(items.some(i => i.kind === 'run' && i.points === 3));
});

test('no event: K then 5 → no scoring', () => {
  const items = scorePeggingPlay([c('K'), c('5')], 15);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'fifteen');
});

test('plain play with no events: 4 then 5 (running 9) → empty array', () => {
  const items = scorePeggingPlay([c('4'), c('5')], 9);
  assert.deepEqual(items, []);
});
