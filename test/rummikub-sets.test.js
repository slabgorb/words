import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSet, classifySet, runValue, groupValue, setValue } from '../plugins/rummikub/server/sets.js';

const tile = (color, value) => ({ id: `${color[0]}${value}-${Math.random()}`, kind: 'numbered', color, value });
const joker = (representsColor, representsValue) => ({ id: `j-${Math.random()}`, kind: 'joker', representsColor, representsValue });

test('valid run: 5 6 7 same color', () => {
  const s = [tile('red', 5), tile('red', 6), tile('red', 7)];
  assert.equal(isValidSet(s), true);
  assert.equal(classifySet(s), 'run');
});

test('invalid run: not consecutive', () => {
  assert.equal(isValidSet([tile('red', 1), tile('red', 2), tile('red', 4)]), false);
});

test('invalid run: mixed colors', () => {
  assert.equal(isValidSet([tile('red', 1), tile('blue', 2), tile('red', 3)]), false);
});

test('invalid run: 1 cannot follow 13', () => {
  assert.equal(isValidSet([tile('red', 12), tile('red', 13), tile('red', 1)]), false);
});

test('valid group of 3', () => {
  const s = [tile('red', 7), tile('blue', 7), tile('orange', 7)];
  assert.equal(isValidSet(s), true);
  assert.equal(classifySet(s), 'group');
});

test('valid group of 4', () => {
  const s = [tile('red', 7), tile('blue', 7), tile('orange', 7), tile('black', 7)];
  assert.equal(isValidSet(s), true);
});

test('invalid group: repeated color', () => {
  assert.equal(isValidSet([tile('red', 7), tile('red', 7), tile('blue', 7)]), false);
});

test('invalid: too short', () => {
  assert.equal(isValidSet([tile('red', 5), tile('red', 6)]), false);
});

test('joker can stand in a run if annotated correctly', () => {
  const s = [tile('red', 5), joker('red', 6), tile('red', 7)];
  assert.equal(isValidSet(s), true);
});

test('joker without annotation: inferred from run context', () => {
  const s = [tile('red', 5), joker(), tile('red', 7)];
  assert.equal(isValidSet(s), true);
  assert.equal(setValue(s), 18);
});

test('joker without annotation: inferred from group context', () => {
  const s = [tile('red', 7), tile('blue', 7), joker()];
  assert.equal(isValidSet(s), true);
  assert.equal(setValue(s), 21);
});

test('joker without annotation: inferred at run boundary', () => {
  const s = [tile('red', 11), tile('red', 12), joker()];
  assert.equal(isValidSet(s), true);
  assert.equal(setValue(s), 36);
});

test('two jokers without annotation: inferred run', () => {
  const s = [tile('red', 5), joker(), joker(), tile('red', 8)];
  assert.equal(isValidSet(s), true);
  assert.equal(setValue(s), 26);
});

test('all-joker set rejected (no anchor for inference)', () => {
  assert.equal(isValidSet([joker(), joker(), joker()]), false);
});

test('joker without annotation rejected when context contradicts', () => {
  const s = [tile('red', 5), joker(), tile('blue', 7)];
  assert.equal(isValidSet(s), false);
});

test('joker inference: group preferred when run would exceed 13', () => {
  const s = [tile('red', 13), joker(), joker()];
  assert.equal(isValidSet(s), true);
  assert.equal(setValue(s), 39);
});

test('joker inference fails when both run and group are impossible', () => {
  // joker would have to be red 14 or red 15 (out of range), and not a group
  const s = [tile('red', 12), tile('red', 13), joker(), joker()];
  assert.equal(isValidSet(s), false);
});

test('joker stands for missing color in group of 3', () => {
  const s = [tile('red', 7), tile('blue', 7), joker('orange', 7)];
  assert.equal(isValidSet(s), true);
});

test('joker representation must be consistent with set kind', () => {
  const s = [tile('red', 5), joker('blue', 7), tile('red', 7)];
  assert.equal(isValidSet(s), false);
});

test('runValue sums consecutive numbers (joker counted at represented value)', () => {
  const s = [tile('red', 5), joker('red', 6), tile('red', 7)];
  assert.equal(runValue(s), 18);
});

test('groupValue is value × count', () => {
  const s = [tile('red', 7), tile('blue', 7), joker('orange', 7)];
  assert.equal(groupValue(s), 21);
});

test('setValue dispatches by classification', () => {
  assert.equal(setValue([tile('red', 1), tile('red', 2), tile('red', 3)]), 6);
  assert.equal(setValue([tile('red', 4), tile('blue', 4), tile('orange', 4)]), 12);
});
