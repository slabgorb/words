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

import { resolveTarget } from '../public/drag.js';

function makeElement({ id, dropTarget = null, parent = null }) {
  const el = {
    id,
    dataset: dropTarget ? { dropTarget } : {},
    parent,
  };
  // Mimic .closest by walking the parent chain.
  el.closest = (sel) => {
    if (sel !== '[data-drop-target]') throw new Error(`unexpected selector ${sel}`);
    let cur = el;
    while (cur) {
      if (cur.dataset && cur.dataset.dropTarget) return cur;
      cur = cur.parent;
    }
    return null;
  };
  return el;
}

test('resolveTarget returns null when elementFromPoint returns null', () => {
  const result = resolveTarget(10, 20, () => null);
  assert.equal(result, null);
});

test('resolveTarget walks up to find a drop-target ancestor', () => {
  const cell = makeElement({ id: 'cell', dropTarget: 'cell' });
  const child = makeElement({ id: 'child', parent: cell });
  const result = resolveTarget(0, 0, () => child);
  assert.equal(result.id, 'cell');
});

test('resolveTarget returns the element itself if it has data-drop-target', () => {
  const rack = makeElement({ id: 'rack', dropTarget: 'rack' });
  const result = resolveTarget(0, 0, () => rack);
  assert.equal(result.id, 'rack');
});

test('resolveTarget returns null if no ancestor is a target', () => {
  const child = makeElement({ id: 'child' });
  const result = resolveTarget(0, 0, () => child);
  assert.equal(result, null);
});
