# Rummikub Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Rummikub (Sabra rules) as the second plugin in the gamebox host. Two players, structured-rows table UI, full-state turn commit with multiset/legality/joker-harvest validation, no turn timer.

**Architecture:** A new plugin folder `plugins/rummikub/` with the contract from Plan A: `initialState`, `applyAction`, `publicView`, plus client assets served at `/play/rummikub/:id/`. The rules engine validates a proposed turn-end state by checking (a) multiset balance, (b) rack-subset, (c) every set valid, (d) initial-meld constraint when applicable, (e) joker-harvest constraint, (f) at least one rack tile played. Pure functions throughout — no I/O, deterministic given a seeded RNG.

**Tech Stack:** Node 20+, Express 4 (host), better-sqlite3 (host), vanilla JS, `node --test`. ESM throughout.

**Spec:** `docs/superpowers/specs/2026-05-05-gamebox-plugin-host-and-rummikub-design.md`

**Prerequisites:** Plan A (`2026-05-05-gamebox-plugin-host-and-words-refactor-plan.md`) must be merged. This plan assumes the gamebox host with plugin loader, generic action route, JSON state column, and `/play/<type>/<id>/` static serving are all in place.

---

## File Structure

**Created:**
- `plugins/rummikub/plugin.js` — manifest + contract exports
- `plugins/rummikub/server/tiles.js` — tile model (106 tiles, helpers)
- `plugins/rummikub/server/sets.js` — set validators (run/group)
- `plugins/rummikub/server/multiset.js` — multiset balance helpers
- `plugins/rummikub/server/state.js` — `initialState` builder
- `plugins/rummikub/server/validate.js` — end-state validation (composes all checks)
- `plugins/rummikub/server/actions.js` — `applyAction` (commit-turn, draw-tile, resign)
- `plugins/rummikub/server/view.js` — `publicView` (hide opponent rack)
- `plugins/rummikub/server/scoring.js` — end-game scoring
- `plugins/rummikub/client/index.html`
- `plugins/rummikub/client/app.js` — bootstrap, state fetch, SSE
- `plugins/rummikub/client/tile.js` — tile rendering helpers
- `plugins/rummikub/client/rack.js` — rack rendering + sort
- `plugins/rummikub/client/table.js` — table rendering (rows of sets)
- `plugins/rummikub/client/drag.js` — drag mechanics (extends pattern from Words)
- `plugins/rummikub/client/turn.js` — tentative-state manager (Reset, mirror validation)
- `plugins/rummikub/client/validate.js` — client-side validation mirror
- `plugins/rummikub/client/style.css`
- `test/rummikub-tiles.test.js`
- `test/rummikub-sets.test.js`
- `test/rummikub-multiset.test.js`
- `test/rummikub-state.test.js`
- `test/rummikub-validate.test.js`
- `test/rummikub-actions.test.js`
- `test/rummikub-scoring.test.js`
- `test/rummikub-plugin.test.js`
- `test/e2e-rummikub.test.js`

**Modified:**
- `src/plugins/index.js` — register rummikub
- `README.md` — mention Rummikub as a shipped plugin (small touch-up)

---

## Task 1: Plugin skeleton

**Files:**
- Create: `plugins/rummikub/plugin.js` (stub)
- Create: directory tree for server + client

A minimal manifest + empty function stubs that pass the validator. No game logic yet. We register it in `src/plugins/index.js` only at the very end (Task 18) so that intermediate broken states don't break boot.

- [ ] **Step 1: Create directory tree**

```bash
mkdir -p plugins/rummikub/server plugins/rummikub/client
```

- [ ] **Step 2: Stub manifest**

Create `plugins/rummikub/plugin.js`:

```js
export default {
  id: 'rummikub',
  displayName: 'Rummikub',
  players: 2,
  clientDir: 'plugins/rummikub/client',

  initialState: () => { throw new Error('not implemented'); },
  applyAction: () => { throw new Error('not implemented'); },
  publicView: () => { throw new Error('not implemented'); },
};
```

- [ ] **Step 3: Verify validator accepts the stub**

```bash
node --eval "import('./plugins/rummikub/plugin.js').then(m => import('./src/server/plugins.js').then(({validatePlugin}) => { validatePlugin(m.default); console.log('ok'); }));"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add plugins/rummikub/plugin.js
git commit -m "feat(rummikub): plugin skeleton with stub manifest"
```

---

## Task 2: Tile model

**Files:**
- Create: `plugins/rummikub/server/tiles.js`
- Test: `test/rummikub-tiles.test.js`

The tile bag has 106 tiles: 104 numbered (values 1–13, four colors {red, blue, orange, black}, two of each, total 13×4×2 = 104) + 2 jokers. Every tile has a stable string `id` so multiset operations can compare by reference. The two duplicates of (color=red, value=5) are e.g. `r5a` and `r5b`. Jokers are `joker1` and `joker2`.

- [ ] **Step 1: Write tile-model tests**

Create `test/rummikub-tiles.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBag, COLORS, NUMBERS, isJoker, tileValue } from '../plugins/rummikub/server/tiles.js';

test('COLORS has four entries', () => {
  assert.deepEqual(COLORS, ['red', 'blue', 'orange', 'black']);
});

test('NUMBERS is 1..13', () => {
  assert.deepEqual(NUMBERS, [1,2,3,4,5,6,7,8,9,10,11,12,13]);
});

test('buildBag returns 106 tiles', () => {
  const bag = buildBag();
  assert.equal(bag.length, 106);
});

test('buildBag has 104 numbered + 2 jokers', () => {
  const bag = buildBag();
  const jokers = bag.filter(t => t.kind === 'joker');
  const numbered = bag.filter(t => t.kind === 'numbered');
  assert.equal(jokers.length, 2);
  assert.equal(numbered.length, 104);
});

test('every numbered combo (color, value) appears exactly twice', () => {
  const bag = buildBag();
  for (const color of COLORS) {
    for (const value of NUMBERS) {
      const matches = bag.filter(t => t.kind === 'numbered' && t.color === color && t.value === value);
      assert.equal(matches.length, 2, `${color} ${value} should appear twice`);
    }
  }
});

test('tile ids are unique strings', () => {
  const bag = buildBag();
  const ids = bag.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.equal(typeof id, 'string');
});

test('isJoker correctly identifies jokers', () => {
  const bag = buildBag();
  const j = bag.find(t => t.kind === 'joker');
  const n = bag.find(t => t.kind === 'numbered');
  assert.equal(isJoker(j), true);
  assert.equal(isJoker(n), false);
});

test('tileValue returns face value for numbered tiles', () => {
  assert.equal(tileValue({ kind: 'numbered', value: 7 }), 7);
});

test('tileValue returns 30 for joker (penalty value)', () => {
  assert.equal(tileValue({ kind: 'joker' }), 30);
});

test('tileValue returns the joker representation value when annotated and asked for played value', () => {
  // For a joker that has been played and represents a 5, the *played* value is 5.
  // tileValue() with no flag returns the unplayed/penalty value (30).
  // tileValue(t, { asPlayed: true }) returns the represented value.
  const joker = { kind: 'joker', representsValue: 5, representsColor: 'red' };
  assert.equal(tileValue(joker), 30);
  assert.equal(tileValue(joker, { asPlayed: true }), 5);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/rummikub-tiles.test.js`
Expected: FAIL (module does not exist)

- [ ] **Step 3: Implement `plugins/rummikub/server/tiles.js`**

```js
export const COLORS = ['red', 'blue', 'orange', 'black'];
export const NUMBERS = Array.from({ length: 13 }, (_, i) => i + 1);

export function buildBag() {
  const tiles = [];
  for (const color of COLORS) {
    for (const value of NUMBERS) {
      tiles.push({ id: `${color[0]}${value}a`, kind: 'numbered', color, value });
      tiles.push({ id: `${color[0]}${value}b`, kind: 'numbered', color, value });
    }
  }
  tiles.push({ id: 'joker1', kind: 'joker' });
  tiles.push({ id: 'joker2', kind: 'joker' });
  return tiles;
}

export function isJoker(tile) {
  return tile?.kind === 'joker';
}

export function tileValue(tile, opts = {}) {
  if (tile.kind === 'numbered') return tile.value;
  if (tile.kind === 'joker') {
    if (opts.asPlayed && typeof tile.representsValue === 'number') return tile.representsValue;
    return 30;
  }
  throw new Error(`unknown tile kind: ${tile.kind}`);
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/rummikub-tiles.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/server/tiles.js test/rummikub-tiles.test.js
git commit -m "feat(rummikub): tile model — 106 tiles + helpers"
```

---

## Task 3: Set validators

**Files:**
- Create: `plugins/rummikub/server/sets.js`
- Test: `test/rummikub-sets.test.js`

A "set" is an array of tiles. Valid types: `run` (≥3 same color, consecutive numbers, no wrap) or `group` (3 or 4 same value, distinct colors). Jokers may stand in for any tile; `representsColor`/`representsValue` annotations on a joker tell us what it represents.

- [ ] **Step 1: Write set-validator tests**

Create `test/rummikub-sets.test.js`:

```js
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

test('joker without annotation rejected (must declare representation)', () => {
  // A joker with no representsValue/representsColor on the table is
  // ambiguous and rejected. (Bare jokers are only legal on a rack.)
  const s = [tile('red', 5), joker(), tile('red', 7)];
  assert.equal(isValidSet(s), false);
});

test('joker stands for missing color in group of 3', () => {
  const s = [tile('red', 7), tile('blue', 7), joker('orange', 7)];
  assert.equal(isValidSet(s), true);
});

test('joker representation must be consistent with set kind', () => {
  // Joker claims to be "blue 7" but is in a position where blue 6 is needed
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
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/rummikub-sets.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `plugins/rummikub/server/sets.js`**

```js
import { COLORS, isJoker } from './tiles.js';

