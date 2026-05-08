import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSequence } from '../plugins/buraco/server/sequence.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });
const J = (index, color) => ({ id: `jk-${index}`, kind: 'joker', index, color });
const W = (card, representsRank, representsSuit) => ({ ...card, representsRank, representsSuit });

test('three consecutive same-suit cards is a valid sequence', () => {
  assert.equal(isValidSequence([C('5','H'), C('6','H'), C('7','H')]), true);
});

test('two cards is too short', () => {
  assert.equal(isValidSequence([C('5','H'), C('6','H')]), false);
});

test('mixed-suit fails', () => {
  assert.equal(isValidSequence([C('5','H'), C('6','S'), C('7','H')]), false);
});

test('non-consecutive ranks fails', () => {
  assert.equal(isValidSequence([C('5','H'), C('7','H'), C('8','H')]), false);
});

test('A-low (A-2-3) is valid', () => {
  assert.equal(isValidSequence([C('A','S'), C('2','S'), C('3','S')]), true);
});

test('A-high (Q-K-A) is valid', () => {
  assert.equal(isValidSequence([C('Q','C'), C('K','C'), C('A','C')]), true);
});

test('K-A-2 wraparound is invalid', () => {
  assert.equal(isValidSequence([C('K','D'), C('A','D'), C('2','D')]), false);
});

test('one wild joker filling middle slot is valid', () => {
  assert.equal(isValidSequence([C('5','H'), W(J(0,'red'), '6', 'H'), C('7','H')]), true);
});

test('two wilds is invalid', () => {
  assert.equal(isValidSequence([C('5','H'), W(J(0,'red'), '6', 'H'), W(J(1,'black'), '7', 'H')]), false);
});

test('off-suit 2 used as wild is valid', () => {
  // 2♣ standing in for 6♥ in a hearts run
  assert.equal(isValidSequence([C('5','H'), W(C('2','C'), '6', 'H'), C('7','H')]), true);
});

test('the natural 2 of suit is NOT counted as a wild within that suit', () => {
  // A-2-3 of spades — the 2♠ is the natural, not a wild
  // Plus a joker filling for 4♠ — this is one wild, valid
  assert.equal(isValidSequence([C('A','S'), C('2','S'), C('3','S'), W(J(0,'red'), '4', 'S')]), true);
});

test('wild claiming wrong rank for its slot is invalid', () => {
  // joker representing 9 placed where 6 should go
  assert.equal(isValidSequence([C('5','H'), W(J(0,'red'), '9', 'H'), C('7','H')]), false);
});

test('wild claiming wrong suit for the run is invalid', () => {
  // joker representing 6♣ placed in a hearts run
  assert.equal(isValidSequence([C('5','H'), W(J(0,'red'), '6', 'C'), C('7','H')]), false);
});
