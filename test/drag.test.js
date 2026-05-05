import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exceedsThreshold, DRAG_THRESHOLD_PX } from '../public/drag.js';

test('drag threshold defaults to 6 px', () => {
  assert.equal(DRAG_THRESHOLD_PX, 6);
});

test('exceedsThreshold: zero movement is not exceeded', () => {
  assert.equal(exceedsThreshold(0, 0, 0, 0), false);
});

test('exceedsThreshold: under threshold returns false', () => {
  assert.equal(exceedsThreshold(0, 0, 3, 4), false); // 5 px
});

test('exceedsThreshold: at threshold returns false (strict greater)', () => {
  assert.equal(exceedsThreshold(0, 0, 3.6, 4.8), false); // 6 px exact
});

test('exceedsThreshold: over threshold returns true', () => {
  assert.equal(exceedsThreshold(0, 0, 5, 5), true); // ~7.07 px
});

test('exceedsThreshold: handles negative deltas', () => {
  assert.equal(exceedsThreshold(10, 10, 0, 0), true); // ~14.14 px
});
