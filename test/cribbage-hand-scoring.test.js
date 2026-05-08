import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreHand } from '../plugins/cribbage/server/scoring/hand.js';

const c = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

test('29 hand: J♠ 5♥ 5♦ 5♣ + 5♠ → 29', () => {
  const hand = [c('5','H'), c('5','D'), c('5','C'), c('J','S')];
  const starter = c('5','S');
  const result = scoreHand(hand, starter, { isCrib: false });
  assert.equal(result.total, 29);
});

test('28 hand: J♥ 5♥ 5♦ 5♣ + 5♠ → 28 (J off-suit from starter)', () => {
  const hand = [c('5','H'), c('5','D'), c('5','C'), c('J','H')];
  const starter = c('5','S');
  const result = scoreHand(hand, starter, { isCrib: false });
  assert.equal(result.total, 28);
});

test('flush in hand (not crib): 4 hand cards same suit → 4; +5 if starter matches', () => {
  const handAll = [c('2','H'), c('5','H'), c('9','H'), c('T','H')];
  const offSuitStarter = c('K','S');
  const onSuitStarter = c('Q','H');
  const r1 = scoreHand(handAll, offSuitStarter, { isCrib: false });
  const flush1 = r1.items.find(i => i.kind === 'flush');
  assert.equal(flush1.points, 4);
  const r2 = scoreHand(handAll, onSuitStarter, { isCrib: false });
  const flush2 = r2.items.find(i => i.kind === 'flush');
  assert.equal(flush2.points, 5);
});

test('crib flush requires all 5: 4-suit hand + off-suit starter → no flush', () => {
  const hand = [c('2','H'), c('5','H'), c('9','H'), c('T','H')];
  const starter = c('K','S');
  const result = scoreHand(hand, starter, { isCrib: true });
  assert.equal(result.items.find(i => i.kind === 'flush'), undefined);
});

test('nobs: J in hand whose suit matches starter → +1', () => {
  const hand = [c('2','S'), c('3','S'), c('4','S'), c('J','S')];
  const starter = c('7','S');
  const result = scoreHand(hand, starter, { isCrib: false });
  assert.ok(result.items.some(i => i.kind === 'nobs' && i.points === 1));
});

test('counts every fifteen subset: 5-5-5-J + 5 → 8 fifteens (4 ways: each 5+J, 4 ways: 5+5+5)', () => {
  const hand = [c('5','H'), c('5','D'), c('5','C'), c('J','S')];
  const starter = c('5','S');
  const r = scoreHand(hand, starter, { isCrib: false });
  const fifteens = r.items.filter(i => i.kind === 'fifteen');
  assert.equal(fifteens.length, 8);
  assert.equal(fifteens.reduce((a,i)=>a+i.points,0), 16);
});

test('pair royal in hand: 5-5-5 → +6 emitted as ONE pair-pegging item with points=6', () => {
  const hand = [c('5','H'), c('5','D'), c('5','C'), c('K','S')];
  const starter = c('Q','D');
  const r = scoreHand(hand, starter, { isCrib: false });
  const pairs = r.items.filter(i => i.kind === 'pair');
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].points, 6);
});

test('double run: 6-6-7-8 → run-3 ×2 + pair = 8', () => {
  const hand = [c('6','H'), c('6','D'), c('7','C'), c('8','S')];
  const starter = c('A','D');
  const r = scoreHand(hand, starter, { isCrib: false });
  const runPts = r.items.filter(i => i.kind === 'run').reduce((a,i)=>a+i.points,0);
  const pairPts = r.items.filter(i => i.kind === 'pair').reduce((a,i)=>a+i.points,0);
  assert.equal(runPts + pairPts, 8);
});

test('item ordering: fifteens, then pairs, then runs, then flush, then nobs', () => {
  const hand = [c('2','H'), c('3','H'), c('4','H'), c('J','H')];
  const starter = c('5','H');
  const r = scoreHand(hand, starter, { isCrib: false });
  const order = ['fifteen', 'pair', 'run', 'flush', 'nobs'];
  let cursor = 0;
  for (const item of r.items) {
    while (cursor < order.length && item.kind !== order[cursor]) cursor++;
    assert.ok(cursor < order.length, `unexpected item kind order: ${item.kind}`);
  }
});

test('vernacular says: cumulative running tally', () => {
  const hand = [c('5','H'), c('T','D'), c('2','C'), c('3','S')];
  const starter = c('K','S');
  const r = scoreHand(hand, starter, { isCrib: false });
  assert.ok(r.items.length > 0);
  assert.ok(r.items.some(i => /^(fifteen-|.*makes|run|.*nobs)/i.test(i.say)));
});