export function classifySet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return null;
  // Try run first, then group
  if (looksLikeRun(tiles)) return 'run';
  if (looksLikeGroup(tiles)) return 'group';
  return null;
}

export function isValidSet(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return false;
  // Every joker must be annotated with both representsColor and representsValue
  for (const t of tiles) {
    if (isJoker(t)) {
      if (typeof t.representsValue !== 'number') return false;
      if (typeof t.representsColor !== 'string') return false;
    }
  }
  const kind = classifySet(tiles);
  if (!kind) return false;
  if (kind === 'run') return validateRun(tiles);
  if (kind === 'group') return validateGroup(tiles);
  return false;
}

function tileColor(t) { return isJoker(t) ? t.representsColor : t.color; }
function tileNumber(t) { return isJoker(t) ? t.representsValue : t.value; }

function looksLikeRun(tiles) {
  // Heuristic: all same color (after joker annotation)
  const colors = new Set(tiles.map(tileColor));
  return colors.size === 1;
}

function looksLikeGroup(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return false;
  const values = new Set(tiles.map(tileNumber));
  return values.size === 1;
}

function validateRun(tiles) {
  const color = tileColor(tiles[0]);
  for (let i = 0; i < tiles.length; i++) {
    if (tileColor(tiles[i]) !== color) return false;
    if (tileNumber(tiles[i]) !== tileNumber(tiles[0]) + i) return false;
    if (tileNumber(tiles[i]) < 1 || tileNumber(tiles[i]) > 13) return false;
  }
  return true;
}

function validateGroup(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return false;
  const value = tileNumber(tiles[0]);
  const colors = new Set();
  for (const t of tiles) {
    if (tileNumber(t) !== value) return false;
    const c = tileColor(t);
    if (!COLORS.includes(c)) return false;
    if (colors.has(c)) return false;  // distinct colors
    colors.add(c);
  }
  return true;
}

export function runValue(tiles) {
  return tiles.reduce((sum, t) => sum + tileNumber(t), 0);
}

export function groupValue(tiles) {
  const value = tileNumber(tiles[0]);
  return value * tiles.length;
}

export function setValue(tiles) {
  const kind = classifySet(tiles);
  if (kind === 'run') return runValue(tiles);
  if (kind === 'group') return groupValue(tiles);
  return 0;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/rummikub-sets.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/server/sets.js test/rummikub-sets.test.js
git commit -m "feat(rummikub): set validators (run, group) with joker support"
```

---

## Task 4: Multiset balance helpers

**Files:**
- Create: `plugins/rummikub/server/multiset.js`
- Test: `test/rummikub-multiset.test.js`

A multiset operation that compares "tiles in (rack ⊎ table)" — used to verify a proposed turn-end state has neither invented nor lost tiles. We compare by tile id (which is unique).

- [ ] **Step 1: Write tests**

Create `test/rummikub-multiset.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileIdsOf, multisetEqual, multisetDiff } from '../plugins/rummikub/server/multiset.js';

const t = (id) => ({ id });

