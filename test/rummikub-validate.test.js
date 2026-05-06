import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEndState } from '../plugins/rummikub/server/validate.js';

const t = (id, color, value) => ({ id, kind: 'numbered', color, value });
const j = (id, representsColor, representsValue) => ({ id, kind: 'joker', representsColor, representsValue });

test('post-meld simple play: rack tile completes a new run', () => {
  // After initial meld is complete, a low-value play is allowed.
  const start = {
    rack: [t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7), t('o9a', 'orange', 9)],
    table: [],
    initialMeldComplete: true,
  };
  const end = {
    rack: [t('o9a', 'orange', 9)],
    table: [[t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, true, result.reason);
});

test('initial meld below 30 is invalid even with tiles remaining on rack', () => {
  // Initial-meld turn — must total ≥30 regardless of how many tiles stay on rack.
  const start = {
    rack: [t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7), t('o9a', 'orange', 9)],
    table: [],
    initialMeldComplete: false,
  };
  const end = {
    rack: [t('o9a', 'orange', 9)],
    table: [[t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7)]],  // 18 points
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, false);
  assert.match(result.reason, /30/);
});

test('multiset imbalance: tile invented from nowhere', () => {
  const start = {
    rack: [t('r5a', 'red', 5)],
    table: [],
    initialMeldComplete: true,
  };
  const end = {
    rack: [],
    table: [[t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, false);
  assert.match(result.reason, /balance/i);
});

test('rack expansion forbidden (player added tiles to own rack)', () => {
  const start = {
    rack: [t('r5a', 'red', 5)],
    table: [[t('b1', 'blue', 1), t('b2', 'blue', 2), t('b3', 'blue', 3)]],
    initialMeldComplete: true,
  };
  const end = {
    rack: [t('r5a', 'red', 5), t('b1', 'blue', 1)],
    table: [[t('b2', 'blue', 2), t('b3', 'blue', 3)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, false);
});

test('invalid set on end-state table', () => {
  const start = {
    rack: [t('r5a', 'red', 5), t('b6a', 'blue', 6), t('o7a', 'orange', 7)],
    table: [],
    initialMeldComplete: true,
  };
  const end = {
    rack: [],
    table: [[t('r5a', 'red', 5), t('b6a', 'blue', 6), t('o7a', 'orange', 7)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, false);
  assert.match(result.reason, /set/i);
});

test('initial meld must be ≥30 from rack tiles', () => {
  const start = {
    rack: [t('r1a', 'red', 1), t('r2a', 'red', 2), t('r3a', 'red', 3)],
    table: [],
    initialMeldComplete: false,
  };
  const end = {
    rack: [],
    table: [[t('r1a', 'red', 1), t('r2a', 'red', 2), t('r3a', 'red', 3)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, false);
  assert.match(result.reason, /30/);
});

test('initial meld success with unannotated wildcard inferred from run', () => {
  // Sonia's case: opens with wildcard between two reds, expects joker to count as red 10.
  const start = {
    rack: [t('r9a', 'red', 9), j('joker1'), t('r11a', 'red', 11)],
    table: [],
    initialMeldComplete: false,
  };
  const end = {
    rack: [],
    table: [[t('r9a', 'red', 9), j('joker1'), t('r11a', 'red', 11)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, true, result.reason);
});

test('initial meld success with unannotated wildcard inferred from group', () => {
  const start = {
    rack: [t('r10a', 'red', 10), t('b10', 'blue', 10), j('joker1')],
    table: [],
    initialMeldComplete: false,
  };
  const end = {
    rack: [],
    table: [[t('r10a', 'red', 10), t('b10', 'blue', 10), j('joker1')]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, true, result.reason);
});

test('initial meld success at exactly 30 points (red 9, 10, 11)', () => {
  const start = {
    rack: [t('r9a', 'red', 9), t('r10a', 'red', 10), t('r11a', 'red', 11), t('b1', 'blue', 1)],
    table: [],
    initialMeldComplete: false,
  };
  const end = {
    rack: [t('b1', 'blue', 1)],
    table: [[t('r9a', 'red', 9), t('r10a', 'red', 10), t('r11a', 'red', 11)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, true, result.reason);
});

test('initial meld cannot manipulate existing sets', () => {
  const start = {
    rack: [t('r12a', 'red', 12), t('b9', 'blue', 9), t('o9', 'orange', 9), t('blk9', 'black', 9)],
    table: [[t('r9a', 'red', 9), t('r10a', 'red', 10), t('r11a', 'red', 11)]],
    initialMeldComplete: false,
  };
  const end = {
    rack: [t('b9', 'blue', 9), t('o9', 'orange', 9), t('blk9', 'black', 9)],
    table: [[t('r9a', 'red', 9), t('r10a', 'red', 10), t('r11a', 'red', 11), t('r12a', 'red', 12)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, false);
  assert.match(result.reason, /initial meld/i);
});

test('post-meld manipulation allowed (extend existing run)', () => {
  const start = {
    rack: [t('r12a', 'red', 12)],
    table: [[t('r9a', 'red', 9), t('r10a', 'red', 10), t('r11a', 'red', 11)]],
    initialMeldComplete: true,
  };
  const end = {
    rack: [],
    table: [[t('r9a', 'red', 9), t('r10a', 'red', 10), t('r11a', 'red', 11), t('r12a', 'red', 12)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, true, result.reason);
});

test('joker harvest: harvested joker must appear in a new set', () => {
  const start = {
    rack: [t('r6a', 'red', 6), t('b8a', 'blue', 8), t('o8a', 'orange', 8)],
    table: [[t('r5a', 'red', 5), j('joker1', 'red', 6), t('r7a', 'red', 7)]],
    initialMeldComplete: true,
  };
  const endIllegal = {
    rack: [t('b8a', 'blue', 8), t('o8a', 'orange', 8), j('joker1', 'red', 6)],
    table: [[t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7)]],
  };
  const r1 = validateEndState(start, endIllegal);
  assert.equal(r1.valid, false);
  assert.match(r1.reason, /joker/i);

  const endLegal = {
    rack: [],
    table: [
      [t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7)],
      [t('b8a', 'blue', 8), t('o8a', 'orange', 8), j('joker1', 'black', 8)],
    ],
  };
  const r2 = validateEndState(start, endLegal);
  assert.equal(r2.valid, true, r2.reason);
});

test('must play at least one rack tile (not just rearrange)', () => {
  const start = {
    rack: [t('r5a', 'red', 5)],
    table: [
      [t('r1', 'red', 1), t('r2', 'red', 2), t('r3', 'red', 3)],
      [t('r4', 'red', 4), t('r6a', 'red', 6), t('b4', 'blue', 4)],
    ],
    initialMeldComplete: true,
  };
  const end = {
    rack: [t('r5a', 'red', 5)],
    table: [
      [t('r1', 'red', 1), t('r2', 'red', 2), t('r3', 'red', 3)],
      [t('r4', 'red', 4), t('r6a', 'red', 6), t('b4', 'blue', 4)],
    ],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, false);
  assert.match(result.reason, /at least one/i);
});
