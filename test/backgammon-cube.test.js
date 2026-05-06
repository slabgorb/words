import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOffer, applyOffer, applyAccept, applyDecline } from '../plugins/backgammon/server/cube.js';

const FRESH_CUBE = { value: 1, owner: null, pendingOffer: null };
const FRESH_MATCH = { target: 3, scoreA: 0, scoreB: 0, gameNumber: 1, crawford: false, crawfordPlayed: false };

test('canOffer: centered cube — either player may offer', () => {
  assert.equal(canOffer({ cube: FRESH_CUBE, match: FRESH_MATCH }, 'a'), true);
  assert.equal(canOffer({ cube: FRESH_CUBE, match: FRESH_MATCH }, 'b'), true);
});

test('canOffer: owned cube — only owner may offer', () => {
  const cube = { value: 2, owner: 'a', pendingOffer: null };
  assert.equal(canOffer({ cube, match: FRESH_MATCH }, 'a'), true);
  assert.equal(canOffer({ cube, match: FRESH_MATCH }, 'b'), false);
});

test('canOffer: cap at 64', () => {
  const cube = { value: 64, owner: 'a', pendingOffer: null };
  assert.equal(canOffer({ cube, match: FRESH_MATCH }, 'a'), false);
});

test('canOffer: Crawford leg disables doubling', () => {
  const match = { ...FRESH_MATCH, crawford: true };
  assert.equal(canOffer({ cube: FRESH_CUBE, match }, 'a'), false);
});

test('canOffer: target=1 always allows doubling (Crawford never triggers)', () => {
  const match = { ...FRESH_MATCH, target: 1 };
  assert.equal(canOffer({ cube: FRESH_CUBE, match }, 'a'), true);
});

test('canOffer: pending offer prevents new offer', () => {
  const cube = { value: 2, owner: 'a', pendingOffer: { from: 'a' } };
  assert.equal(canOffer({ cube, match: FRESH_MATCH }, 'a'), false);
});

test('applyOffer sets pendingOffer.from', () => {
  const next = applyOffer(FRESH_CUBE, 'a');
  assert.deepEqual(next, { value: 1, owner: null, pendingOffer: { from: 'a' } });
});

test('applyAccept doubles value, transfers ownership to acceptor, clears offer', () => {
  const cube = { value: 2, owner: 'a', pendingOffer: { from: 'a' } };
  const next = applyAccept(cube, 'b');
  assert.deepEqual(next, { value: 4, owner: 'b', pendingOffer: null });
});

test('applyAccept from centered cube: ownership goes to acceptor', () => {
  const cube = { value: 1, owner: null, pendingOffer: { from: 'a' } };
  const next = applyAccept(cube, 'b');
  assert.deepEqual(next, { value: 2, owner: 'b', pendingOffer: null });
});

test('applyDecline returns awardedToOfferer = pre-double cube value', () => {
  const cube = { value: 2, owner: 'a', pendingOffer: { from: 'a' } };
  const result = applyDecline(cube);
  assert.deepEqual(result, { awardedToOfferer: 2, offerer: 'a' });
});

test('applyDecline from centered cube: awarded = 1', () => {
  const cube = { value: 1, owner: null, pendingOffer: { from: 'a' } };
  const result = applyDecline(cube);
  assert.deepEqual(result, { awardedToOfferer: 1, offerer: 'a' });
});