test('tileIdsOf flattens rack + table sets into a single array', () => {
  const ids = tileIdsOf({ rack: [t('a'), t('b')], table: [[t('c'), t('d')], [t('e')]] });
  assert.deepEqual(ids.sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('multisetEqual returns true for same ids in different order', () => {
  assert.equal(multisetEqual(['a', 'b', 'c'], ['c', 'a', 'b']), true);
});

test('multisetEqual returns false for different ids', () => {
  assert.equal(multisetEqual(['a', 'b'], ['a', 'c']), false);
});

test('multisetEqual returns false for different sizes', () => {
  assert.equal(multisetEqual(['a', 'b'], ['a', 'b', 'c']), false);
});

test('multisetDiff returns added/removed', () => {
  const d = multisetDiff(['a', 'b', 'c'], ['b', 'c', 'd']);
  assert.deepEqual(d.added.sort(), ['d']);
  assert.deepEqual(d.removed.sort(), ['a']);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/rummikub-multiset.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `plugins/rummikub/server/multiset.js`**

```js
export function tileIdsOf({ rack = [], table = [] }) {
  const ids = [];
  for (const tile of rack) ids.push(tile.id);
  for (const set of table) for (const tile of set) ids.push(tile.id);
  return ids;
}

function counts(ids) {
  const m = new Map();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const ca = counts(a), cb = counts(b);
  if (ca.size !== cb.size) return false;
  for (const [k, v] of ca) if (cb.get(k) !== v) return false;
  return true;
}

export function multisetDiff(before, after) {
  const cb = counts(before), ca = counts(after);
  const added = [], removed = [];
  for (const [k, v] of ca) {
    const b = cb.get(k) ?? 0;
    if (v > b) for (let i = 0; i < v - b; i++) added.push(k);
  }
  for (const [k, v] of cb) {
    const a = ca.get(k) ?? 0;
    if (v > a) for (let i = 0; i < v - a; i++) removed.push(k);
  }
  return { added, removed };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/rummikub-multiset.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/server/multiset.js test/rummikub-multiset.test.js
git commit -m "feat(rummikub): multiset balance helpers"
```

---

## Task 5: Initial state (deal)

**Files:**
- Create: `plugins/rummikub/server/state.js`
- Test: `test/rummikub-state.test.js`

`initialState({ participants, rng })`: shuffle 106 tiles, deal 14 to each player, leave 78 in pool, randomly pick `activeUserId`.

- [ ] **Step 1: Write tests**

Create `test/rummikub-state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/rummikub/server/state.js';

const participants = [
  { userId: 1, side: 'a' },
  { userId: 2, side: 'b' },
];
let counter = 0;
const det = () => { counter += 0.137; return counter % 1; };

test('initialState deals 14 to each rack and 78 to pool (106 - 28)', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.equal(s.racks.a.length, 14);
  assert.equal(s.racks.b.length, 14);
  assert.equal(s.pool.length, 78);
});

test('initialState: total tiles is 106', () => {
  const s = buildInitialState({ participants, rng: det });
  const total = s.racks.a.length + s.racks.b.length + s.pool.length + s.table.flat().length;
  assert.equal(total, 106);
});

test('initialState: table starts empty', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.deepEqual(s.table, []);
});

test('initialState: activeUserId is one of the participants', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.ok(s.activeUserId === 1 || s.activeUserId === 2);
});

test('initialState: sides map participants', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.equal(s.sides.a, 1);
  assert.equal(s.sides.b, 2);
});

test('initialState: tile ids are unique across racks + pool + table', () => {
  const s = buildInitialState({ participants, rng: det });
  const allIds = [
    ...s.racks.a.map(t => t.id),
    ...s.racks.b.map(t => t.id),
    ...s.pool.map(t => t.id),
  ];
  assert.equal(new Set(allIds).size, 106);
});

test('initialState: initial-meld flags both false; passes/scores zero', () => {
  const s = buildInitialState({ participants, rng: det });
  assert.deepEqual(s.initialMeldComplete, { a: false, b: false });
  assert.deepEqual(s.scores, { a: 0, b: 0 });
});

test('initialState: deterministic given same RNG', () => {
  let c1 = 0; const r1 = () => { c1 += 0.137; return c1 % 1; };
  let c2 = 0; const r2 = () => { c2 += 0.137; return c2 % 1; };
  const s1 = buildInitialState({ participants, rng: r1 });
  const s2 = buildInitialState({ participants, rng: r2 });
  assert.deepEqual(s1.racks.a.map(t => t.id), s2.racks.a.map(t => t.id));
  assert.deepEqual(s1.pool.map(t => t.id), s2.pool.map(t => t.id));
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/rummikub-state.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `plugins/rummikub/server/state.js`**

```js
import { buildBag } from './tiles.js';

export function buildInitialState({ participants, rng }) {
  const a = participants.find(p => p.side === 'a').userId;
  const b = participants.find(p => p.side === 'b').userId;

  const all = shuffle(buildBag(), rng);
  const rackA = all.slice(0, 14);
  const rackB = all.slice(14, 28);
  const pool = all.slice(28);

  const startSide = rng() < 0.5 ? 'a' : 'b';

  return {
    pool,
    racks: { a: rackA, b: rackB },
    table: [],
    initialMeldComplete: { a: false, b: false },
    sides: { a, b },
    activeUserId: startSide === 'a' ? a : b,
    scores: { a: 0, b: 0 },
    consecutiveDraws: 0,
    endedReason: null,
    winnerSide: null,
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/rummikub-state.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/server/state.js test/rummikub-state.test.js
git commit -m "feat(rummikub): initialState — shuffle + deal 14 each + 78 pool"
```

---

## Task 6: End-state validation

**Files:**
- Create: `plugins/rummikub/server/validate.js`
- Test: `test/rummikub-validate.test.js`

The big one. Given a *proposed* (rack, table) end-of-turn state and the actor's start-of-turn state, return `{ valid, reason }`. Composes:

1. Multiset balance: `(rack_end ⊎ table_end) == (rack_start ⊎ table_start)`
2. Rack subset: `rack_end ⊆ rack_start` (player only *removed* tiles from their rack)
3. Set legality: every set in `table_end` is valid (length ≥3, run or group)
4. Initial meld (if `!initialMeldComplete[actor]`):
   - All sets in `table_end` either appear unchanged from `table_start` or are entirely composed of *new* tiles played from rack
   - Sum of set values from new sets ≥ 30
5. Joker harvest: any joker that was in a `table_start` set but is no longer in *that same set* in `table_end` must appear in some set of `table_end` that is "new" (not present in `table_start`)
6. At least one rack tile played: `rack_end.length < rack_start.length`

Set identity for "new" vs "preserved" uses *tile id multisets*: a set in `table_end` is "preserved" iff there exists a set in `table_start` with the same tile ids; otherwise "new". (This is a conservative interpretation — manipulations like shifting/splitting count as "destroying old sets and creating new ones" — but it preserves the joker-harvest invariant correctly because any set whose joker has been swapped out has different tile ids.)

- [ ] **Step 1: Write a chunky validator test**

Create `test/rummikub-validate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEndState } from '../plugins/rummikub/server/validate.js';

const t = (id, color, value) => ({ id, kind: 'numbered', color, value });
const j = (id, representsColor, representsValue) => ({ id, kind: 'joker', representsColor, representsValue });

test('valid simple play: rack tile completes a new run', () => {
  const start = {
    rack: [t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7), t('o9a', 'orange', 9)],
    table: [],
    initialMeldComplete: false,
  };
  const end = {
    rack: [t('o9a', 'orange', 9)],
    table: [[t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7)]],
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, true, result.reason);
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
    // Player swiped tile from table back to rack
    rack: [t('r5a', 'red', 5), t('b1', 'blue', 1)],
    table: [[t('b2', 'blue', 2), t('b3', 'blue', 3)]],  // also broken (len 2)
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
    table: [[t('r5a', 'red', 5), t('b6a', 'blue', 6), t('o7a', 'orange', 7)]],  // mixed colors run, mixed values group: invalid
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
    table: [[t('r1a', 'red', 1), t('r2a', 'red', 2), t('r3a', 'red', 3)]],  // sum = 6
  };
  const result = validateEndState(start, end);
  assert.equal(result.valid, false);
  assert.match(result.reason, /30/);
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
  // Player tries to extend the existing run: r9 r10 r11 → r9 r10 r11 r12
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
  // Start: an existing run with a joker representing red 6
  const start = {
    rack: [t('r6a', 'red', 6), t('b8a', 'blue', 8), t('o8a', 'orange', 8)],
    table: [[t('r5a', 'red', 5), j('joker1', 'red', 6), t('r7a', 'red', 7)]],
    initialMeldComplete: true,
  };
  // Player puts the real red 6 in place of the joker, but holds the joker
  // (illegal — joker must be played in a new set this turn).
  const endIllegal = {
    rack: [t('b8a', 'blue', 8), t('o8a', 'orange', 8), j('joker1', 'red', 6)],  // joker back on rack
    table: [[t('r5a', 'red', 5), t('r6a', 'red', 6), t('r7a', 'red', 7)]],
  };
  const r1 = validateEndState(start, endIllegal);
  assert.equal(r1.valid, false);
  assert.match(r1.reason, /joker/i);

  // Legal: place joker in a new group of 8s
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
      [t('r4', 'red', 4), t('r6a', 'red', 6), t('b4', 'blue', 4)],  // dummy invalid; just to have 2 sets
    ],
    initialMeldComplete: true,
  };
  // Pretend the player only rearranges (no tile from rack played).
  // Build a valid alternate arrangement that uses the same tiles.
  // (For test purposes we keep the table identical — minimum required is just
  // that rack didn't shrink.)
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
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/rummikub-validate.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `plugins/rummikub/server/validate.js`**

```js
import { tileIdsOf, multisetEqual } from './multiset.js';
import { isValidSet, setValue } from './sets.js';
import { isJoker } from './tiles.js';

export function validateEndState(start, end) {
  // 1. Multiset balance: rack_start ⊎ table_start == rack_end ⊎ table_end
  const startIds = tileIdsOf({ rack: start.rack, table: start.table });
  const endIds = tileIdsOf({ rack: end.rack, table: end.table });
  if (!multisetEqual(startIds, endIds)) {
    return { valid: false, reason: 'multiset balance violated: tiles invented or vanished' };
  }

  // 2. Rack subset: every tile id in rack_end must have been in rack_start
  const startRackIds = new Set(start.rack.map(t => t.id));
  for (const t of end.rack) {
    if (!startRackIds.has(t.id)) {
      return { valid: false, reason: `tile ${t.id} appeared in rack but was not there at turn start` };
    }
  }

  // 3. At least one rack tile played
  if (end.rack.length >= start.rack.length) {
    return { valid: false, reason: 'must play at least one tile from rack (or use draw-tile action)' };
  }

  // 4. Every end-state set is a valid set of length ≥3
  for (const set of end.table) {
    if (!isValidSet(set)) {
      return { valid: false, reason: `invalid set on table: ${set.map(t => t.id).join(',')}` };
    }
  }

  // 5. Initial meld constraint (if not yet met for this actor)
  if (!start.initialMeldComplete) {
    // Identify "preserved" sets (same tile-id multiset as a start-table set)
    const preserved = preservedSets(start.table, end.table);
    const newSets = end.table.filter(s => !preserved.has(s));

    // No start set may be modified (i.e., every start set must appear unchanged in end.table)
    const startKeys = start.table.map(setKey);
    const endKeys = end.table.map(setKey);
    for (const key of startKeys) {
      if (!endKeys.includes(key)) {
        return { valid: false, reason: 'initial meld: cannot modify existing sets' };
      }
    }
    // All tiles in new sets must be from the player's rack at start
    for (const set of newSets) {
      for (const tile of set) {
        if (!startRackIds.has(tile.id)) {
          return { valid: false, reason: 'initial meld: new sets must be composed entirely of your rack tiles' };
        }
      }
    }
    const meldPoints = newSets.reduce((sum, s) => sum + setValue(s), 0);
    if (meldPoints < 30) {
      return { valid: false, reason: `initial meld must be at least 30 points (got ${meldPoints})` };
    }
  }

  // 6. Joker harvest: any joker that was in a start-table set but is no
  // longer in a *preserved* set must be in a *new* set (not on rack, not lost).
  const startJokersByLocation = collectJokersFromTable(start.table);  // joker.id -> set-key
  const endTableJokerSetKeys = new Map();  // joker.id -> end set key (or null if on rack)
  for (const t of end.rack) {
    if (isJoker(t)) endTableJokerSetKeys.set(t.id, null);
  }
  for (const set of end.table) {
    for (const t of set) {
      if (isJoker(t)) endTableJokerSetKeys.set(t.id, setKey(set));
    }
  }
  const preservedKeys = new Set(end.table.filter(s => start.table.some(s2 => setKey(s2) === setKey(s))).map(setKey));
  for (const [jokerId, startKey] of startJokersByLocation) {
    const endKey = endTableJokerSetKeys.get(jokerId);
    if (endKey === null || endKey === undefined) {
      return { valid: false, reason: `joker ${jokerId} cannot be returned to rack` };
    }
    if (endKey === startKey && preservedKeys.has(endKey)) {
      // Joker stayed in its original (unchanged) set — fine
      continue;
    }
    // Joker has moved or its set was modified — it must now be in a NEW set
    if (preservedKeys.has(endKey)) {
      return { valid: false, reason: `joker ${jokerId} was harvested but is still in a preserved set — must be in a new set` };
    }
    // endKey corresponds to a non-preserved (new) set: that's the requirement, accept.
  }

  return { valid: true };
}

function setKey(set) {
  return set.map(t => t.id).slice().sort().join(',');
}

function preservedSets(startTable, endTable) {
  const startKeys = new Set(startTable.map(setKey));
  return new Set(endTable.filter(s => startKeys.has(setKey(s))));
}

function collectJokersFromTable(table) {
  const out = new Map();
  for (const set of table) {
    for (const t of set) {
      if (isJoker(t)) out.set(t.id, setKey(set));
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/rummikub-validate.test.js`
Expected: PASS — all validator tests green

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/server/validate.js test/rummikub-validate.test.js
git commit -m "feat(rummikub): end-state validator (multiset/sets/meld/joker)"
```

---

## Task 7: Action handlers — commit-turn, draw-tile, resign

**Files:**
- Create: `plugins/rummikub/server/actions.js`
- Create: `plugins/rummikub/server/scoring.js`
- Test: `test/rummikub-actions.test.js`
- Test: `test/rummikub-scoring.test.js`

`commit-turn` payload: the proposed end-state `{ rack, table }`. Apply validator, then merge into game state. `draw-tile` pulls from pool. `resign` ends the game.

End-game detection: when a player's rack is empty after `commit-turn`, they win. When pool is empty AND no one made a play (both drew or both passed), end with fewest-tiles winner.

- [ ] **Step 1: Scoring tests**

Create `test/rummikub-scoring.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFinalScores } from '../plugins/rummikub/server/scoring.js';

const num = (v) => ({ id: `n${v}-${Math.random()}`, kind: 'numbered', value: v, color: 'red' });
const joker = () => ({ id: `j-${Math.random()}`, kind: 'joker' });

test('winner gets +sum of loser remaining; loser goes negative', () => {
  // a wins; b has [3, 5] = 8 points
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
  // a has 3 tiles (sum 6); b has 5 tiles (sum 15)
  const result = computeFinalScores({
    winnerSide: null,  // tie / pool-exhausted
    racks: {
      a: [num(1), num(2), num(3)],
      b: [num(1), num(2), num(3), num(4), num(5)],
    },
  });
  // Per spec/Wikipedia: lowest-tile-count wins; scoring still standard
  assert.equal(result.winnerSide, 'a');
  assert.deepEqual(result.scoreDeltas, { a: +15, b: -15 });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/rummikub-scoring.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `plugins/rummikub/server/scoring.js`**

```js
import { tileValue } from './tiles.js';

export function computeFinalScores({ winnerSide, racks }) {
  let resolvedWinner = winnerSide;
  if (resolvedWinner === null) {
    // Pool-exhausted with no Rummikub: fewest tiles wins
    if (racks.a.length === racks.b.length) {
      resolvedWinner = null;  // tie — handled below
    } else {
      resolvedWinner = racks.a.length < racks.b.length ? 'a' : 'b';
    }
  }

  if (resolvedWinner === null) {
    // True tie — no score change
    return { winnerSide: null, scoreDeltas: { a: 0, b: 0 } };
  }

  const loser = resolvedWinner === 'a' ? 'b' : 'a';
  const loserPoints = racks[loser].reduce((sum, t) => sum + tileValue(t), 0);
  return {
    winnerSide: resolvedWinner,
    scoreDeltas: {
      [resolvedWinner]: +loserPoints,
      [loser]: -loserPoints,
    },
  };
}
```

- [ ] **Step 4: Run scoring test, verify pass**

Run: `node --test test/rummikub-scoring.test.js`
Expected: PASS

- [ ] **Step 5: Action tests**

Create `test/rummikub-actions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRummikubAction } from '../plugins/rummikub/server/actions.js';

function det(seed = 0) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

const t = (id, color, value) => ({ id, kind: 'numbered', color, value });

function makeState() {
  // Hand-built minimal state for action tests; bypass random deal
  return {
    pool: [t('p1', 'red', 8), t('p2', 'blue', 8), t('p3', 'orange', 8)],
    racks: {
      a: [t('r9', 'red', 9), t('r10', 'red', 10), t('r11', 'red', 11), t('extra', 'blue', 1)],
      b: [t('q1', 'blue', 5), t('q2', 'blue', 6), t('q3', 'blue', 7)],
    },
    table: [],
    initialMeldComplete: { a: false, b: false },
    sides: { a: 1, b: 2 },
    activeUserId: 1,
    scores: { a: 0, b: 0 },
    consecutiveDraws: 0,
    endedReason: null,
    winnerSide: null,
  };
}

test('commit-turn with valid initial meld advances state', () => {
  const state = makeState();
  const proposedEnd = {
    rack: [t('extra', 'blue', 1)],
    table: [[t('r9', 'red', 9), t('r10', 'red', 10), t('r11', 'red', 11)]],
  };
  const result = applyRummikubAction({
    state, action: { type: 'commit-turn', payload: proposedEnd }, actorId: 1, rng: det(1),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.activeUserId, 2);
  assert.equal(result.state.initialMeldComplete.a, true);
  assert.equal(result.state.racks.a.length, 1);
  assert.equal(result.state.table.length, 1);
});

test('commit-turn rejects invalid end-state', () => {
  const state = makeState();
  const proposedEnd = {
    rack: [],
    table: [[t('r9', 'red', 9)]],  // length 1 — invalid set
  };
  const result = applyRummikubAction({
    state, action: { type: 'commit-turn', payload: proposedEnd }, actorId: 1, rng: det(1),
  });
  assert.match(result.error, /set/i);
});

test('commit-turn that empties rack triggers Rummikub! end-game', () => {
  const state = makeState();
  state.initialMeldComplete.a = true;  // skip meld constraint
  state.racks.a = [t('r9', 'red', 9), t('r10', 'red', 10), t('r11', 'red', 11)];
  const proposedEnd = {
    rack: [],
    table: [[t('r9', 'red', 9), t('r10', 'red', 10), t('r11', 'red', 11)]],
  };
  const result = applyRummikubAction({
    state, action: { type: 'commit-turn', payload: proposedEnd }, actorId: 1, rng: det(1),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.ended, true);
  assert.equal(result.state.endedReason, 'rummikub');
  assert.equal(result.state.winnerSide, 'a');
});

test('draw-tile pulls from pool and ends turn', () => {
  const state = makeState();
  const result = applyRummikubAction({
    state, action: { type: 'draw-tile', payload: {} }, actorId: 1, rng: det(2),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.racks.a.length, 5);  // 4 + 1
  assert.equal(result.state.pool.length, 2);
  assert.equal(result.state.activeUserId, 2);
});

test('draw-tile when pool empty triggers end-game evaluation', () => {
  const state = makeState();
  state.pool = [];
  const result = applyRummikubAction({
    state, action: { type: 'draw-tile', payload: {} }, actorId: 1, rng: det(3),
  });
  assert.equal(result.error, undefined);
  assert.equal(result.ended, true);  // no tiles to draw → end
});

test('resign ends the game with opponent as winner', () => {
  const state = makeState();
  const result = applyRummikubAction({
    state, action: { type: 'resign', payload: {} }, actorId: 1, rng: det(4),
  });
  assert.equal(result.ended, true);
  assert.equal(result.state.endedReason, 'resign');
  assert.equal(result.state.winnerSide, 'b');
});

test('unknown action returns error', () => {
  const state = makeState();
  const result = applyRummikubAction({
    state, action: { type: 'frobnicate', payload: {} }, actorId: 1, rng: det(5),
  });
  assert.match(result.error, /unknown action/i);
});
```

- [ ] **Step 6: Run, verify failure**

Run: `node --test test/rummikub-actions.test.js`
Expected: FAIL

- [ ] **Step 7: Implement `plugins/rummikub/server/actions.js`**

```js
import { validateEndState } from './validate.js';
import { computeFinalScores } from './scoring.js';

export function applyRummikubAction({ state, action, actorId, rng }) {
  const actorSide = state.sides.a === actorId ? 'a' : 'b';
  const oppSide = actorSide === 'a' ? 'b' : 'a';
  const oppUserId = state.sides[oppSide];

  switch (action.type) {
    case 'commit-turn': return doCommitTurn(state, action.payload, actorSide, oppSide, oppUserId);
    case 'draw-tile': return doDrawTile(state, actorSide, oppUserId, rng);
    case 'resign': return doResign(state, actorSide);
    default: return { error: `unknown action: ${action.type}` };
  }
}

function doCommitTurn(state, payload, actorSide, oppSide, oppUserId) {
  const proposedRack = payload?.rack;
  const proposedTable = payload?.table;
  if (!Array.isArray(proposedRack) || !Array.isArray(proposedTable)) {
    return { error: 'commit-turn payload requires {rack, table} arrays' };
  }
  const validation = validateEndState(
    {
      rack: state.racks[actorSide],
      table: state.table,
      initialMeldComplete: state.initialMeldComplete[actorSide],
    },
    { rack: proposedRack, table: proposedTable }
  );
  if (!validation.valid) return { error: validation.reason };

  const next = {
    ...state,
    racks: { ...state.racks, [actorSide]: proposedRack },
    table: proposedTable,
    initialMeldComplete: { ...state.initialMeldComplete, [actorSide]: true },
    activeUserId: oppUserId,
    consecutiveDraws: 0,
  };

  // Rummikub! end-game
  if (proposedRack.length === 0) {
    const final = computeFinalScores({ winnerSide: actorSide, racks: next.racks });
    return {
      state: {
        ...next,
        endedReason: 'rummikub',
        winnerSide: final.winnerSide,
        scores: addScores(state.scores, final.scoreDeltas),
      },
      ended: true,
      scoreDelta: final.scoreDeltas,
    };
  }

  return { state: next, ended: false };
}

function doDrawTile(state, actorSide, oppUserId, rng) {
  if (state.pool.length === 0) {
    // Pool exhausted with no winner: end-of-game evaluation
    const final = computeFinalScores({ winnerSide: null, racks: state.racks });
    return {
      state: {
        ...state,
        endedReason: 'pool-exhausted',
        winnerSide: final.winnerSide,
        scores: addScores(state.scores, final.scoreDeltas),
      },
      ended: true,
      scoreDelta: final.scoreDeltas,
    };
  }
  const idx = Math.floor(rng() * state.pool.length);
  const drawn = state.pool[idx];
  const pool = [...state.pool.slice(0, idx), ...state.pool.slice(idx + 1)];
  const racks = { ...state.racks, [actorSide]: [...state.racks[actorSide], drawn] };
  return {
    state: {
      ...state,
      pool,
      racks,
      activeUserId: oppUserId,
      consecutiveDraws: state.consecutiveDraws + 1,
    },
    ended: false,
  };
}

function doResign(state, actorSide) {
  const winner = actorSide === 'a' ? 'b' : 'a';
  return {
    state: { ...state, endedReason: 'resign', winnerSide: winner },
    ended: true,
  };
}

function addScores(base, delta) {
  return { a: base.a + (delta.a ?? 0), b: base.b + (delta.b ?? 0) };
}
```

- [ ] **Step 8: Run all rummikub server tests**

Run: `node --test test/rummikub-*.test.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add plugins/rummikub/server/actions.js plugins/rummikub/server/scoring.js test/rummikub-actions.test.js test/rummikub-scoring.test.js
git commit -m "feat(rummikub): commit-turn, draw-tile, resign action handlers"
```

---

## Task 8: publicView — hide opponent rack

**Files:**
- Create: `plugins/rummikub/server/view.js`
- Test: append to `test/rummikub-actions.test.js` (or new file)

`publicView({ state, viewerId })` returns a view where the opponent's rack is replaced with `{ count: N }`. Pool tiles' identities are not exposed (only count).

- [ ] **Step 1: Test (append to actions test)**

```js
import { rummikubPublicView } from '../plugins/rummikub/server/view.js';

test('publicView hides opponent rack tiles, exposes count', () => {
  const state = makeState();
  // Viewer is user 1 (side a)
  const view = rummikubPublicView({ state, viewerId: 1 });
  assert.equal(view.racks.a.length, 4);
  assert.deepEqual(view.opponentRack, { count: 3 });
  assert.equal(view.racks.b, undefined);
  assert.deepEqual(view.pool, { count: 3 });  // count only
});

test('publicView includes table, scores, sides, activeUserId, end fields', () => {
  const state = makeState();
  const view = rummikubPublicView({ state, viewerId: 1 });
  assert.deepEqual(view.table, []);
  assert.deepEqual(view.scores, { a: 0, b: 0 });
  assert.deepEqual(view.sides, { a: 1, b: 2 });
  assert.equal(view.activeUserId, 1);
  assert.equal(view.endedReason, null);
  assert.equal(view.winnerSide, null);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/rummikub-actions.test.js`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement view.js**

```js
export function rummikubPublicView({ state, viewerId }) {
  const viewerSide = state.sides.a === viewerId ? 'a' : (state.sides.b === viewerId ? 'b' : null);
  const oppSide = viewerSide === 'a' ? 'b' : 'a';

  const racks = {};
  if (viewerSide) racks[viewerSide] = state.racks[viewerSide];

  return {
    table: state.table,
    racks,
    opponentRack: { count: state.racks[oppSide]?.length ?? 0 },
    pool: { count: state.pool.length },
    initialMeldComplete: state.initialMeldComplete,
    sides: state.sides,
    activeUserId: state.activeUserId,
    scores: state.scores,
    endedReason: state.endedReason,
    winnerSide: state.winnerSide,
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/rummikub-actions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/server/view.js test/rummikub-actions.test.js
git commit -m "feat(rummikub): publicView hides opponent rack and pool tile identities"
```

---

## Task 9: Plugin manifest and registration

**Files:**
- Modify: `plugins/rummikub/plugin.js`
- Modify: `src/plugins/index.js`
- Test: `test/rummikub-plugin.test.js`

Wire `initialState`, `applyAction`, `publicView` into the manifest. Register in the static registry.

- [ ] **Step 1: Test full plugin contract**

Create `test/rummikub-plugin.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rummikubPlugin from '../plugins/rummikub/plugin.js';
import { validatePlugin } from '../src/server/plugins.js';

test('plugin manifest passes validator', () => {
  assert.doesNotThrow(() => validatePlugin(rummikubPlugin));
});

test('manifest fields', () => {
  assert.equal(rummikubPlugin.id, 'rummikub');
  assert.equal(rummikubPlugin.displayName, 'Rummikub');
  assert.equal(rummikubPlugin.players, 2);
  assert.match(rummikubPlugin.clientDir, /plugins\/rummikub\/client/);
});

test('initialState produces full game state', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  const s = rummikubPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  assert.equal(s.racks.a.length, 14);
  assert.equal(s.racks.b.length, 14);
  assert.equal(s.pool.length, 78);
});

test('publicView is wired through', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  const state = rummikubPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  const view = rummikubPlugin.publicView({ state, viewerId: 1 });
  assert.ok(view.racks.a);
  assert.equal(view.racks.b, undefined);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `node --test test/rummikub-plugin.test.js`
Expected: FAIL (manifest functions still throw)

- [ ] **Step 3: Wire the manifest**

Replace `plugins/rummikub/plugin.js`:

```js
import { buildInitialState } from './server/state.js';
import { applyRummikubAction } from './server/actions.js';
import { rummikubPublicView } from './server/view.js';

export default {
  id: 'rummikub',
  displayName: 'Rummikub',
  players: 2,
  clientDir: 'plugins/rummikub/client',

  initialState: buildInitialState,
  applyAction: applyRummikubAction,
  publicView: rummikubPublicView,
};
```

- [ ] **Step 4: Run, verify pass**

Run: `node --test test/rummikub-plugin.test.js`
Expected: PASS

- [ ] **Step 5: Register in `src/plugins/index.js`**

```js
import wordsPlugin from '../../plugins/words/plugin.js';
import rummikubPlugin from '../../plugins/rummikub/plugin.js';

export const plugins = {
  words: wordsPlugin,
  rummikub: rummikubPlugin,
};
```

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add plugins/rummikub/plugin.js src/plugins/index.js test/rummikub-plugin.test.js
git commit -m "feat(rummikub): wire plugin manifest + register in static registry"
```

---

## Task 10: Client bootstrap — fetch state, open SSE, basic shell

**Files:**
- Create: `plugins/rummikub/client/index.html`
- Create: `plugins/rummikub/client/app.js`
- Create: `plugins/rummikub/client/style.css`

The plugin's HTML loads, reads `window.__GAME__` (injected by host), fetches initial state, opens SSE for updates. Basic header showing scores + whose turn + opponent rack count + pool count. No interactivity yet — just renders state into the DOM as text.

- [ ] **Step 1: Create `plugins/rummikub/client/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rummikub</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <a class="back" href="/">← Lobby</a>
    <div class="scores">
      <span class="me">You: <span id="my-score">0</span></span>
      <span class="opp">Opponent: <span id="opp-score">0</span></span>
    </div>
    <div class="meta">
      <span id="turn-indicator"></span>
      <span class="pool">Pool: <span id="pool-count">0</span></span>
      <span class="opp-rack">Opp: <span id="opp-rack-count">0</span> tiles</span>
    </div>
  </header>
  <main>
    <section id="meld-indicator" class="hidden">
      Initial meld: <span id="meld-points">0</span> / 30 pts
    </section>
    <section id="table" aria-label="Table"></section>
    <section id="rack" aria-label="Your rack"></section>
    <section id="controls">
      <button id="btn-sort">Sort</button>
      <button id="btn-reset" disabled>Reset turn</button>
      <button id="btn-draw">Draw tile</button>
      <button id="btn-end" disabled>End turn</button>
      <button id="btn-resign">Resign</button>
    </section>
    <section id="end-screen" class="hidden">
      <h2 id="end-headline"></h2>
      <p id="end-summary"></p>
      <button id="btn-new">New game</button>
    </section>
  </main>
  <script src="app.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: Create `plugins/rummikub/client/style.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #f7f5f0; }
header { display: flex; gap: 1rem; align-items: baseline; padding: 0.5rem 1rem; background: #fff; border-bottom: 1px solid #ddd; }
header .back { color: #555; text-decoration: none; }
header .scores { font-weight: 600; display: flex; gap: 1rem; }
header .meta { margin-left: auto; display: flex; gap: 1rem; font-size: 0.9em; opacity: 0.7; }
main { padding: 1rem; }
.hidden { display: none; }
#meld-indicator { padding: 0.5rem; background: #ffe; border: 1px solid #ee9; border-radius: 6px; margin-bottom: 0.5rem; font-size: 0.9em; }
#table { min-height: 6rem; padding: 0.5rem; background: #fff; border-radius: 8px; box-shadow: inset 0 0 0 1px #ddd; }
#table .set { display: flex; gap: 2px; padding: 4px; margin-bottom: 6px; min-height: 2.5rem; align-items: center; border: 1px dashed transparent; border-radius: 6px; }
#table .set.drop-target { border-color: #6a6; background: #efe; }
#table .new-set { border: 1px dashed #aaa; min-height: 2.5rem; padding: 0.5rem; opacity: 0.7; }
#rack { display: flex; flex-wrap: wrap; gap: 4px; padding: 0.5rem; background: #fff; border-radius: 8px; margin-top: 1rem; min-height: 3rem; box-shadow: inset 0 0 0 1px #ddd; }
.tile { width: 2.5rem; height: 3rem; border: 1px solid #888; border-radius: 4px; background: #fafafa; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1.1em; user-select: none; cursor: grab; }
.tile.color-red { color: #c33; }
.tile.color-blue { color: #36c; }
.tile.color-orange { color: #d80; }
.tile.color-black { color: #333; }
.tile.joker { background: #fffae6; color: #a73; }
.tile.joker .represents { font-size: 0.7em; opacity: 0.7; }
.tile.dragging { opacity: 0.4; }
#controls { display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap; }
#controls button { padding: 0.5rem 1rem; border-radius: 4px; border: 1px solid #888; background: #fff; cursor: pointer; }
#controls button:disabled { opacity: 0.5; cursor: not-allowed; }
#end-screen { padding: 1rem; background: #fff; border-radius: 8px; margin-top: 1rem; }
```

- [ ] **Step 3: Create `plugins/rummikub/client/app.js`**

```js
const ctx = window.__GAME__;
let state = null;

async function fetchState() {
  const r = await fetch(ctx.stateUrl);
  if (!r.ok) throw new Error(`state fetch failed: ${r.status}`);
  const json = await r.json();
  state = json.state;
  render();
}

function render() {
  if (!state) return;
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 'a' : 'b';
  const oppSide = mySide === 'a' ? 'b' : 'a';

  document.getElementById('my-score').textContent = state.scores[mySide];
  document.getElementById('opp-score').textContent = state.scores[oppSide];
  document.getElementById('turn-indicator').textContent =
    state.activeUserId === myUserId ? 'Your turn' : "Opponent's turn";
  document.getElementById('pool-count').textContent = state.pool.count;
  document.getElementById('opp-rack-count').textContent = state.opponentRack.count;

  // Meld indicator
  const meldEl = document.getElementById('meld-indicator');
  if (!state.initialMeldComplete[mySide]) {
    meldEl.classList.remove('hidden');
    document.getElementById('meld-points').textContent = '0';  // will recompute on tentative changes (Task 14)
  } else {
    meldEl.classList.add('hidden');
  }

  // Render table and rack as text for now (Tasks 11-12 give them real DOM)
  const tableEl = document.getElementById('table');
  tableEl.textContent = JSON.stringify(state.table);
  const rackEl = document.getElementById('rack');
  rackEl.textContent = JSON.stringify(state.racks[mySide] ?? []);

  // End-game screen
  if (state.endedReason) {
    const screen = document.getElementById('end-screen');
    screen.classList.remove('hidden');
    document.getElementById('end-headline').textContent =
      state.winnerSide === mySide ? 'You won!' : 'You lost.';
    document.getElementById('end-summary').textContent = `Reason: ${state.endedReason}`;
  }
}

function openSSE() {
  const es = new EventSource(ctx.sseUrl);
  es.addEventListener('update', () => fetchState());
  es.addEventListener('ended', () => fetchState());
  es.onerror = () => {/* let browser auto-reconnect */};
}

fetchState();
openSSE();
```

- [ ] **Step 4: Manual smoke test**

Run: `npm start`
Set DEV_USER, navigate to `/`, click + Start new game with an opponent, choose Rummikub.
Verify: page loads, header shows your score 0, opponent's rack count 14, pool 78. Open second browser as opponent, verify same view from their perspective. Note the rack JSON dumps are placeholders for Tasks 11-12.

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/client/
git commit -m "feat(rummikub): client bootstrap — state fetch, SSE, basic shell"
```

---

## Task 11: Tile + rack rendering with sort

**Files:**
- Create: `plugins/rummikub/client/tile.js`
- Create: `plugins/rummikub/client/rack.js`
- Modify: `plugins/rummikub/client/app.js`

Render tiles as DOM elements (with color and value); render the rack as a flex row of tile elements. **Sort** button toggles between by-color-then-number and by-number-then-color.

- [ ] **Step 1: `plugins/rummikub/client/tile.js`**

```js
export function tileEl(tile) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.tileId = tile.id;
  if (tile.kind === 'numbered') {
    el.classList.add(`color-${tile.color}`);
    el.textContent = tile.value;
  } else if (tile.kind === 'joker') {
    el.classList.add('joker');
    el.textContent = '★';
    if (tile.representsValue !== undefined) {
      const r = document.createElement('span');
      r.className = 'represents';
      r.textContent = ` ${tile.representsColor?.[0] ?? '?'}${tile.representsValue}`;
      el.appendChild(r);
    }
  }
  return el;
}
```

- [ ] **Step 2: `plugins/rummikub/client/rack.js`**

```js
import { tileEl } from './tile.js';

const COLOR_ORDER = ['red', 'blue', 'orange', 'black'];
let sortMode = 'color-num';

export function setRackSortMode(mode) { sortMode = mode; }

export function renderRack(rackEl, tiles) {
  rackEl.innerHTML = '';
  for (const t of sortedTiles(tiles)) rackEl.appendChild(tileEl(t));
}

export function toggleSortMode() {
  sortMode = sortMode === 'color-num' ? 'num-color' : 'color-num';
}

function sortedTiles(tiles) {
  const out = [...tiles];
  out.sort((a, b) => {
    if (a.kind === 'joker' && b.kind !== 'joker') return 1;
    if (b.kind === 'joker' && a.kind !== 'joker') return -1;
    if (a.kind === 'joker' && b.kind === 'joker') return a.id.localeCompare(b.id);
    if (sortMode === 'color-num') {
      const ca = COLOR_ORDER.indexOf(a.color), cb = COLOR_ORDER.indexOf(b.color);
      if (ca !== cb) return ca - cb;
      return a.value - b.value;
    } else {
      if (a.value !== b.value) return a.value - b.value;
      return COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color);
    }
  });
  return out;
}
```

- [ ] **Step 3: Wire into `app.js`**

Replace the rack JSON dump with:

```js
import { renderRack, toggleSortMode } from './rack.js';

// inside render():
const rackEl = document.getElementById('rack');
renderRack(rackEl, state.racks[mySide] ?? []);

// at end of file:
document.getElementById('btn-sort').addEventListener('click', () => {
  toggleSortMode();
  render();
});
```

- [ ] **Step 4: Manual smoke**

Reload the page. Tiles should appear in the rack with colors. Click Sort — order changes.

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/client/tile.js plugins/rummikub/client/rack.js plugins/rummikub/client/app.js
git commit -m "feat(rummikub-client): tile + rack rendering with sort toggle"
```

---

## Task 12: Table rendering — rows of sets

**Files:**
- Create: `plugins/rummikub/client/table.js`
- Modify: `plugins/rummikub/client/app.js`

Each set on the table renders as a horizontal row. New set zone at the bottom (initially hidden until a turn is in progress, but render it always to make drag feedback simpler — Task 13 wires the highlighting).

- [ ] **Step 1: `plugins/rummikub/client/table.js`**

```js
import { tileEl } from './tile.js';

export function renderTable(tableEl, sets) {
  tableEl.innerHTML = '';
  sets.forEach((set, idx) => {
    const setDiv = document.createElement('div');
    setDiv.className = 'set';
    setDiv.dataset.setIdx = idx;
    for (const tile of set) setDiv.appendChild(tileEl(tile));
    tableEl.appendChild(setDiv);
  });
  const newSetDiv = document.createElement('div');
  newSetDiv.className = 'set new-set';
  newSetDiv.dataset.newSet = '1';
  newSetDiv.textContent = '+ New set';
  tableEl.appendChild(newSetDiv);
}
```

- [ ] **Step 2: Wire into `app.js`**

Replace the table JSON dump with:

```js
import { renderTable } from './table.js';

// inside render():
const tableEl = document.getElementById('table');
renderTable(tableEl, state.table);
```

- [ ] **Step 3: Manual smoke**

Reload page. Table area shows a "+ New set" placeholder when empty. After a move, sets render as rows.

- [ ] **Step 4: Commit**

```bash
git add plugins/rummikub/client/table.js plugins/rummikub/client/app.js
git commit -m "feat(rummikub-client): table rendering — rows of sets + new-set zone"
```

---

## Task 13: Drag mechanics + tentative-state manager

**Files:**
- Create: `plugins/rummikub/client/drag.js`
- Create: `plugins/rummikub/client/turn.js`
- Modify: `plugins/rummikub/client/app.js`

Drag a tile from the rack to the table (any set, or the "+ New set" zone), or between sets. Tentative state lives in `turn.js` and is the source of truth for rendering during a turn — initialized from the server's last-known state at the start of each turn, mutated locally on each drag-drop, and rolled back on Reset.

- [ ] **Step 1: `plugins/rummikub/client/turn.js`**

```js
// Tentative-state manager. Owns the (rack, table) being assembled during the player's turn.

let snapshot = null;     // start-of-turn state (frozen)
let tentative = null;    // current proposed state

export function beginTurn(rack, table) {
  snapshot = { rack: deepClone(rack), table: deepCloneTable(table) };
  tentative = { rack: deepClone(rack), table: deepCloneTable(table) };
}

export function getTentative() { return tentative; }
export function getSnapshot() { return snapshot; }

export function resetTurn() {
  if (!snapshot) return;
  tentative = { rack: deepClone(snapshot.rack), table: deepCloneTable(snapshot.table) };
}

export function moveTileTo(tileId, target) {
  if (!tentative) return;
  // 1. Remove tile from current location
  let tile = removeFromRack(tentative.rack, tileId);
  if (!tile) tile = removeFromTable(tentative.table, tileId);
  if (!tile) return;
  // 2. Add to target
  if (target.kind === 'rack') {
    tentative.rack.push(tile);
  } else if (target.kind === 'set') {
    const set = tentative.table[target.setIdx];
    if (set) {
      const insertAt = target.position ?? set.length;
      set.splice(insertAt, 0, tile);
    }
  } else if (target.kind === 'new-set') {
    tentative.table.push([tile]);
  }
  pruneEmptySets(tentative.table);
}

export function hasPendingChanges() {
  return tentative && (tentative.rack.length !== snapshot.rack.length || !tableSame(tentative.table, snapshot.table));
}

function deepClone(arr) { return arr.map(t => ({ ...t })); }
function deepCloneTable(table) { return table.map(deepClone); }

function removeFromRack(rack, id) {
  const idx = rack.findIndex(t => t.id === id);
  if (idx < 0) return null;
  return rack.splice(idx, 1)[0];
}
function removeFromTable(table, id) {
  for (const set of table) {
    const idx = set.findIndex(t => t.id === id);
    if (idx >= 0) return set.splice(idx, 1)[0];
  }
  return null;
}
function pruneEmptySets(table) {
  for (let i = table.length - 1; i >= 0; i--) {
    if (table[i].length === 0) table.splice(i, 1);
  }
}
function tableSame(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) {
      if (a[i][j].id !== b[i][j].id) return false;
    }
  }
  return true;
}
```

- [ ] **Step 2: `plugins/rummikub/client/drag.js`**

```js
import { moveTileTo } from './turn.js';

export function attachDrag(rootEl, onAfterMove) {
  let dragging = null;

  rootEl.addEventListener('pointerdown', (e) => {
    const tileEl = e.target.closest('.tile');
    if (!tileEl) return;
    dragging = { tileId: tileEl.dataset.tileId, ghost: makeGhost(tileEl, e) };
    tileEl.classList.add('dragging');
    rootEl.setPointerCapture(e.pointerId);
  });

  rootEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dragging.ghost.style.left = `${e.clientX - 20}px`;
    dragging.ghost.style.top = `${e.clientY - 25}px`;
    // Highlight drop target
    document.querySelectorAll('.set').forEach(s => s.classList.remove('drop-target'));
    const dropEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.set, #rack');
    if (dropEl?.classList.contains('set')) dropEl.classList.add('drop-target');
  });

  rootEl.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    const dropEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.set, #rack');
    let target;
    if (!dropEl) target = null;
    else if (dropEl.id === 'rack') target = { kind: 'rack' };
    else if (dropEl.dataset.newSet) target = { kind: 'new-set' };
    else if (dropEl.dataset.setIdx) target = { kind: 'set', setIdx: Number(dropEl.dataset.setIdx) };

    if (target) moveTileTo(dragging.tileId, target);

    dragging.ghost.remove();
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.set').forEach(s => s.classList.remove('drop-target'));
    dragging = null;
    onAfterMove?.();
  });
}

function makeGhost(srcEl, ev) {
  const g = srcEl.cloneNode(true);
  g.style.position = 'fixed';
  g.style.left = `${ev.clientX - 20}px`;
  g.style.top = `${ev.clientY - 25}px`;
  g.style.pointerEvents = 'none';
  g.style.zIndex = 1000;
  document.body.appendChild(g);
  return g;
}
```

- [ ] **Step 3: Wire into `app.js`**

```js
import { beginTurn, getTentative, resetTurn, hasPendingChanges } from './turn.js';
import { attachDrag } from './drag.js';

// After fetchState() succeeds, if it's our turn and we don't already have a turn in progress, begin one:
function maybeBeginTurn() {
  const myUserId = ctx.userId;
  if (state.activeUserId !== myUserId) return;
  if (state.endedReason) return;
  const mySide = state.sides.a === myUserId ? 'a' : 'b';
  beginTurn(state.racks[mySide], state.table);
  renderTentative();
}

function renderTentative() {
  const tent = getTentative();
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 'a' : 'b';
  const rackEl = document.getElementById('rack');
  const tableEl = document.getElementById('table');
  // Use tentative for the player's own rack/table when it's their turn; otherwise server state
  const rack = tent ? tent.rack : (state.racks[mySide] ?? []);
  const table = tent ? tent.table : state.table;
  // (re-import renderRack/renderTable; render with tentative)
  renderRack(rackEl, rack);
  renderTable(tableEl, table);

  document.getElementById('btn-reset').disabled = !hasPendingChanges();
  // btn-end enabling depends on validation — Task 14 wires it
}

// Replace the old `render()` body with one that calls maybeBeginTurn() then renderTentative()
// (in addition to header/score updates).

attachDrag(document.body, renderTentative);
document.getElementById('btn-reset').addEventListener('click', () => {
  resetTurn();
  renderTentative();
});
```

(The above is sketch — adapt to fit the existing `render()` structure from
Task 10 without duplicating header rendering.)

- [ ] **Step 4: Manual smoke**

Reload the page. On your turn, drag a tile from rack to a set (or to "+ New set"). The tile moves. Reset returns it. Sets in invalid configurations (e.g. length 1) are visible but can't be ended yet (button stays disabled).

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/client/turn.js plugins/rummikub/client/drag.js plugins/rummikub/client/app.js
git commit -m "feat(rummikub-client): drag mechanics + tentative-state manager + reset"
```

---

## Task 14: Client-side validation mirror + End Turn enabling

**Files:**
- Create: `plugins/rummikub/client/validate.js` (mirrors server validator)
- Modify: `plugins/rummikub/client/app.js`

Mirror the server's `validateEndState` on the client (using the same logic, since it's pure JS) so the End Turn button enables only when the proposed state is legal. Server is still the final authority.

- [ ] **Step 1: Re-export the server validator into the client**

Two options: copy the file (duplication) or import from `../server/validate.js` (works if the static-serve path allows it; it doesn't by default — assets are served from `clientDir`, which is `plugins/rummikub/client/`).

Resolution: copy `validate.js`, `multiset.js`, `sets.js`, `tiles.js` into `plugins/rummikub/client/` (or symlink). Easiest: keep server files canonical, and at build/start time copy them. Simplest: copy the four files manually (small project; once the rules stabilize, copying them again is rare).

For now, create `plugins/rummikub/client/validate.js` as a clone of `plugins/rummikub/server/validate.js` and `plugins/rummikub/client/sets.js`, etc. Each file is small.

```bash
cp plugins/rummikub/server/validate.js plugins/rummikub/client/validate.js
cp plugins/rummikub/server/sets.js plugins/rummikub/client/sets.js
cp plugins/rummikub/server/multiset.js plugins/rummikub/client/multiset.js
cp plugins/rummikub/server/tiles.js plugins/rummikub/client/tiles.js
```

Update each copied file's relative imports if needed (they all import from siblings, so no change).

- [ ] **Step 2: Wire into `app.js`**

```js
import { validateEndState } from './validate.js';

function refreshEndButton() {
  const tent = getTentative();
  const snap = getSnapshot();
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 'a' : 'b';
  if (!tent || state.activeUserId !== myUserId) {
    document.getElementById('btn-end').disabled = true;
    return;
  }
  const result = validateEndState(
    { rack: snap.rack, table: snap.table, initialMeldComplete: state.initialMeldComplete[mySide] },
    { rack: tent.rack, table: tent.table }
  );
  const btn = document.getElementById('btn-end');
  btn.disabled = !result.valid;
  btn.title = result.valid ? '' : result.reason;
}
```

Call `refreshEndButton()` from inside `renderTentative()`.

- [ ] **Step 3: Update meld indicator**

Inside `render()` (or `renderTentative()`), if not initial-meld-complete, recompute meld points from tentative state's *new sets* (sets in tentative.table not present by tile-id in snapshot.table) and update `#meld-points`. Use the `setValue` helper from `sets.js`.

```js
import { setValue } from './sets.js';

function refreshMeldIndicator() {
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 'a' : 'b';
  if (state.initialMeldComplete[mySide]) {
    document.getElementById('meld-indicator').classList.add('hidden');
    return;
  }
  document.getElementById('meld-indicator').classList.remove('hidden');
  const tent = getTentative();
  const snap = getSnapshot();
  if (!tent) {
    document.getElementById('meld-points').textContent = '0';
    return;
  }
  const startKeys = new Set(snap.table.map(s => s.map(t => t.id).sort().join(',')));
  let pts = 0;
  for (const set of tent.table) {
    const key = set.map(t => t.id).sort().join(',');
    if (!startKeys.has(key)) pts += setValue(set);
  }
  document.getElementById('meld-points').textContent = pts;
}
```

- [ ] **Step 4: Manual smoke**

Reload the page. Drag tiles into a valid arrangement (≥30 points if initial meld). End Turn becomes enabled. Drag into invalid → disabled (with tooltip showing reason).

- [ ] **Step 5: Commit**

```bash
git add plugins/rummikub/client/
git commit -m "feat(rummikub-client): client-side validation mirror + End Turn enabling"
```

---

## Task 15: Action submission — End Turn, Draw, Resign, New Game

**Files:**
- Modify: `plugins/rummikub/client/app.js`

Wire each control button to fire the corresponding action POST. After a successful action, the SSE update will trigger a `fetchState()` that syncs the new server state.

- [ ] **Step 1: Wire button handlers**

```js
async function postAction(type, payload) {
  const r = await fetch(ctx.actionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    alert(body.error ?? `action failed (${r.status})`);
    return null;
  }
  return r.json();
}

document.getElementById('btn-end').addEventListener('click', async () => {
  const tent = getTentative();
  if (!tent) return;
  // Strip down tiles to send only id + jokerRepresents annotations (not full color/value;
  // server already knows them). But sending full tile objects is also fine and unambiguous.
  await postAction('commit-turn', { rack: tent.rack, table: tent.table });
  // SSE will refresh
});

document.getElementById('btn-draw').addEventListener('click', async () => {
  if (hasPendingChanges()) {
    if (!confirm('Drawing will discard your pending moves. Continue?')) return;
    resetTurn();
    renderTentative();
  }
  await postAction('draw-tile', {});
});

document.getElementById('btn-resign').addEventListener('click', async () => {
  if (!confirm('Resign this game?')) return;
  await postAction('resign', {});
});

document.getElementById('btn-new').addEventListener('click', async () => {
  // Find opponent userId from state.sides
  const myUserId = ctx.userId;
  const oppUserId = state.sides.a === myUserId ? state.sides.b : state.sides.a;
  const r = await fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opponentId: oppUserId, gameType: 'rummikub' }),
  });
  if (!r.ok) { alert('could not start new game'); return; }
  const { id, gameType } = await r.json();
  window.location.href = `/play/${gameType}/${id}/`;
});
```

- [ ] **Step 2: Disable Draw if pending changes; disable End if state empty**

Update `renderTentative()`:

```js
document.getElementById('btn-draw').disabled = state.endedReason || state.activeUserId !== ctx.userId;
document.getElementById('btn-resign').disabled = !!state.endedReason;
```

- [ ] **Step 3: Manual smoke (full play)**

Open in two browsers as opposite sides. As the active player:
1. Drag tiles into a valid initial meld of ≥30 pts
2. Click End Turn
3. Other browser receives SSE update; their turn now
4. Repeat with manipulation moves
5. Click Resign → confirm → other side wins

- [ ] **Step 4: Commit**

```bash
git add plugins/rummikub/client/app.js
git commit -m "feat(rummikub-client): action submission for end-turn, draw, resign, new-game"
```

---

## Task 16: Joker-on-rack representation picker

**Files:**
- Modify: `plugins/rummikub/client/drag.js`
- Modify: `plugins/rummikub/client/app.js`

When the player drops a joker into a set on the table, prompt them for what tile it represents (color + value). The server requires `representsColor`/`representsValue` annotations on every joker on the table; this UX captures them at drop time.

- [ ] **Step 1: Add representation prompt**

In `drag.js`, after the `moveTileTo(...)` call (only when target is set or new-set, and the dragged tile is a joker that has no current representation OR was just moved into a new structural position):

```js
if (target.kind === 'set' || target.kind === 'new-set') {
  const tile = findTileInTentative(dragging.tileId);
  if (tile?.kind === 'joker') promptJokerRepresentation(tile);
}
```

Implement `promptJokerRepresentation` as a simple modal:

```js
function promptJokerRepresentation(tile) {
  const color = prompt('Joker represents which color? (red/blue/orange/black)', tile.representsColor ?? '');
  if (!color) return;
  const valStr = prompt('Joker represents which value? (1-13)', tile.representsValue ?? '');
  const value = Number(valStr);
  if (!Number.isInteger(value) || value < 1 || value > 13) return;
  tile.representsColor = color;
  tile.representsValue = value;
}
```

(A modal with select/buttons would be nicer; this prompt-based version is
acceptable for v1. Move to a real dialog when the joker UX gets re-touched.)

- [ ] **Step 2: Strip representation when joker returns to rack**

In `turn.js`'s `moveTileTo`, when target is `rack`, clear `representsColor`/`representsValue`:

```js
if (target.kind === 'rack') {
  if (tile.kind === 'joker') {
    delete tile.representsColor;
    delete tile.representsValue;
  }
  tentative.rack.push(tile);
}
```

- [ ] **Step 3: Manual smoke**

Drag a joker from rack to a set. Prompted for color + value. Joker renders with overlay badge. Drag back to rack — badge disappears.

- [ ] **Step 4: Commit**

```bash
git add plugins/rummikub/client/drag.js plugins/rummikub/client/turn.js
git commit -m "feat(rummikub-client): joker representation prompt on table-drop"
```

---

## Task 17: README update + lobby badge color/icon polish

**Files:**
- Modify: `README.md`
- Modify: `public/lobby/lobby.css` (optional polish)

Add Rummikub to the README's "shipped plugins" section, and any plugin-author notes that arise from doing this second plugin (e.g., note about the four-file copy for client-side validation).

- [ ] **Step 1: Update README plugin list**

Find the "Currently shipped plugins" section (added in Plan A Task 16). Add:

```markdown
- **Rummikub** (`plugins/rummikub/`) — Sabra rules, 2 jokers, 30-pt initial
  meld, structured-rows table UI. Player commits a turn-end state via
  `commit-turn`; server validates multiset balance + set legality + initial
  meld + joker harvest atomically.
```

If there's an "Adding a new plugin" section, append a note about copying
client-side validation files (or symlinking) — discovered while doing
Rummikub.

- [ ] **Step 2: Lobby polish (optional)**

If you want the Rummikub badge to look distinct from Words in the lobby
tile, add an icon/emoji prefix in `public/lobby/lobby.js`'s badge rendering:

```js
const ICONS = { words: '📝', rummikub: '🟦' };
a.textContent = `${ICONS[g.gameType] ?? ''} ${plugin?.displayName ?? g.gameType}`;
```

- [ ] **Step 3: Commit**

```bash
git add README.md public/lobby/
git commit -m "docs(rummikub): README mention + lobby badge polish"
```

---

## Task 18: End-to-end smoke test

**Files:**
- Test: `test/e2e-rummikub.test.js`

A full end-to-end exercise of Rummikub through the gamebox host: create a
game, fetch state, perform a draw-tile turn, perform a resign turn,
verify final state.

- [ ] **Step 1: Write the e2e test**

Create `test/e2e-rummikub.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';
import { plugins } from '../src/plugins/index.js';
import { buildRegistry } from '../src/server/plugins.js';

async function setup() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'k@b', 'Keith', '#f', datetime('now'))").run();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 's@b', 'Sonia', '#g', datetime('now'))").run();
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id, email: id === 1 ? 'k@b' : 's@b', friendlyName: id === 1 ? 'Keith' : 'Sonia' };
    next();
  });
  mountRoutes(app, { db, registry: buildRegistry(plugins), sse: { broadcast: () => {} } });
  const server = await new Promise(r => { const s = http.createServer(app); s.listen(0, () => r(s)); });
  return { server, db };
}

async function call(server, method, path, body, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('e2e: create rummikub game, draw + resign produces ended game', async () => {
  const { server } = await setup();

  // Create
  const create = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(create.status, 200);
  const gameId = create.body.id;

  // Fetch state — verify shape
  const stateA = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '1' });
  assert.equal(stateA.status, 200);
  assert.equal(stateA.body.gameType, 'rummikub');
  assert.equal(stateA.body.state.racks.a.length, 14);
  assert.equal(stateA.body.state.opponentRack.count, 14);
  assert.equal(stateA.body.state.pool.count, 78);

  // Active player draws a tile
  const activeUser = stateA.body.state.activeUserId;
  const draw = await call(server, 'POST', `/api/games/${gameId}/action`,
    { type: 'draw-tile' }, { 'x-test-user-id': String(activeUser) });
  assert.equal(draw.status, 200);
  assert.equal(draw.body.ended, false);
  assert.equal(draw.body.state.activeUserId !== activeUser, true);

  // Other player resigns
  const newActive = draw.body.state.activeUserId;
  const resign = await call(server, 'POST', `/api/games/${gameId}/action`,
    { type: 'resign' }, { 'x-test-user-id': String(newActive) });
  assert.equal(resign.status, 200);
  assert.equal(resign.body.ended, true);

  // Game is ended
  const final = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '1' });
  assert.equal(final.body.status, 'ended');

  // Can start a new Rummikub game with same opponent
  const create2 = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(create2.status, 200);

  server.close();
});

test('e2e: cannot have two active rummikub games with same opponent (409)', async () => {
  const { server } = await setup();
  const r1 = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(r1.status, 200);
  const r2 = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(r2.status, 409);
  server.close();
});

test('e2e: words and rummikub games can coexist with same opponent', async () => {
  const { server } = await setup();
  const w = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'words' }, { 'x-test-user-id': '1' });
  assert.equal(w.status, 200);
  const r = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  server.close();
});
```

- [ ] **Step 2: Run, verify pass**

Run: `node --test test/e2e-rummikub.test.js`
Expected: PASS

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: PASS — all gamebox tests across host + words + rummikub.

- [ ] **Step 4: Manual browser smoke**

Run: `npm start`. Set DEV_USER. Open lobby. Start a Rummikub game with another roster member. Play a few turns: drag tiles, attempt invalid moves (button stays disabled), execute a valid initial meld, end turn. Open second browser as opponent — verify SSE delivers the new state. Resign at some point, verify end-game screen. Click "New game" — verifies the same-opponent flow works after end-of-game.

- [ ] **Step 5: Commit**

```bash
git add test/e2e-rummikub.test.js
git commit -m "test(e2e): full Rummikub game through gamebox host"
```

---

## Self-Review

After all 18 tasks:

- [ ] **Spec coverage check.**
  - Tile model (106 tiles, 2 jokers) → Task 2
  - Set rules (run, group, joker) → Task 3
  - Multiset balance → Task 4
  - Initial deal (14 each, 78 pool) → Task 5
  - End-state validation (multiset/sets/meld/joker harvest/at-least-one) → Task 6
  - commit-turn / draw-tile / resign actions → Task 7
  - Rummikub! end-game + scoring → Task 7 (action) + scoring.js
  - Pool-exhausted end-game → Task 7
  - publicView (hidden info) → Task 8
  - Plugin manifest + register → Task 9
  - Client structured-rows table → Tasks 10-12
  - Drag with tentative state + Reset → Task 13
  - End Turn enabling via client-side validation mirror → Task 14
  - Initial meld indicator → Task 14
  - Action submission (commit/draw/resign/new) → Task 15
  - Joker representation prompt → Task 16
  - No turn timer → never implemented (correct, per spec)
  - Sort button → Task 11

- [ ] **No placeholders.** Every step shows real code or an exact action.

- [ ] **Type consistency.**
  - State shape `{ pool, racks: {a,b}, table, initialMeldComplete: {a,b}, sides: {a,b}, activeUserId, scores: {a,b}, consecutiveDraws, endedReason, winnerSide }` consistent across Tasks 5, 6, 7, 8.
  - Tile shape `{ id, kind: 'numbered'|'joker', color?, value?, representsColor?, representsValue? }` consistent across Tasks 2, 3, 6.
  - Action types `commit-turn`, `draw-tile`, `resign` consistent across Tasks 7, 15.

- [ ] **Test commands consistent.** All use `node --test test/<file>.test.js` or `npm test`.
