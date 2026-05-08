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

import { sequencePoints, isBuracoLimpo, isBuracoSujo } from '../plugins/buraco/server/sequence.js';

test('sequencePoints sums per-card values: A=15, 2=20 (natural), 3-7=5, 8-K=10, joker=20', () => {
  // A natural 2♠ in an A-2-3 sequence = 20pts (it's natural). A 4-5-6 has all 5pt cards.
  assert.equal(sequencePoints([C('A','S'), C('2','S'), C('3','S')]), 15 + 20 + 5);
  assert.equal(sequencePoints([C('4','H'), C('5','H'), C('6','H')]), 5 + 5 + 5);
  assert.equal(sequencePoints([C('8','C'), C('9','C'), C('T','C'), C('J','C')]), 10 * 4);
  // Joker = 20 regardless of slot
  assert.equal(sequencePoints([C('5','H'), W(J(0,'red'), '6', 'H'), C('7','H')]), 5 + 20 + 5);
});

test('isBuracoLimpo: 7+ cards, no wild', () => {
  const seq = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  assert.equal(isBuracoLimpo(seq), true);
  assert.equal(isBuracoSujo(seq), false);
});

test('isBuracoSujo: 7+ cards, with wild', () => {
  const seq = [C('5','S'), W(J(0,'red'), '6', 'S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  assert.equal(isBuracoLimpo(seq), false);
  assert.equal(isBuracoSujo(seq), true);
});

test('6-card meld is neither buraco', () => {
  const seq = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S')];
  assert.equal(isBuracoLimpo(seq), false);
  assert.equal(isBuracoSujo(seq), false);
});
