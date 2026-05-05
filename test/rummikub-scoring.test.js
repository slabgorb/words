import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFinalScores } from '../plugins/rummikub/server/scoring.js';

const num = (v) => ({ id: `n${v}-${Math.random()}`, kind: 'numbered', value: v, color: 'red' });
const joker = () => ({ id: `j-${Math.random()}`, kind: 'joker' });

test('winner gets +sum of loser remaining; loser goes negative', () => {
  const result = computeFinalScores({
    winnerSide: 'a',
    racks: { a: [], b: [num(3), num(5)] },
  });
  assert.deepEqual(result.scoreDeltas, { a: +8, b: -8 });
});

test('joker counts as 30 in remaining-rack penalty', () => {
  const result = computeFinalScores({
    winnerSide: 'b',
    racks: { a: [num(2), joker()], b: [] },
  });
  assert.deepEqual(result.scoreDeltas, { b: +32, a: -32 });
});

test('no winner (pool exhausted) — fewest tiles wins; both go negative; winner gets sum', () => {
  const result = computeFinalScores({
    winnerSide: null,
    racks: {
      a: [num(1), num(2), num(3)],
      b: [num(1), num(2), num(3), num(4), num(5)],
    },
  });
  assert.equal(result.winnerSide, 'a');
  assert.deepEqual(result.scoreDeltas, { a: +15, b: -15 });
});
