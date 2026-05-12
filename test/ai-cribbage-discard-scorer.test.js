import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDiscardCandidates } from '../plugins/cribbage/server/ai/discard-scorer.js';

const C = (rank, suit) => ({ rank, suit });

test('returns at most topN candidates, sorted by totalEV descending', () => {
  const hand = [C('A','H'), C('5','C'), C('7','D'), C('9','S'), C('J','H'), C('Q','C')];
  const out = scoreDiscardCandidates(hand, { isDealer: true, topN: 4 });
  assert.equal(out.length, 4);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].totalEV >= out[i].totalEV,
      `out[${i - 1}].totalEV (${out[i - 1].totalEV}) >= out[${i}].totalEV (${out[i].totalEV})`);
  }
});

test('classic triple-five dealer hand: keep 5,5,5,J ranks at the top', () => {
  // 5,5,5,J,Q,K — the textbook "his nobs" hand. Keep three fives + jack
  // (eight + nobs potential); throw Q,K to your own crib (two tens).
  const hand = [C('5','H'), C('5','C'), C('5','S'), C('J','D'), C('Q','H'), C('K','C')];
  const out = scoreDiscardCandidates(hand, { isDealer: true, topN: 4 });
  const top = out[0];
  const keepRanks = top.keep.map(c => c.rank).sort();
  assert.deepEqual(keepRanks, ['5','5','5','J'], `expected top keep to be 5,5,5,J; got ${keepRanks}`);
  // Throw should be Q,K (the two ten-cards).
  const throwRanks = top.throwPair.map(c => c.rank).sort();
  assert.deepEqual(throwRanks, ['K','Q']);
});

test('dealer vs non-dealer: same hand flips crib EV sign for ten-card throws', () => {
  // A hand where the throw includes a 5 — its crib value swings between
  // dealer (positive) and non-dealer (negative).
  const hand = [C('5','H'), C('5','C'), C('K','D'), C('Q','S'), C('J','H'), C('T','C')];
  const dealer = scoreDiscardCandidates(hand, { isDealer: true, topN: 15 });
  const nonDealer = scoreDiscardCandidates(hand, { isDealer: false, topN: 15 });
  // Same set of 15 candidates, just re-sorted by totalEV.
  assert.equal(dealer.length, 15);
  assert.equal(nonDealer.length, 15);
  // For at least one matching candidate the cribEV should be opposite sign.
  const sameId = dealer.find(d => d.cribEV !== 0);
  const opposite = nonDealer.find(n => n.id === sameId.id);
  assert.equal(opposite.cribEV, -sameId.cribEV);
});

test('crashes on wrong-size hand', () => {
  assert.throws(() => scoreDiscardCandidates([C('A','H')], { isDealer: true }), /needs 6 cards/);
});
