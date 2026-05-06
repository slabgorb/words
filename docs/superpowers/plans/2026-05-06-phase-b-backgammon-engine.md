# Phase B: Backgammon Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Headless, fully tested backgammon engine — `plugins/backgammon/server/*` plus the plugin manifest, registered in the host's static plugin registry. No client work in this phase. The engine is verifiable end-to-end through `npm test` (node --test).

**Architecture:** Mirror `plugins/rummikub/` exactly. Pure-function modules per spec §4.1, composed by `actions.js`. State shape per spec §4.2 stored in a single JSON column (no schema migration needed — `games.state` is already JSON). Each module is tested in isolation under `test/backgammon-<module>.test.js` using `node:test` + `node:assert/strict`. Branch: `feat/backgammon-engine`.

**Tech stack:** ES modules, `node:test`, `node:assert/strict`, deterministic LCG RNG fixture (lifted from `test/rummikub-actions.test.js`). No new dependencies.

**Reference reading before starting:**
- `docs/superpowers/specs/2026-05-06-backgammon-design.md` (esp. §1, §4, §7)
- `plugins/rummikub/plugin.js`, `plugins/rummikub/server/{state,actions,view,validate}.js`
- `test/rummikub-{plugin,state,actions,validate}.test.js`
- `src/server/plugins.js` (`validatePlugin` contract)

---

## File structure (final state of Phase B)

**Created:**
```
plugins/backgammon/
  plugin.js                             # plugin manifest
  server/
    constants.js                        # board geometry, sides, phases, sentinels
    state.js                            # buildInitialState({participants, rng, options})
    board.js                            # board ops: applyMove, hitCheck, enterFromBar, bearOff, helpers
    cube.js                             # cube state machine: canOffer, applyOffer, applyAccept, applyDecline
    match.js                            # leg classification, score, leg reset, match-end, Crawford
    validate.js                         # enumerateLegalMoves, isLegalMove (composes board + dice)
    actions.js                          # applyBackgammonAction dispatcher
    view.js                             # backgammonPublicView({state, viewerId})
test/
  backgammon-plugin.test.js             # contract + integration smoke
  backgammon-state.test.js              # initial state shape + match-length
  backgammon-board.test.js              # initial layout + board ops
  backgammon-validate.test.js           # legal-move enumeration (5 sub-areas)
  backgammon-cube.test.js               # cube state machine
  backgammon-match.test.js              # leg classification + reset + match end
  backgammon-actions.test.js            # action dispatcher (full-turn flows)
  backgammon-view.test.js               # publicView passthrough + youAre
test/_helpers/
  backgammon-fixtures.js                # det() RNG + makeState() helpers reused across tests
```

**Modified:**
```
src/plugins/index.js                    # register backgammonPlugin
```

**NOT modified in Phase B:** any `plugins/backgammon/client/*` (deferred to Phase C), any `src/server/*` other than the registry, any `vite.config.dice.js` / `src/shared/dice/*` (Phase A is done and frozen).

---

## Conventions baked into this plan (do not re-litigate)

These match the rummikub plugin and are non-negotiable for this phase:

1. **Sides:** `'a'` and `'b'`. State carries `sides: { a: userId, b: userId }`. Active player tracked as `state.turn.activePlayer` (`'a' | 'b'`), not as a userId — match the spec §4.2 shape, not the rummikub `activeUserId` shape (rummikub is per-leg; backgammon's leg context lives under `turn`).
2. **Plugin contract result:** `applyAction` returns `{ state, ended, scoreDelta?, summary?, error? }`. `error` is a string. `ended` is true only at match end (per spec §4.6 — leg ends still return `ended: false`).
3. **Board indexing:** `points[0]` = A's 24-point (his furthest from home), `points[23]` = A's 1-point. A moves +direction (increasing index, decreasing his pip count). B moves -direction. A's home board: indices 18–23. B's home board: indices 0–5.
4. **Move sentinels in action payload:** `from: 'bar' | 0..23`, `to: 'off' | 0..23`. The validator infers which die value the move consumes.
5. **Initial-roll dice:** A's roll is `1d6`, B's roll is `1d6`. On tie both reroll. On resolve the higher-roller becomes `activePlayer`, both values become `turn.dice.values` sorted high-to-low, `turn.dice.remaining` mirrors `values`. `phase` advances to `'moving'`.
6. **Doubles:** `turn.dice.values` stays length-2 (`[6,6]` not `[6,6,6,6]`). `turn.dice.remaining` is length-4 for doubles. Validator and actions read `remaining`, not `values`.
7. **Tests use ES `import` from relative paths** and named exports only — no default exports from server modules.
8. **Test RNG:** LCG factory `det(seed)` lifted from `test/rummikub-actions.test.js` (`s = (s*9301 + 49297) % 233280; return s/233280`). Use `det(0)` for deterministic-but-arbitrary state setup.
9. **No mutation outside dedicated mutators.** State updates via spread; nested updates via spread chain. Match the rummikub style.
10. **No `console.log` in shipped code.** No `try/catch` for control flow — return `{ error }` from validators and the dispatcher.

---

## Branch setup (do this once, before Task 1)

- [ ] Confirm working tree clean for the *backgammon* scope. `git status` may show uncommitted rummikub work — that is separate in-progress work and must not be touched. Verify nothing under `plugins/backgammon/`, `test/backgammon-*`, or `src/plugins/index.js` is dirty:

```bash
git status -- plugins/backgammon test src/plugins/index.js
```
Expected: nothing about those paths.

- [ ] Create the feature branch from current `main`:

```bash
git checkout -b feat/backgammon-engine
```

Expected: `Switched to a new branch 'feat/backgammon-engine'`.

---

## Task 1: Plugin scaffold + contract test

**Files:**
- Create: `plugins/backgammon/plugin.js`
- Create: `plugins/backgammon/server/state.js` (stub)
- Create: `plugins/backgammon/server/actions.js` (stub)
- Create: `plugins/backgammon/server/view.js` (stub)
- Test: `test/backgammon-plugin.test.js`

The goal of this task is to establish the plugin manifest, get a contract test green, and stub `state/actions/view` enough to satisfy `validatePlugin`. We are NOT registering the plugin in `src/plugins/index.js` yet — that's Task 21.

- [ ] **Step 1: Write the failing contract test**

Create `test/backgammon-plugin.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import backgammonPlugin from '../plugins/backgammon/plugin.js';
import { validatePlugin } from '../src/server/plugins.js';

test('plugin manifest passes validator', () => {
  assert.doesNotThrow(() => validatePlugin(backgammonPlugin));
});

test('manifest fields', () => {
  assert.equal(backgammonPlugin.id, 'backgammon');
  assert.equal(backgammonPlugin.displayName, 'Backgammon');
  assert.equal(backgammonPlugin.players, 2);
  assert.match(backgammonPlugin.clientDir, /plugins\/backgammon\/client/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/backgammon-plugin.test.js`
Expected: FAIL with `Cannot find module '.../plugins/backgammon/plugin.js'`.

- [ ] **Step 3: Create stub modules**

Create `plugins/backgammon/server/state.js`:
```js
export function buildInitialState() {
  return {};
}
```

Create `plugins/backgammon/server/actions.js`:
```js
export function applyBackgammonAction() {
  return { error: 'not implemented' };
}
```

Create `plugins/backgammon/server/view.js`:
```js
export function backgammonPublicView({ state }) {
  return { ...state };
}
```

Create `plugins/backgammon/plugin.js`:
```js
import { buildInitialState } from './server/state.js';
import { applyBackgammonAction } from './server/actions.js';
import { backgammonPublicView } from './server/view.js';

export default {
  id: 'backgammon',
  displayName: 'Backgammon',
  players: 2,
  clientDir: 'plugins/backgammon/client',

  initialState: buildInitialState,
  applyAction: applyBackgammonAction,
  publicView: backgammonPublicView,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/backgammon-plugin.test.js`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon test/backgammon-plugin.test.js
git commit -m "feat(backgammon): plugin scaffold + contract test"
```

---

## Task 2: Constants + initial board layout

**Files:**
- Create: `plugins/backgammon/server/constants.js`
- Create: `plugins/backgammon/server/board.js` (initial layout only)
- Test: `test/backgammon-board.test.js` (part 1)

This task locks down board geometry and the standard initial setup (24/13/8/6 points per side) — see the indexing table in §Conventions above.

- [ ] **Step 1: Write the failing test**

Create `test/backgammon-board.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPoints, BOARD_SIZE, HOME_INDICES } from '../plugins/backgammon/server/board.js';

test('initialPoints returns 24 entries', () => {
  const pts = initialPoints();
  assert.equal(pts.length, 24);
  assert.equal(BOARD_SIZE, 24);
});

test('initialPoints: A has checkers on indices 0, 11, 16, 18', () => {
  const pts = initialPoints();
  assert.deepEqual(pts[0],  { color: 'a', count: 2 });
  assert.deepEqual(pts[11], { color: 'a', count: 5 });
  assert.deepEqual(pts[16], { color: 'a', count: 3 });
  assert.deepEqual(pts[18], { color: 'a', count: 5 });
});

test('initialPoints: B has checkers on indices 23, 12, 7, 5', () => {
  const pts = initialPoints();
  assert.deepEqual(pts[23], { color: 'b', count: 2 });
  assert.deepEqual(pts[12], { color: 'b', count: 5 });
  assert.deepEqual(pts[7],  { color: 'b', count: 3 });
  assert.deepEqual(pts[5],  { color: 'b', count: 5 });
});

test('initialPoints: every other index is empty', () => {
  const pts = initialPoints();
  const occupied = new Set([0, 5, 7, 11, 12, 16, 18, 23]);
  for (let i = 0; i < 24; i++) {
    if (!occupied.has(i)) assert.deepEqual(pts[i], { color: null, count: 0 }, `index ${i}`);
  }
});

test('initialPoints: each side has 15 checkers on the board', () => {
  const pts = initialPoints();
  const sumA = pts.filter(p => p.color === 'a').reduce((s, p) => s + p.count, 0);
  const sumB = pts.filter(p => p.color === 'b').reduce((s, p) => s + p.count, 0);
  assert.equal(sumA, 15);
  assert.equal(sumB, 15);
});

test('HOME_INDICES.a = [18..23], HOME_INDICES.b = [0..5]', () => {
  assert.deepEqual(HOME_INDICES.a, [18, 19, 20, 21, 22, 23]);
  assert.deepEqual(HOME_INDICES.b, [0, 1, 2, 3, 4, 5]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/backgammon-board.test.js`
Expected: FAIL — `Cannot find module .../plugins/backgammon/server/board.js`.

- [ ] **Step 3: Create constants module**

Create `plugins/backgammon/server/constants.js`:

```js
export const BOARD_SIZE = 24;

// Home boards by side. A moves toward higher indices; B toward lower.
export const HOME_INDICES = {
  a: [18, 19, 20, 21, 22, 23],
  b: [0, 1, 2, 3, 4, 5],
};

// Phases (see spec §4.2)
export const PHASE = Object.freeze({
  INITIAL_ROLL: 'initial-roll',
  PRE_ROLL: 'pre-roll',
  MOVING: 'moving',
  AWAITING_DOUBLE_RESPONSE: 'awaiting-double-response',
});

export const SIDES = Object.freeze(['a', 'b']);

export function opponent(side) {
  return side === 'a' ? 'b' : 'a';
}

// Cube cap (spec §4.5)
export const CUBE_CAP = 64;
```

- [ ] **Step 4: Create board.js with initial layout only**

Create `plugins/backgammon/server/board.js`:

```js
import { BOARD_SIZE, HOME_INDICES } from './constants.js';

export { BOARD_SIZE, HOME_INDICES };

export function initialPoints() {
  const pts = Array.from({ length: BOARD_SIZE }, () => ({ color: null, count: 0 }));
  // A: 24-point, 13-point, 8-point, 6-point → indices 0, 11, 16, 18
  pts[0]  = { color: 'a', count: 2 };
  pts[11] = { color: 'a', count: 5 };
  pts[16] = { color: 'a', count: 3 };
  pts[18] = { color: 'a', count: 5 };
  // B (mirror): 24-point, 13-point, 8-point, 6-point → indices 23, 12, 7, 5
  pts[23] = { color: 'b', count: 2 };
  pts[12] = { color: 'b', count: 5 };
  pts[7]  = { color: 'b', count: 3 };
  pts[5]  = { color: 'b', count: 5 };
  return pts;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/backgammon-board.test.js`
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/backgammon/server/constants.js plugins/backgammon/server/board.js test/backgammon-board.test.js
git commit -m "feat(backgammon): initial board layout + geometric constants"
```

---

## Task 3: `buildInitialState` — full state shape

**Files:**
- Modify: `plugins/backgammon/server/state.js`
- Create: `test/_helpers/backgammon-fixtures.js`
- Test: `test/backgammon-state.test.js`

This task locks down `state.match`, `state.cube`, `state.board`, `state.turn`, `state.legHistory`, `state.initialRoll`, `state.sides`. It also creates a shared test fixture used by every later test.

- [ ] **Step 1: Create the test-fixture helper**

Create `test/_helpers/backgammon-fixtures.js`:

```js
// Deterministic LCG used across all backgammon tests.
export function det(seed = 0) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export const PARTICIPANTS = [
  { userId: 1, side: 'a' },
  { userId: 2, side: 'b' },
];
```

- [ ] **Step 2: Write the failing test**

Create `test/backgammon-state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { det, PARTICIPANTS } from './_helpers/backgammon-fixtures.js';

test('buildInitialState defaults matchLength to 3', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.equal(s.match.target, 3);
});

test('buildInitialState accepts options.matchLength', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0), options: { matchLength: 1 } });
  assert.equal(s.match.target, 1);
});

test('buildInitialState: match scoreboard starts at 0/0/game1', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.match, {
    target: 3, scoreA: 0, scoreB: 0,
    gameNumber: 1, crawford: false, crawfordPlayed: false,
  });
});

test('buildInitialState: cube starts at 1, centered, no offer', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.cube, { value: 1, owner: null, pendingOffer: null });
});

test('buildInitialState: board has 15 checkers per side', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.equal(s.board.points.length, 24);
  assert.equal(s.board.barA, 0);
  assert.equal(s.board.barB, 0);
  assert.equal(s.board.bornOffA, 0);
  assert.equal(s.board.bornOffB, 0);
});

test('buildInitialState: turn starts in initial-roll phase, no active player', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.equal(s.turn.phase, 'initial-roll');
  assert.equal(s.turn.activePlayer, null);
  assert.equal(s.turn.dice, null);
});

test('buildInitialState: initialRoll empty 4-field shape', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.initialRoll, { a: null, b: null, throwParamsA: null, throwParamsB: null });
});

test('buildInitialState: legHistory empty array', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.legHistory, []);
});

test('buildInitialState: sides map participants', () => {
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0) });
  assert.deepEqual(s.sides, { a: 1, b: 2 });
});

test('buildInitialState: matchLength=1 disables crawford forever', () => {
  // For target=1 there is never a "target-1" leg, so crawford never triggers.
  // We assert the initial state shape; semantics tested in match.test.js.
  const s = buildInitialState({ participants: PARTICIPANTS, rng: det(0), options: { matchLength: 1 } });
  assert.equal(s.match.target, 1);
  assert.equal(s.match.crawford, false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/backgammon-state.test.js`
Expected: FAIL — `s.match` is undefined (the stub from Task 1 returns `{}`).

- [ ] **Step 4: Implement `buildInitialState`**

Replace `plugins/backgammon/server/state.js` with:

```js
import { initialPoints } from './board.js';
import { PHASE } from './constants.js';

export function buildInitialState({ participants, options }) {
  const a = participants.find(p => p.side === 'a').userId;
  const b = participants.find(p => p.side === 'b').userId;
  const target = Number.isInteger(options?.matchLength) && options.matchLength > 0
    ? options.matchLength
    : 3;

  return {
    sides: { a, b },
    match: {
      target,
      scoreA: 0,
      scoreB: 0,
      gameNumber: 1,
      crawford: false,
      crawfordPlayed: false,
    },
    cube: { value: 1, owner: null, pendingOffer: null },
    board: {
      points: initialPoints(),
      barA: 0, barB: 0,
      bornOffA: 0, bornOffB: 0,
    },
    turn: {
      activePlayer: null,
      phase: PHASE.INITIAL_ROLL,
      dice: null,
    },
    legHistory: [],
    initialRoll: { a: null, b: null, throwParamsA: null, throwParamsB: null },
  };
}
```

(Note: `rng` is unused here but kept in the signature to match the host contract; physics randomness comes from the client.)

The 4-field `initialRoll` shape matches spec §4.2 directly. `a`/`b` hold the rolled value (number) once that side has rolled; `throwParamsA`/`throwParamsB` hold that side's throw params for opponent replay.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/backgammon-state.test.js`
Expected: 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/backgammon/server/state.js test/backgammon-state.test.js test/_helpers/backgammon-fixtures.js
git commit -m "feat(backgammon): buildInitialState with configurable matchLength"
```

---

## Task 4: Board mutators — `applyMove`, `enterFromBar`, `bearOff`, `hitCheck`

**Files:**
- Modify: `plugins/backgammon/server/board.js`
- Test: `test/backgammon-board.test.js` (extend)

These are pure board-level mutators. They do NOT enforce rules — that's `validate.js`'s job. They just mutate. Each takes a board and returns a new board (immutable update, no rule checks).

- [ ] **Step 1: Append failing tests to `test/backgammon-board.test.js`**

Add at the end of the file:

```js
import { applyMove, enterFromBar, bearOff, isPointBlocked } from '../plugins/backgammon/server/board.js';

function emptyBoard() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  return { points, barA: 0, barB: 0, bornOffA: 0, bornOffB: 0 };
}

test('applyMove: A point-to-point onto empty point', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  const next = applyMove(b, 'a', 0, 5);
  assert.deepEqual(next.points[0], { color: 'a', count: 1 });
  assert.deepEqual(next.points[5], { color: 'a', count: 1 });
});

test('applyMove: A onto own stack increments count', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  b.points[5] = { color: 'a', count: 3 };
  const next = applyMove(b, 'a', 0, 5);
  assert.deepEqual(next.points[5], { color: 'a', count: 4 });
});

test('applyMove: emptying a point sets color back to null', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  const next = applyMove(b, 'a', 0, 5);
  assert.deepEqual(next.points[0], { color: null, count: 0 });
});

test('applyMove: A hits a B blot — B checker goes to barB', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  b.points[5] = { color: 'b', count: 1 };
  const next = applyMove(b, 'a', 0, 5);
  assert.deepEqual(next.points[5], { color: 'a', count: 1 });
  assert.equal(next.barB, 1);
});

test('enterFromBar: A enters with die=3 onto index 2', () => {
  const b = emptyBoard();
  b.barA = 2;
  const next = enterFromBar(b, 'a', 2);
  assert.equal(next.barA, 1);
  assert.deepEqual(next.points[2], { color: 'a', count: 1 });
});

test('enterFromBar: A entering on B blot hits it', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 1 };
  const next = enterFromBar(b, 'a', 2);
  assert.equal(next.barA, 0);
  assert.equal(next.barB, 1);
  assert.deepEqual(next.points[2], { color: 'a', count: 1 });
});

test('enterFromBar: B enters with die=4 onto index 20 (24-4)', () => {
  const b = emptyBoard();
  b.barB = 1;
  const next = enterFromBar(b, 'b', 20);
  assert.equal(next.barB, 0);
  assert.deepEqual(next.points[20], { color: 'b', count: 1 });
});

test('bearOff: A bears off from index 21, increments bornOffA', () => {
  const b = emptyBoard();
  b.points[21] = { color: 'a', count: 2 };
  const next = bearOff(b, 'a', 21);
  assert.equal(next.bornOffA, 1);
  assert.deepEqual(next.points[21], { color: 'a', count: 1 });
});

test('bearOff: B bears off from index 0, increments bornOffB', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'b', count: 1 };
  const next = bearOff(b, 'b', 0);
  assert.equal(next.bornOffB, 1);
  assert.deepEqual(next.points[0], { color: null, count: 0 });
});

test('isPointBlocked: 2+ opponent checkers blocks', () => {
  const b = emptyBoard();
  b.points[5] = { color: 'b', count: 2 };
  assert.equal(isPointBlocked(b, 'a', 5), true);
});

test('isPointBlocked: own checkers do not block', () => {
  const b = emptyBoard();
  b.points[5] = { color: 'a', count: 5 };
  assert.equal(isPointBlocked(b, 'a', 5), false);
});

test('isPointBlocked: single blot does not block', () => {
  const b = emptyBoard();
  b.points[5] = { color: 'b', count: 1 };
  assert.equal(isPointBlocked(b, 'a', 5), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/backgammon-board.test.js`
Expected: FAIL — `applyMove`, `enterFromBar`, `bearOff`, `isPointBlocked` are not exported.

- [ ] **Step 3: Implement mutators in `plugins/backgammon/server/board.js`**

Append to the existing `board.js`:

```js
import { opponent } from './constants.js';

function clonePoints(points) {
  return points.map(p => ({ ...p }));
}

function place(points, idx, color) {
  const cell = points[idx];
  if (cell.color === null || cell.color === color) {
    points[idx] = { color, count: cell.count + 1 };
  } else {
    // Caller is responsible for hitCheck before calling place; this branch
    // is only reachable in tests that bypass validation.
    points[idx] = { color, count: 1 };
  }
}

function lift(points, idx) {
  const cell = points[idx];
  const count = cell.count - 1;
  points[idx] = count === 0 ? { color: null, count: 0 } : { color: cell.color, count };
}

function pushToBar(board, color) {
  return color === 'a'
    ? { ...board, barA: board.barA + 1 }
    : { ...board, barB: board.barB + 1 };
}

export function isPointBlocked(board, mover, idx) {
  const cell = board.points[idx];
  return cell.color === opponent(mover) && cell.count >= 2;
}

// Mutator: move one checker `mover` from `from` to `to` (point-to-point only).
// If destination has an opponent blot, hits it (opponent goes to bar).
// Caller must ensure move is otherwise legal.
export function applyMove(board, mover, from, to) {
  const points = clonePoints(board.points);
  let next = { ...board, points };
  // Hit before placing.
  const dest = points[to];
  if (dest.color === opponent(mover) && dest.count === 1) {
    points[to] = { color: null, count: 0 };
    next = pushToBar(next, opponent(mover));
  }
  lift(points, from);
  place(points, to, mover);
  return next;
}

export function enterFromBar(board, mover, to) {
  const points = clonePoints(board.points);
  let next = { ...board, points };
  if (mover === 'a') next.barA = next.barA - 1;
  else next.barB = next.barB - 1;
  const dest = points[to];
  if (dest.color === opponent(mover) && dest.count === 1) {
    points[to] = { color: null, count: 0 };
    next = pushToBar(next, opponent(mover));
  }
  place(points, to, mover);
  return next;
}

export function bearOff(board, mover, from) {
  const points = clonePoints(board.points);
  lift(points, from);
  const next = { ...board, points };
  if (mover === 'a') next.bornOffA = next.bornOffA + 1;
  else next.bornOffB = next.bornOffB + 1;
  return next;
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test test/backgammon-board.test.js`
Expected: all 18 board tests pass (6 from Task 2 + 12 new).

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/board.js test/backgammon-board.test.js
git commit -m "feat(backgammon): board mutators (move, enter, bear-off, hit detection)"
```

---

## Task 5: Validate — bar-entry rules

**Files:**
- Create: `plugins/backgammon/server/validate.js`
- Test: `test/backgammon-validate.test.js` (part 1)

`validate.js` exposes two main functions: `enumerateLegalMoves(board, dice, player)` and `isLegalMove(board, dice, player, from, to)`. We build them up in slices, starting with bar entry — the highest-precedence rule.

Move-and-die encoding (used throughout `validate.js` and `actions.js`):

- Point-to-point for A: die used = `to - from`. Both must be 0..23.
- Point-to-point for B: die used = `from - to`.
- Bar entry for A: `from = 'bar'`, die used = `to + 1` (so `to` ∈ 0..5).
- Bar entry for B: `from = 'bar'`, die used = `24 - to` (so `to` ∈ 18..23).
- Bear-off for A: `to = 'off'`, die used = `24 - from` (or any larger die under higher-die rule).
- Bear-off for B: `to = 'off'`, die used = `from + 1` (or any larger die).

A "move" is the object `{ from, to }`. `enumerateLegalMoves` returns an array of `{ from, to, die }` for every move that uses exactly one of the remaining dice.

- [ ] **Step 1: Write the failing tests**

Create `test/backgammon-validate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateLegalMoves, isLegalMove } from '../plugins/backgammon/server/validate.js';

function emptyBoard() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  return { points, barA: 0, barB: 0, bornOffA: 0, bornOffB: 0 };
}

test('A on bar: only bar-entry moves are legal', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[0] = { color: 'a', count: 2 };  // checker also on 24-point — irrelevant while barred
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  // Only entries onto indices 2 (die=3) and 4 (die=5)
  const entries = moves.filter(m => m.from === 'bar');
  assert.equal(entries.length, 2);
  assert.ok(entries.some(m => m.to === 2 && m.die === 3));
  assert.ok(entries.some(m => m.to === 4 && m.die === 5));
  // No point-to-point moves
  assert.equal(moves.length, 2);
});

test('A on bar: blocked entry points reject', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 2 };  // blocks die=3 entry
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  // Only die=5 entry (onto index 4) is legal.
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0], { from: 'bar', to: 4, die: 5 });
});

test('B on bar: enters into A home, die=4 onto index 20', () => {
  const b = emptyBoard();
  b.barB = 1;
  const moves = enumerateLegalMoves(b, [4, 6], 'b');
  // die=4 → 20, die=6 → 18
  assert.ok(moves.some(m => m.from === 'bar' && m.to === 20 && m.die === 4));
  assert.ok(moves.some(m => m.from === 'bar' && m.to === 18 && m.die === 6));
  assert.equal(moves.length, 2);
});

test('A on bar with NO legal entry: returns empty list', () => {
  const b = emptyBoard();
  b.barA = 1;
  for (let i = 0; i < 6; i++) b.points[i] = { color: 'b', count: 2 };
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  assert.deepEqual(moves, []);
});

test('isLegalMove: A bar entry onto blot is legal', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 1 };  // blot
  assert.equal(isLegalMove(b, [3], 'a', 'bar', 2), true);
});

test('isLegalMove: A bar entry onto blocked point is illegal', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 2 };
  assert.equal(isLegalMove(b, [3], 'a', 'bar', 2), false);
});

test('isLegalMove: A point-to-point illegal while on bar', () => {
  const b = emptyBoard();
  b.barA = 1;
  b.points[10] = { color: 'a', count: 2 };
  assert.equal(isLegalMove(b, [3], 'a', 10, 13), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/backgammon-validate.test.js`
Expected: FAIL — `Cannot find module .../plugins/backgammon/server/validate.js`.

- [ ] **Step 3: Implement bar-entry-only validate**

Create `plugins/backgammon/server/validate.js`:

```js
import { isPointBlocked } from './board.js';
import { HOME_INDICES, BOARD_SIZE } from './constants.js';

function isOnBar(board, player) {
  return player === 'a' ? board.barA > 0 : board.barB > 0;
}

function entryIndex(player, die) {
  return player === 'a' ? die - 1 : BOARD_SIZE - die;
}

function uniqueDice(dice) {
  return Array.from(new Set(dice));
}

function barEntries(board, dice, player) {
  const out = [];
  for (const die of uniqueDice(dice)) {
    const to = entryIndex(player, die);
    if (!isPointBlocked(board, player, to)) {
      out.push({ from: 'bar', to, die });
    }
  }
  return out;
}

export function enumerateLegalMoves(board, dice, player) {
  if (!Array.isArray(dice) || dice.length === 0) return [];
  if (isOnBar(board, player)) return barEntries(board, dice, player);
  // Point-to-point and bear-off come in later tasks.
  return [];
}

export function isLegalMove(board, dice, player, from, to) {
  return enumerateLegalMoves(board, dice, player).some(m => m.from === from && m.to === to);
}

// Internal helpers exported for later tasks (and tests that want them).
export const _internals = { isOnBar, entryIndex, HOME_INDICES };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/backgammon-validate.test.js`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/validate.js test/backgammon-validate.test.js
git commit -m "feat(backgammon): validate bar-entry rules"
```

---

## Task 6: Validate — point-to-point moves

**Files:**
- Modify: `plugins/backgammon/server/validate.js`
- Test: `test/backgammon-validate.test.js` (extend)

This adds normal point-to-point moves: A moves +die, B moves -die, must land on empty / own / opponent-blot point. The "must use both dice" and bear-off rules come in later tasks.

- [ ] **Step 1: Append failing tests**

Add to the end of `test/backgammon-validate.test.js`:

```js
test('A point-to-point: legal onto empty point', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  const moves = enumerateLegalMoves(b, [3, 5], 'a');
  assert.ok(moves.some(m => m.from === 0 && m.to === 3 && m.die === 3));
  assert.ok(moves.some(m => m.from === 0 && m.to === 5 && m.die === 5));
});

test('A point-to-point: legal onto own stack', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  b.points[3] = { color: 'a', count: 4 };
  const moves = enumerateLegalMoves(b, [3], 'a');
  assert.ok(moves.some(m => m.from === 0 && m.to === 3 && m.die === 3));
});

test('A point-to-point: legal onto opponent blot', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  b.points[3] = { color: 'b', count: 1 };
  const moves = enumerateLegalMoves(b, [3], 'a');
  assert.ok(moves.some(m => m.from === 0 && m.to === 3 && m.die === 3));
});

test('A point-to-point: blocked by 2+ opponents', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  b.points[3] = { color: 'b', count: 2 };
  const moves = enumerateLegalMoves(b, [3], 'a');
  assert.equal(moves.length, 0);
});

test('B point-to-point: moves toward lower indices', () => {
  const b = emptyBoard();
  b.points[23] = { color: 'b', count: 2 };
  const moves = enumerateLegalMoves(b, [3, 5], 'b');
  assert.ok(moves.some(m => m.from === 23 && m.to === 20 && m.die === 3));
  assert.ok(moves.some(m => m.from === 23 && m.to === 18 && m.die === 5));
});

test('point-to-point: cannot move from a point you do not own', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'b', count: 1 };  // B blot
  const moves = enumerateLegalMoves(b, [3], 'a');
  assert.equal(moves.length, 0);
});

test('point-to-point: cannot move past board edge before bearing off', () => {
  const b = emptyBoard();
  // A has only 1 checker, on index 22. die=5 → 27 OOB (point-to-point skipped).
  // A is not all-in-home (total checkers != 15), so bear-off remains illegal
  // when Task 8 adds it — this test stays valid through later tasks.
  b.points[22] = { color: 'a', count: 1 };
  const moves = enumerateLegalMoves(b, [5], 'a');
  assert.equal(moves.length, 0);
});

test('point-to-point: enumerateLegalMoves dedupes by from/to/die triple', () => {
  // Same die value present twice in remaining (non-doubles edge): two checkers
  // on same point should still produce a single (from,to,die) entry.
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  const moves = enumerateLegalMoves(b, [3, 3], 'a');  // doubles' remaining
  const fromZeroDieThree = moves.filter(m => m.from === 0 && m.to === 3 && m.die === 3);
  assert.equal(fromZeroDieThree.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/backgammon-validate.test.js`
Expected: at least 7 of the new tests fail (the existing 7 pass).

- [ ] **Step 3: Extend `validate.js` with point-to-point**

In `plugins/backgammon/server/validate.js`, replace `enumerateLegalMoves` with:

```js
function destination(player, from, die) {
  return player === 'a' ? from + die : from - die;
}

function pointToPointMoves(board, dice, player) {
  const out = [];
  const seen = new Set();
  for (const die of uniqueDice(dice)) {
    for (let from = 0; from < BOARD_SIZE; from++) {
      const cell = board.points[from];
      if (cell.color !== player || cell.count === 0) continue;
      const to = destination(player, from, die);
      if (to < 0 || to >= BOARD_SIZE) continue;  // bear-off handled later
      if (isPointBlocked(board, player, to)) continue;
      const key = `${from}->${to}@${die}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from, to, die });
    }
  }
  return out;
}

export function enumerateLegalMoves(board, dice, player) {
  if (!Array.isArray(dice) || dice.length === 0) return [];
  if (isOnBar(board, player)) return barEntries(board, dice, player);
  return pointToPointMoves(board, dice, player);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/backgammon-validate.test.js`
Expected: 15 tests pass (7 + 8).

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/validate.js test/backgammon-validate.test.js
git commit -m "feat(backgammon): validate point-to-point moves with blocking"
```

---

## Task 7: Validate — must-use-both & higher-die rule

**Files:**
- Modify: `plugins/backgammon/server/validate.js`
- Test: `test/backgammon-validate.test.js` (extend)

Per spec §4.4: "Both dice must be used if any combination of legal moves exists that uses both. If only one die can be used, the higher die is mandatory if both are individually playable."

This is a *sequence-level* rule, not a per-move rule. The standard formulation:

1. Enumerate all sequences of moves that use the dice in some order.
2. The maximum number of dice consumable is `K`.
3. Only sequences of length `K` are legal.
4. If `K = 1` (only one die playable) AND both dice are individually playable from the start board, the *higher* die's move is mandatory.

For our purposes: we expose a helper `legalFirstMoves(board, remainingDice, player)` that returns the moves a player may legally make as the *first* play of the turn, after applying the must-use-both / higher-die filter. `enumerateLegalMoves` is unchanged — it's the raw enumeration, used by `isLegalMove`. The must-use-both filtering lives in a new exported function.

- [ ] **Step 1: Append failing tests**

Add to `test/backgammon-validate.test.js`:

```js
import { legalFirstMoves, maxConsumableDice } from '../plugins/backgammon/server/validate.js';

test('legalFirstMoves: when both dice usable, raw enumeration returned', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  const all = enumerateLegalMoves(b, [3, 5], 'a');
  const first = legalFirstMoves(b, [3, 5], 'a');
  // First move can use either die; both should remain in the candidate set.
  assert.ok(first.some(m => m.die === 3));
  assert.ok(first.some(m => m.die === 5));
  // No move dropped vs raw enumeration.
  assert.equal(first.length, all.length);
});

test('legalFirstMoves: when only one die usable, only that die survives', () => {
  // A is on bar; only die=5 enters legally (die=3 blocked).
  const b = emptyBoard();
  b.barA = 1;
  b.points[2] = { color: 'b', count: 2 };  // blocks die=3 entry
  // After entry on die=5, A still on bar? No — bar count 1, entry empties bar.
  // But other dice can't be used point-to-point if there are no A checkers
  // anywhere (we only set barA=1).
  const first = legalFirstMoves(b, [3, 5], 'a');
  assert.equal(first.length, 1);
  assert.equal(first[0].die, 5);
});

test('legalFirstMoves: higher-die rule when only one die playable from start', () => {
  // Construct: A has one checker on index 0. Roll [3, 5].
  // - die=3 → index 3 (legal, empty)
  // - die=5 → index 5 (legal, empty)
  // - But after moving die=3 first to index 3, die=5 from index 3 → index 8 (legal).
  // - And after moving die=5 first to index 5, die=3 from index 5 → index 8 (legal).
  // So both dice usable in sequence — both individual moves remain legal.
  // To force higher-die rule, block the second-step dest:
  // A on index 0 (count 1). Block index 8 (b count 2). Block second-step destinations.
  // Easier: A on index 19. Roll [3, 5]. die=3 → index 22 (legal). die=5 → index 24 (off, but home check fails).
  // Skip bear-off; use pure higher-die scenario:
  // A on index 0, only one A checker; B blocks indices 3, 8 with 2 stacks each;
  // index 5 empty (legal). die=3 blocked, die=5 legal — can only use one.
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  b.points[3] = { color: 'b', count: 2 };
  b.points[8] = { color: 'b', count: 2 };
  // Verify our scenario in the absence of the rule:
  // raw enumeration: only {0→5, die=5}.
  const raw = enumerateLegalMoves(b, [3, 5], 'a');
  assert.deepEqual(raw, [{ from: 0, to: 5, die: 5 }]);
  // Higher-die rule: same — only die=5 was usable to begin with.
  const first = legalFirstMoves(b, [3, 5], 'a');
  assert.deepEqual(first, [{ from: 0, to: 5, die: 5 }]);
});

test('legalFirstMoves: both individually playable but not both in sequence — higher-die wins', () => {
  // A on index 18 (count 1). B blocks index 21 (the only die=3 dest from 18). B blocks index 23 (die=5 dest).
  // Wait — both dests blocked = no moves at all.
  // Try: A on index 0 (count 1). B blocks index 8 (the die=3+5 combined dest).
  // - die=3: 0→3 legal. die=5 from 3 → 8 BLOCKED. So can't sequence 3-then-5.
  // - die=5: 0→5 legal. die=3 from 5 → 8 BLOCKED. So can't sequence 5-then-3.
  // - Either single move alone is legal; neither sequence is.
  // K = 1 (only one die consumable). Both dice individually playable → higher-die mandatory.
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  b.points[8] = { color: 'b', count: 2 };
  const first = legalFirstMoves(b, [3, 5], 'a');
  // Only the die=5 move survives.
  assert.equal(first.length, 1);
  assert.equal(first[0].die, 5);
  assert.equal(first[0].from, 0);
  assert.equal(first[0].to, 5);
});

test('maxConsumableDice: 2 when sequence exists', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 2 };
  assert.equal(maxConsumableDice(b, [3, 5], 'a'), 2);
});

test('maxConsumableDice: 1 when only one die usable', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  b.points[8] = { color: 'b', count: 2 };
  assert.equal(maxConsumableDice(b, [3, 5], 'a'), 1);
});

test('maxConsumableDice: 0 when no moves at all', () => {
  const b = emptyBoard();
  b.barA = 1;
  for (let i = 0; i < 6; i++) b.points[i] = { color: 'b', count: 2 };
  assert.equal(maxConsumableDice(b, [3, 5], 'a'), 0);
});

test('maxConsumableDice: doubles count of 4 when fully playable', () => {
  // A has 4 checkers on index 0; doubles [3,3,3,3]; each onto index 3 then 6 then 9 etc.
  // Simpler: 4 separate A checkers — one on 0, 3, 6, 9 — each can step +3.
  const b = emptyBoard();
  b.points[0]  = { color: 'a', count: 1 };
  b.points[3]  = { color: 'a', count: 0 };  // overwritten by move
  // Build 4 disjoint chains: 0→3, 3→6 (after first), 6→9, 9→12.
  // Easier: 4 checkers stacked on 0, all step +3 onto a long empty lane.
  b.points[0] = { color: 'a', count: 4 };
  assert.equal(maxConsumableDice(b, [3, 3, 3, 3], 'a'), 4);
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `node --test test/backgammon-validate.test.js`
Expected: new tests fail (`legalFirstMoves` / `maxConsumableDice` not exported).

- [ ] **Step 3: Implement must-use-both & higher-die in `validate.js`**

Add to `plugins/backgammon/server/validate.js`. The `import` line goes at the top of the file, alongside the existing `import { isPointBlocked } from './board.js'` line — replace that single-import line with this combined one. The functions go above `enumerateLegalMoves`.

```js
import { isPointBlocked, applyMove, enterFromBar } from './board.js';

// Returns the maximum number of dice consumable in any sequence from this board state.
// Used to enforce must-use-both. Brute-force DFS bounded by dice length (≤ 4).
export function maxConsumableDice(board, dice, player) {
  if (dice.length === 0) return 0;
  let best = 0;
  function dfs(b, remaining) {
    const moves = enumerateLegalMoves(b, remaining, player);
    if (moves.length === 0) return;
    for (const m of moves) {
      const nextBoard = applyMoveOrEnter(b, player, m);
      const nextDice = removeOne(remaining, m.die);
      const consumed = (dice.length - nextDice.length);
      if (consumed > best) best = consumed;
      if (best === dice.length) return;  // can't do better
      dfs(nextBoard, nextDice);
    }
  }
  dfs(board, dice);
  return best;
}

function applyMoveOrEnter(board, player, m) {
  if (m.from === 'bar') return enterFromBar(board, player, m.to);
  if (m.to === 'off')   return board; // bear-off slot used in later task; stub here
  return applyMove(board, player, m.from, m.to);
}

function removeOne(arr, value) {
  const idx = arr.indexOf(value);
  if (idx < 0) return arr.slice();
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
}

// Filter the raw legal-move list by must-use-both / higher-die rules.
// Returns moves that are legal as the FIRST move of the turn under those rules.
export function legalFirstMoves(board, dice, player) {
  const raw = enumerateLegalMoves(board, dice, player);
  if (raw.length === 0) return [];
  const max = maxConsumableDice(board, dice, player);
  if (max === 0) return [];
  if (max === dice.length) return raw;  // unrestricted: every raw move is fine

  // We can consume `max` dice but not all. A first move is legal iff some
  // continuation from it consumes `max` total dice (counting itself as 1).
  const out = [];
  for (const m of raw) {
    const nextBoard = applyMoveOrEnter(board, player, m);
    const nextDice = removeOne(dice, m.die);
    const fromHere = 1 + maxConsumableDice(nextBoard, nextDice, player);
    if (fromHere >= max) out.push(m);
  }

  // Higher-die rule: if max === 1 AND both dice individually playable, only the
  // higher die's move survives. (Doubles never trigger this — all dice equal.)
  if (max === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const dieValues = new Set(out.map(m => m.die));
    if (dieValues.size === 2) {
      const higher = Math.max(...dieValues);
      return out.filter(m => m.die === higher);
    }
  }
  return out;
}
```

NOTE: `applyMoveOrEnter`'s `to === 'off'` branch is a stub — bear-off completes in Task 8 and that branch is updated then. The current Task-7 tests do not exercise bear-off.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/backgammon-validate.test.js`
Expected: 23 tests pass (15 + 8).

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/validate.js test/backgammon-validate.test.js
git commit -m "feat(backgammon): must-use-both and higher-die rules"
```

---

## Task 8: Validate — bear-off (exact + higher-die)

**Files:**
- Modify: `plugins/backgammon/server/validate.js`
- Test: `test/backgammon-validate.test.js` (extend)

Bear-off rules (spec §4.4):
1. Player must have all 15 checkers in their home board (counting bornOff already off).
2. Exact pip preferred: A on `from` with die `D` such that `from + D === 24` bears off.
3. Higher-die: if no checkers occupy a *higher-pip* point than `from`, a die larger than `24 - from` (for A) may bear off the highest-occupied point.

For B, mirror: home is indices 0..5; bear off when `from - D < 0`; "higher-pip" for B means *lower* index.

- [ ] **Step 1: Append failing tests**

Add to `test/backgammon-validate.test.js`:

```js
test('bear-off rejected when not all-in-home', () => {
  const b = emptyBoard();
  b.points[18] = { color: 'a', count: 14 };
  b.points[12] = { color: 'a', count: 1 };  // outside home
  const moves = enumerateLegalMoves(b, [6], 'a');
  // No bear-off candidates.
  assert.equal(moves.filter(m => m.to === 'off').length, 0);
});

test('A bear-off: exact pip from A 6-point with die=6', () => {
  const b = emptyBoard();
  // All 15 in home: 5 each on 18, 19, 20.
  b.points[18] = { color: 'a', count: 5 };
  b.points[19] = { color: 'a', count: 5 };
  b.points[20] = { color: 'a', count: 5 };
  const moves = enumerateLegalMoves(b, [6], 'a');
  // die=6 from index 18 → 18+6 = 24 = exact bear-off
  assert.ok(moves.some(m => m.from === 18 && m.to === 'off' && m.die === 6));
});

test('A bear-off: higher-die rule with die=6 when highest point is 22', () => {
  const b = emptyBoard();
  b.points[22] = { color: 'a', count: 1 };
  b.bornOffA = 14;
  const moves = enumerateLegalMoves(b, [6], 'a');
  // die=6 > 24-22=2; index 22 is highest-occupied; bear-off legal.
  assert.ok(moves.some(m => m.from === 22 && m.to === 'off' && m.die === 6));
});

test('A bear-off: higher die may NOT bear off if a higher point is occupied', () => {
  const b = emptyBoard();
  b.points[18] = { color: 'a', count: 1 };  // higher pip — must move it first
  b.points[22] = { color: 'a', count: 1 };
  b.bornOffA = 13;
  const moves = enumerateLegalMoves(b, [6], 'a');
  // die=6 from 18 → 24 exact bear-off (legal).
  // die=6 from 22 → would be higher-die bear-off, but 18 is occupied and is higher-pip → NOT legal.
  assert.ok(moves.some(m => m.from === 18 && m.to === 'off' && m.die === 6));
  assert.equal(moves.filter(m => m.from === 22 && m.to === 'off').length, 0);
});

test('A bear-off: lower die may move within home', () => {
  const b = emptyBoard();
  b.points[18] = { color: 'a', count: 1 };
  b.points[22] = { color: 'a', count: 1 };
  b.bornOffA = 13;
  const moves = enumerateLegalMoves(b, [3], 'a');
  // die=3 from 18 → 21 in-home (legal). die=3 from 22 → 25 overshoots, but
  // 18 is occupied and higher-pip, so higher-die bear-off illegal. Only the
  // 18→21 in-home move is allowed.
  assert.ok(moves.some(m => m.from === 18 && m.to === 21 && m.die === 3));
  assert.equal(moves.filter(m => m.to === 'off').length, 0);
});

test('B bear-off: exact pip from B 6-point with die=6', () => {
  const b = emptyBoard();
  b.points[5] = { color: 'b', count: 5 };
  b.points[4] = { color: 'b', count: 5 };
  b.points[3] = { color: 'b', count: 5 };
  const moves = enumerateLegalMoves(b, [6], 'b');
  // die=6 from index 5 → 5-6 = -1 = exact bear-off
  assert.ok(moves.some(m => m.from === 5 && m.to === 'off' && m.die === 6));
});

test('B bear-off: higher-die rule with die=6 when highest is index 1', () => {
  const b = emptyBoard();
  b.points[1] = { color: 'b', count: 1 };
  b.bornOffB = 14;
  const moves = enumerateLegalMoves(b, [6], 'b');
  assert.ok(moves.some(m => m.from === 1 && m.to === 'off' && m.die === 6));
});

test('all-in-home check counts barA against A', () => {
  const b = emptyBoard();
  b.points[18] = { color: 'a', count: 14 };
  b.barA = 1;  // not in home — can't bear off
  const moves = enumerateLegalMoves(b, [6], 'a');
  assert.equal(moves.filter(m => m.to === 'off').length, 0);
});

test('all-in-home counts bornOff toward 15', () => {
  const b = emptyBoard();
  b.points[18] = { color: 'a', count: 1 };
  b.bornOffA = 14;
  // 14 off + 1 on point 18 = 15 accounted for, all in home — bear-off allowed.
  const moves = enumerateLegalMoves(b, [6], 'a');
  assert.ok(moves.some(m => m.to === 'off'));
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `node --test test/backgammon-validate.test.js`
Expected: bear-off tests fail (current `enumerateLegalMoves` filters out off-board destinations).

- [ ] **Step 3: Extend `validate.js` with bear-off**

In `plugins/backgammon/server/validate.js`:

1. Add helpers near the top (under existing helpers):

```js
function checkerCount(board, player) {
  let n = 0;
  for (const p of board.points) if (p.color === player) n += p.count;
  return n + (player === 'a' ? board.barA + board.bornOffA : board.barB + board.bornOffB);
}

function isAllInHome(board, player) {
  if ((player === 'a' ? board.barA : board.barB) > 0) return false;
  const home = HOME_INDICES[player];
  const homeSet = new Set(home);
  // Every point with a player checker outside home → not all-in-home.
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (homeSet.has(i)) continue;
    const cell = board.points[i];
    if (cell.color === player && cell.count > 0) return false;
  }
  // Sanity: total accounted for equals 15.
  const total = checkerCount(board, player);
  if (total !== 15) return false;
  return true;
}

function highestPipIndex(board, player) {
  // For A, "highest pip" = lowest index in home that A occupies.
  // For B, "highest pip" = highest index in home that B occupies.
  if (player === 'a') {
    for (let i = 18; i <= 23; i++) {
      if (board.points[i].color === 'a' && board.points[i].count > 0) return i;
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      if (board.points[i].color === 'b' && board.points[i].count > 0) return i;
    }
  }
  return -1;
}

function bearOffMoves(board, dice, player) {
  if (!isAllInHome(board, player)) return [];
  const out = [];
  const seen = new Set();
  const highest = highestPipIndex(board, player);
  for (const die of uniqueDice(dice)) {
    if (player === 'a') {
      for (let from = 18; from < BOARD_SIZE; from++) {
        const cell = board.points[from];
        if (cell.color !== 'a' || cell.count === 0) continue;
        const exact = (24 - from) === die;
        const higherDie = die > (24 - from) && from === highest;
        if (!exact && !higherDie) continue;
        const key = `${from}->off@${die}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from, to: 'off', die });
      }
    } else {
      for (let from = 0; from <= 5; from++) {
        const cell = board.points[from];
        if (cell.color !== 'b' || cell.count === 0) continue;
        const exact = (from + 1) === die;
        const higherDie = die > (from + 1) && from === highest;
        if (!exact && !higherDie) continue;
        const key = `${from}->off@${die}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ from, to: 'off', die });
      }
    }
  }
  return out;
}
```

2. Replace `enumerateLegalMoves` to combine point-to-point and bear-off:

```js
export function enumerateLegalMoves(board, dice, player) {
  if (!Array.isArray(dice) || dice.length === 0) return [];
  if (isOnBar(board, player)) return barEntries(board, dice, player);
  return [
    ...pointToPointMoves(board, dice, player),
    ...bearOffMoves(board, dice, player),
  ];
}
```

3. Update the import line at the top of `validate.js` to also include `bearOff`:

```js
import { isPointBlocked, applyMove, enterFromBar, bearOff } from './board.js';
```

4. Replace `applyMoveOrEnter` (used by `maxConsumableDice` / `legalFirstMoves`) to actually bear off:

```js
function applyMoveOrEnter(board, player, m) {
  if (m.from === 'bar') return enterFromBar(board, player, m.to);
  if (m.to === 'off')   return bearOff(board, player, m.from);
  return applyMove(board, player, m.from, m.to);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/backgammon-validate.test.js`
Expected: 32 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/validate.js test/backgammon-validate.test.js
git commit -m "feat(backgammon): bear-off rules (exact + higher-die)"
```

---

## Task 9: Validate — doubles (4-die remaining)

**Files:**
- Test: `test/backgammon-validate.test.js` (extend)

This task is a verification task — the existing `enumerateLegalMoves` and `legalFirstMoves` should already handle doubles correctly because they treat `dice` as the *remaining* array. We add tests to lock in the behavior.

- [ ] **Step 1: Append tests**

Add to `test/backgammon-validate.test.js`:

```js
test('doubles: all 4 dice consumable when board permits', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 4 };
  // Roll [3,3,3,3] — each checker steps +3 onto an empty point.
  assert.equal(maxConsumableDice(b, [3, 3, 3, 3], 'a'), 4);
});

test('doubles: 4 first-moves all on same die value', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 4 };
  const first = legalFirstMoves(b, [3, 3, 3, 3], 'a');
  // Raw enumeration dedupes (from,to,die) — there's only one such triple, repeated.
  // legalFirstMoves passes that single move through.
  assert.ok(first.some(m => m.from === 0 && m.to === 3 && m.die === 3));
});

test('doubles: only 2 dice consumable when 3rd dest blocked', () => {
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  // First step: 0→3. Second step: 3→6. Third step: 6→9 BLOCKED.
  b.points[9] = { color: 'b', count: 2 };
  assert.equal(maxConsumableDice(b, [3, 3, 3, 3], 'a'), 2);
});

test('doubles never trigger higher-die rule', () => {
  // Construct: A on index 0 (count 1). B blocks index 6.
  // dice [3,3,3,3]. Raw legal: 0→3 die=3.
  // Even after applying it, 3→6 blocked. So K=1.
  // Higher-die rule shouldn't fire because dice[0] === dice[1].
  const b = emptyBoard();
  b.points[0] = { color: 'a', count: 1 };
  b.points[6] = { color: 'b', count: 2 };
  const first = legalFirstMoves(b, [3, 3, 3, 3], 'a');
  // The single legal first-move should be present.
  assert.equal(first.length, 1);
  assert.equal(first[0].die, 3);
});
```

- [ ] **Step 2: Run — should pass without code changes**

Run: `node --test test/backgammon-validate.test.js`
Expected: 36 tests pass. If any fail, the most likely culprit is the `dice.length === 2 && dice[0] !== dice[1]` guard in the higher-die rule from Task 7 — re-check it.

- [ ] **Step 3: Commit**

```bash
git add test/backgammon-validate.test.js
git commit -m "test(backgammon): lock in doubles behavior in legal-move enumeration"
```

---

## Task 10: Cube state machine

**Files:**
- Create: `plugins/backgammon/server/cube.js`
- Test: `test/backgammon-cube.test.js`

The cube module is pure — it takes a `cube` substate and a `match` substate (for Crawford check) and returns updates. It does not know about the board.

API:
- `canOffer({cube, match}, offerer)` → boolean
- `applyOffer(cube, offerer)` → new cube
- `applyAccept(cube, acceptor)` → new cube
- `applyDecline(cube)` → `{ awardedToOfferer: number }` (the offerer's pre-double cube value)

- [ ] **Step 1: Write the failing test**

Create `test/backgammon-cube.test.js`:

```js
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
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/backgammon-cube.test.js`
Expected: module not found.

- [ ] **Step 3: Implement cube.js**

Create `plugins/backgammon/server/cube.js`:

```js
import { CUBE_CAP } from './constants.js';

export function canOffer({ cube, match }, offerer) {
  if (cube.pendingOffer) return false;
  if (cube.value >= CUBE_CAP) return false;
  if (match.crawford) return false;
  if (cube.owner !== null && cube.owner !== offerer) return false;
  return true;
}

export function applyOffer(cube, offerer) {
  return { ...cube, pendingOffer: { from: offerer } };
}

export function applyAccept(cube, acceptor) {
  return {
    value: cube.value * 2,
    owner: acceptor,
    pendingOffer: null,
  };
}

export function applyDecline(cube) {
  return {
    awardedToOfferer: cube.value,
    offerer: cube.pendingOffer.from,
  };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `node --test test/backgammon-cube.test.js`
Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/cube.js test/backgammon-cube.test.js
git commit -m "feat(backgammon): cube state machine"
```

---

## Task 11: Match — leg-end classification

**Files:**
- Create: `plugins/backgammon/server/match.js` (part 1)
- Test: `test/backgammon-match.test.js` (part 1)

`classifyLegEnd(board, winner)` returns `{ type, multiplier }` where `type ∈ 'single' | 'gammon' | 'backgammon'` and `multiplier ∈ 1 | 2 | 3`. Triggered when a player has borne off 15 checkers.

- [ ] **Step 1: Write the failing test**

Create `test/backgammon-match.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLegEnd } from '../plugins/backgammon/server/match.js';

function emptyBoard() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  return { points, barA: 0, barB: 0, bornOffA: 0, bornOffB: 0 };
}

test('classifyLegEnd: single — opponent has borne off ≥ 1', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.bornOffB = 5;
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'single', multiplier: 1 });
});

test('classifyLegEnd: gammon — opponent has 0 borne off, none in winners home/bar', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.points[10] = { color: 'b', count: 15 };  // outside A's home, not on bar
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'gammon', multiplier: 2 });
});

test('classifyLegEnd: backgammon — opponent has 0 borne off + checker in winners home', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.points[20] = { color: 'b', count: 1 };  // in A's home (indices 18..23)
  b.points[10] = { color: 'b', count: 14 };
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'backgammon', multiplier: 3 });
});

test('classifyLegEnd: backgammon — opponent on bar', () => {
  const b = emptyBoard();
  b.bornOffA = 15;
  b.barB = 1;
  b.points[10] = { color: 'b', count: 14 };
  assert.deepEqual(classifyLegEnd(b, 'a'), { type: 'backgammon', multiplier: 3 });
});

test('classifyLegEnd: B winner mirrored', () => {
  const b = emptyBoard();
  b.bornOffB = 15;
  b.points[3] = { color: 'a', count: 1 };  // in B home (indices 0..5)
  b.points[10] = { color: 'a', count: 14 };
  assert.deepEqual(classifyLegEnd(b, 'b'), { type: 'backgammon', multiplier: 3 });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/backgammon-match.test.js`
Expected: module not found.

- [ ] **Step 3: Implement classifier**

Create `plugins/backgammon/server/match.js`:

```js
import { HOME_INDICES, opponent } from './constants.js';

export function classifyLegEnd(board, winner) {
  const loser = opponent(winner);
  const loserBornOff = loser === 'a' ? board.bornOffA : board.bornOffB;
  if (loserBornOff > 0) return { type: 'single', multiplier: 1 };

  // Gammon vs Backgammon: backgammon if loser has any checker in winners home or on bar.
  const loserBar = loser === 'a' ? board.barA : board.barB;
  const winnerHome = HOME_INDICES[winner];
  const inWinnerHome = winnerHome.some(idx =>
    board.points[idx].color === loser && board.points[idx].count > 0
  );
  if (loserBar > 0 || inWinnerHome) return { type: 'backgammon', multiplier: 3 };
  return { type: 'gammon', multiplier: 2 };
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `node --test test/backgammon-match.test.js`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/match.js test/backgammon-match.test.js
git commit -m "feat(backgammon): classify leg end (single/gammon/backgammon)"
```

---

## Task 12: Match — leg reset + Crawford trigger

**Files:**
- Modify: `plugins/backgammon/server/match.js`
- Test: `test/backgammon-match.test.js` (extend)

`resolveLeg({state, winner, type, multiplier, cubeValue})` returns a new state with:
- A `legHistory` entry pushed
- `match.scoreA` or `match.scoreB` increased by `cubeValue * multiplier`
- Board / cube / turn / initialRoll all reset for the next leg
- `match.gameNumber` incremented
- `match.crawford` set if a player just hit `target - 1` (and `crawfordPlayed` was false and target > 1)
- `match.crawfordPlayed` set if the just-completed leg WAS the Crawford leg

This task does NOT yet check for match-end — that's Task 13. After this function, the state is always "next leg, ready to roll initial dice." Caller decides whether match has ended.

- [ ] **Step 1: Append failing tests**

Add to `test/backgammon-match.test.js`:

```js
import { resolveLeg } from '../plugins/backgammon/server/match.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { PARTICIPANTS, det } from './_helpers/backgammon-fixtures.js';

test('resolveLeg: pushes legHistory entry with cubeValue × multiplier', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const next = resolveLeg({ state: s0, winner: 'a', type: 'gammon', multiplier: 2, cubeValue: 2 });
  assert.equal(next.legHistory.length, 1);
  assert.deepEqual(next.legHistory[0], {
    gameNumber: 1, winner: 'a', points: 4, type: 'gammon', cube: 2,
  });
});

test('resolveLeg: increments scoreA by cubeValue × multiplier', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const next = resolveLeg({ state: s0, winner: 'a', type: 'gammon', multiplier: 2, cubeValue: 2 });
  assert.equal(next.match.scoreA, 4);
  assert.equal(next.match.scoreB, 0);
});

test('resolveLeg: increments gameNumber, resets cube/board/turn/initialRoll', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  // Tweak some state so we can confirm reset
  const dirty = {
    ...s0,
    cube: { value: 8, owner: 'a', pendingOffer: null },
    turn: { activePlayer: 'a', phase: 'moving', dice: { values: [3,4], remaining: [3], throwParams: [] } },
    initialRoll: { a: 5, b: 3 },
  };
  const next = resolveLeg({ state: dirty, winner: 'a', type: 'single', multiplier: 1, cubeValue: 8 });
  assert.equal(next.match.gameNumber, 2);
  assert.deepEqual(next.cube, { value: 1, owner: null, pendingOffer: null });
  assert.equal(next.turn.activePlayer, null);
  assert.equal(next.turn.phase, 'initial-roll');
  assert.equal(next.turn.dice, null);
  assert.deepEqual(next.initialRoll, { a: null, b: null, throwParamsA: null, throwParamsB: null });
  // Board reset to standard initial layout — quick sanity check: A at index 0 has 2 checkers
  assert.deepEqual(next.board.points[0], { color: 'a', count: 2 });
  assert.equal(next.board.barA, 0);
  assert.equal(next.board.bornOffA, 0);
});

test('resolveLeg: triggers Crawford when winner reaches target - 1', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  // s0.match.target = 3, scoreA starts at 0.
  // After this single (1pt cube) leg, scoreA = 2 = target - 1. Crawford should trigger.
  const next = resolveLeg({ state: s0, winner: 'a', type: 'gammon', multiplier: 2, cubeValue: 1 });
  assert.equal(next.match.scoreA, 2);
  assert.equal(next.match.crawford, true);
  assert.equal(next.match.crawfordPlayed, false);
});

test('resolveLeg: completing Crawford leg flips crawford → crawfordPlayed', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const dirty = { ...s0, match: { ...s0.match, scoreA: 2, crawford: true } };
  // Loser wins this Crawford leg — scoreB++. crawford → false; crawfordPlayed → true.
  const next = resolveLeg({ state: dirty, winner: 'b', type: 'single', multiplier: 1, cubeValue: 1 });
  assert.equal(next.match.crawford, false);
  assert.equal(next.match.crawfordPlayed, true);
});

test('resolveLeg: target=1 never triggers Crawford', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det(), options: { matchLength: 1 } });
  const next = resolveLeg({ state: s0, winner: 'a', type: 'single', multiplier: 1, cubeValue: 1 });
  assert.equal(next.match.crawford, false);
  assert.equal(next.match.crawfordPlayed, false);
});

test('resolveLeg: leg type "resigned" persists in legHistory', () => {
  const s0 = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const next = resolveLeg({ state: s0, winner: 'a', type: 'resigned', multiplier: 1, cubeValue: 4 });
  assert.equal(next.legHistory[0].type, 'resigned');
  assert.equal(next.legHistory[0].points, 4);
});
```

- [ ] **Step 2: Run — verify they fail**

Run: `node --test test/backgammon-match.test.js`
Expected: tests fail because `resolveLeg` is not exported.

- [ ] **Step 3: Implement `resolveLeg`**

Append to `plugins/backgammon/server/match.js`:

```js
import { initialPoints } from './board.js';
import { PHASE } from './constants.js';

function freshTurn() {
  return { activePlayer: null, phase: PHASE.INITIAL_ROLL, dice: null };
}

function freshBoard() {
  return {
    points: initialPoints(),
    barA: 0, barB: 0,
    bornOffA: 0, bornOffB: 0,
  };
}

function freshCube() {
  return { value: 1, owner: null, pendingOffer: null };
}

export function resolveLeg({ state, winner, type, multiplier, cubeValue }) {
  const points = cubeValue * multiplier;

  // Score
  const scoreA = state.match.scoreA + (winner === 'a' ? points : 0);
  const scoreB = state.match.scoreB + (winner === 'b' ? points : 0);

  // Crawford transition. The just-completed leg may BE the Crawford leg
  // (state.match.crawford === true) → crawfordPlayed flips true.
  // Or this leg may TRIGGER Crawford (a player hit target-1, Crawford not yet
  // played, target > 1).
  let crawford = false;
  let crawfordPlayed = state.match.crawfordPlayed;
  if (state.match.crawford) {
    crawford = false;
    crawfordPlayed = true;
  } else if (state.match.target > 1 && !crawfordPlayed) {
    if (scoreA === state.match.target - 1 || scoreB === state.match.target - 1) {
      crawford = true;
    }
  }

  // History entry
  const entry = {
    gameNumber: state.match.gameNumber,
    winner,
    points,
    type,
    cube: cubeValue,
  };

  return {
    ...state,
    match: {
      ...state.match,
      scoreA,
      scoreB,
      gameNumber: state.match.gameNumber + 1,
      crawford,
      crawfordPlayed,
    },
    cube: freshCube(),
    board: freshBoard(),
    turn: freshTurn(),
    initialRoll: { a: null, b: null, throwParamsA: null, throwParamsB: null },
    legHistory: [...state.legHistory, entry],
  };
}
```

- [ ] **Step 4: Run — verify they pass**

Run: `node --test test/backgammon-match.test.js`
Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/match.js test/backgammon-match.test.js
git commit -m "feat(backgammon): resolveLeg with reset + Crawford transition"
```

---

## Task 13: Match — match-end detection

**Files:**
- Modify: `plugins/backgammon/server/match.js`
- Test: `test/backgammon-match.test.js` (extend)

`isMatchOver(matchState)` returns `null | 'a' | 'b'`. After `resolveLeg`, the engine calls this — if non-null, return `{ ended: true, scoreDelta: { [winnerUserId]: target } }` from `applyAction`.

- [ ] **Step 1: Append failing tests**

Add to `test/backgammon-match.test.js`:

```js
import { isMatchOver } from '../plugins/backgammon/server/match.js';

test('isMatchOver: returns null when no one has reached target', () => {
  assert.equal(isMatchOver({ target: 3, scoreA: 2, scoreB: 1 }), null);
});

test('isMatchOver: returns "a" when scoreA >= target', () => {
  assert.equal(isMatchOver({ target: 3, scoreA: 3, scoreB: 1 }), 'a');
});

test('isMatchOver: returns "b" when scoreB >= target', () => {
  assert.equal(isMatchOver({ target: 3, scoreA: 1, scoreB: 4 }), 'b');
});

test('isMatchOver: target=1 ends match on first win', () => {
  assert.equal(isMatchOver({ target: 1, scoreA: 1, scoreB: 0 }), 'a');
});
```

- [ ] **Step 2: Run — verify failure**

Run: `node --test test/backgammon-match.test.js`
Expected: tests fail (`isMatchOver` not exported).

- [ ] **Step 3: Implement**

Append to `plugins/backgammon/server/match.js`:

```js
export function isMatchOver(match) {
  if (match.scoreA >= match.target) return 'a';
  if (match.scoreB >= match.target) return 'b';
  return null;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `node --test test/backgammon-match.test.js`
Expected: 16 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/match.js test/backgammon-match.test.js
git commit -m "feat(backgammon): isMatchOver helper"
```

---

## Task 14: Actions — `roll-initial`

**Files:**
- Modify: `plugins/backgammon/server/actions.js`
- Test: `test/backgammon-actions.test.js` (part 1)

The dispatcher resolves actor-side, validates `phase`, and routes by `action.type`. We start with `roll-initial`: tie → reroll, both rolled → set `activePlayer`, prime `turn.dice`.

- [ ] **Step 1: Write the failing test**

Create `test/backgammon-actions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBackgammonAction } from '../plugins/backgammon/server/actions.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { PARTICIPANTS, det } from './_helpers/backgammon-fixtures.js';

function freshState() {
  return buildInitialState({ participants: PARTICIPANTS, rng: det() });
}

test('roll-initial: A rolls first, B not yet — phase stays initial-roll', () => {
  const state = freshState();
  const result = applyBackgammonAction({
    state, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 4, throwParams: ['p1'] } },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.initialRoll.a, 4);
  assert.equal(result.state.initialRoll.b, null);
  assert.equal(result.state.turn.phase, 'initial-roll');
  assert.equal(result.ended, false);
});

test('roll-initial: both roll, A higher — A becomes active, dice primed, phase moves', () => {
  let s = freshState();
  s = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: ['pA'] } },
  }).state;
  const result = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'roll-initial', payload: { value: 3, throwParams: ['pB'] } },
  });
  assert.equal(result.state.turn.activePlayer, 'a');
  assert.equal(result.state.turn.phase, 'moving');
  assert.deepEqual(result.state.turn.dice.values, [5, 3]);
  assert.deepEqual(result.state.turn.dice.remaining, [5, 3]);
  // ThrowParams preserved per side (active player's first, then opponent's)
  assert.equal(result.state.turn.dice.throwParams.length, 2);
});

test('roll-initial: tie — both cleared, phase still initial-roll', () => {
  let s = freshState();
  s = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 4, throwParams: ['pA'] } },
  }).state;
  const result = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'roll-initial', payload: { value: 4, throwParams: ['pB'] } },
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.state.initialRoll, { a: null, b: null, throwParamsA: null, throwParamsB: null });
  assert.equal(result.state.turn.phase, 'initial-roll');
});

test('roll-initial: rejects when actor has already rolled', () => {
  let s = freshState();
  s = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 4, throwParams: [] } },
  }).state;
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: [] } },
  });
  assert.match(result.error, /already rolled/i);
});

test('roll-initial: rejects when phase is not initial-roll', () => {
  let s = freshState();
  s = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: [] } },
  }).state;
  s = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'roll-initial', payload: { value: 3, throwParams: [] } },
  }).state;
  // Now phase is 'moving'
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll-initial', payload: { value: 6, throwParams: [] } },
  });
  assert.match(result.error, /phase/i);
});

test('roll-initial: rejects unknown actorId', () => {
  const s = freshState();
  const result = applyBackgammonAction({
    state: s, actorId: 999,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: [] } },
  });
  assert.match(result.error, /participant/i);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test test/backgammon-actions.test.js`
Expected: stub from Task 1 returns `{ error: 'not implemented' }` for everything.

- [ ] **Step 3: Implement dispatcher + `roll-initial`**

Replace `plugins/backgammon/server/actions.js` entirely:

```js
import { PHASE, opponent } from './constants.js';

function actorSide(state, actorId) {
  if (state.sides.a === actorId) return 'a';
  if (state.sides.b === actorId) return 'b';
  return null;
}

export function applyBackgammonAction({ state, action, actorId }) {
  const side = actorSide(state, actorId);
  if (side === null) return { error: 'unknown participant' };

  switch (action.type) {
    case 'roll-initial': return doRollInitial(state, action.payload, side);
    default: return { error: `unknown action: ${action.type}` };
  }
}

function doRollInitial(state, payload, side) {
  if (state.turn.phase !== PHASE.INITIAL_ROLL) {
    return { error: `cannot roll-initial in phase: ${state.turn.phase}` };
  }
  if (state.initialRoll[side] !== null) {
    return { error: 'already rolled this leg' };
  }
  const value = payload?.value;
  const throwParams = payload?.throwParams;
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    return { error: 'roll-initial value must be 1..6' };
  }
  if (!Array.isArray(throwParams)) {
    return { error: 'roll-initial requires throwParams array' };
  }

  const tpKey = side === 'a' ? 'throwParamsA' : 'throwParamsB';
  const ir = { ...state.initialRoll, [side]: value, [tpKey]: throwParams };

  // Both rolled?
  if (ir.a !== null && ir.b !== null) {
    if (ir.a === ir.b) {
      // Tie: clear all four fields and reroll
      return {
        state: {
          ...state,
          initialRoll: { a: null, b: null, throwParamsA: null, throwParamsB: null },
        },
        ended: false,
        summary: { kind: 'roll-initial', tie: true },
      };
    }
    const winner = ir.a > ir.b ? 'a' : 'b';
    const loser = opponent(winner);
    const sortedValues = [ir[winner], ir[loser]];
    const winnerTp = winner === 'a' ? ir.throwParamsA : ir.throwParamsB;
    const loserTp  = loser  === 'a' ? ir.throwParamsA : ir.throwParamsB;
    return {
      state: {
        ...state,
        initialRoll: ir,  // keep the 4-field shape per spec §4.2
        turn: {
          activePlayer: winner,
          phase: PHASE.MOVING,
          dice: {
            values: sortedValues,
            remaining: sortedValues.slice(),
            throwParams: [...winnerTp, ...loserTp],
          },
        },
      },
      ended: false,
      summary: { kind: 'roll-initial', activePlayer: winner },
    };
  }

  // Only this side has rolled.
  return {
    state: { ...state, initialRoll: ir },
    ended: false,
    summary: { kind: 'roll-initial', side },
  };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `node --test test/backgammon-actions.test.js`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/actions.js test/backgammon-actions.test.js
git commit -m "feat(backgammon): action dispatcher + roll-initial"
```

---

## Task 15: Actions — `roll` (incl. auto-pass)

**Files:**
- Modify: `plugins/backgammon/server/actions.js`
- Test: `test/backgammon-actions.test.js` (extend)

The `roll` action runs at `phase: pre-roll`. It accepts `{values, throwParams}`, primes `turn.dice.remaining` (4 entries for doubles, 2 otherwise), advances `phase: moving`. If `enumerateLegalMoves` is empty after rolling, auto-pass-turn.

We'll need a helper to set up "after initial-roll" state for tests — encode it in the fixture file.

- [ ] **Step 1: Append helper to fixture**

Append to `test/_helpers/backgammon-fixtures.js`:

```js
import { applyBackgammonAction } from '../../plugins/backgammon/server/actions.js';
import { buildInitialState } from '../../plugins/backgammon/server/state.js';

// Build a state past the initial-roll phase, with `winner` as activePlayer
// and dice values [hi, lo].
export function stateAfterInitialRoll({ winner = 'a', hi = 5, lo = 3 } = {}) {
  let s = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  // First roll
  const firstSide = winner;
  const firstActorId = firstSide === 'a' ? 1 : 2;
  const firstValue = hi;
  s = applyBackgammonAction({
    state: s, actorId: firstActorId,
    action: { type: 'roll-initial', payload: { value: firstValue, throwParams: [] } },
  }).state;
  // Second roll
  const secondSide = winner === 'a' ? 'b' : 'a';
  const secondActorId = secondSide === 'a' ? 1 : 2;
  s = applyBackgammonAction({
    state: s, actorId: secondActorId,
    action: { type: 'roll-initial', payload: { value: lo, throwParams: [] } },
  }).state;
  // Now activePlayer === winner, phase === 'moving', dice = [hi, lo].
  return s;
}

// Build a state ready to roll (phase: pre-roll) for the given side.
export function statePreRoll({ activePlayer = 'a' } = {}) {
  // Start moving, then immediately call pass-turn to advance to pre-roll for the opponent.
  // For simplicity we just hand-craft the state.
  let s = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  return {
    ...s,
    turn: { activePlayer, phase: 'pre-roll', dice: null },
  };
}
```

- [ ] **Step 2: Append failing tests**

Add to `test/backgammon-actions.test.js`:

```js
import { stateAfterInitialRoll, statePreRoll } from './_helpers/backgammon-fixtures.js';

test('roll: rejects when phase is not pre-roll', () => {
  // After initial-roll resolves, phase is 'moving', not 'pre-roll'.
  const s = stateAfterInitialRoll({ winner: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [3, 4], throwParams: [] } },
  });
  assert.match(result.error, /phase/i);
});

test('roll: accepts at pre-roll and primes turn.dice.remaining', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [5, 3], throwParams: ['p'] } },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.turn.phase, 'moving');
  assert.deepEqual(result.state.turn.dice.values, [5, 3]);
  assert.deepEqual(result.state.turn.dice.remaining, [5, 3]);
});

test('roll: doubles primes 4-entry remaining', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [3, 3], throwParams: ['p'] } },
  });
  assert.deepEqual(result.state.turn.dice.remaining, [3, 3, 3, 3]);
});

test('roll: rejects from non-active player', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 2,  // B is not active
    action: { type: 'roll', payload: { values: [3, 4], throwParams: [] } },
  });
  assert.match(result.error, /not your turn/i);
});

test('roll: rejects malformed values', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [7, 0], throwParams: [] } },
  });
  assert.match(result.error, /values/i);
});

test('roll: auto-passes turn when no legal moves', () => {
  // Construct: A on bar, all 6 entry points blocked.
  const base = statePreRoll({ activePlayer: 'a' });
  const points = base.board.points.map(p => ({ ...p }));
  for (let i = 0; i < 6; i++) points[i] = { color: 'b', count: 2 };
  const s = {
    ...base,
    board: { ...base.board, points, barA: 1 },
  };
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'roll', payload: { values: [3, 5], throwParams: [] } },
  });
  // Expect: phase advanced through moving and back to pre-roll for B.
  assert.equal(result.state.turn.phase, 'pre-roll');
  assert.equal(result.state.turn.activePlayer, 'b');
  assert.equal(result.state.turn.dice, null);
});
```

- [ ] **Step 3: Run — verify failures**

Run: `node --test test/backgammon-actions.test.js`
Expected: new tests fail (`roll` is not handled).

- [ ] **Step 4: Implement `roll` in `actions.js`**

Add to `plugins/backgammon/server/actions.js`:

```js
import { enumerateLegalMoves } from './validate.js';

// ... inside applyBackgammonAction switch:
//    case 'roll': return doRoll(state, action.payload, side);
//    case 'pass-turn': return doPassTurn(state, side);
```

Update the switch and add the implementations:

```js
export function applyBackgammonAction({ state, action, actorId }) {
  const side = actorSide(state, actorId);
  if (side === null) return { error: 'unknown participant' };

  switch (action.type) {
    case 'roll-initial': return doRollInitial(state, action.payload, side);
    case 'roll':         return doRoll(state, action.payload, side);
    case 'pass-turn':    return doPassTurn(state, side);
    default: return { error: `unknown action: ${action.type}` };
  }
}

function isActive(state, side) {
  return state.turn.activePlayer === side;
}

function doRoll(state, payload, side) {
  if (state.turn.phase !== PHASE.PRE_ROLL) {
    return { error: `cannot roll in phase: ${state.turn.phase}` };
  }
  if (!isActive(state, side)) return { error: 'not your turn' };
  const values = payload?.values;
  const throwParams = payload?.throwParams;
  if (!Array.isArray(values) || values.length !== 2 ||
      !values.every(v => Number.isInteger(v) && v >= 1 && v <= 6)) {
    return { error: 'roll values must be two integers 1..6' };
  }
  if (!Array.isArray(throwParams)) return { error: 'roll requires throwParams array' };

  const remaining = values[0] === values[1] ? [values[0], values[0], values[0], values[0]] : values.slice();
  const dice = { values: values.slice(), remaining, throwParams };

  const afterRoll = {
    ...state,
    turn: { ...state.turn, phase: PHASE.MOVING, dice },
  };

  // Auto-pass if no legal moves
  const moves = enumerateLegalMoves(afterRoll.board, remaining, side);
  if (moves.length === 0) {
    return doPassTurn(afterRoll, side);
  }
  return { state: afterRoll, ended: false, summary: { kind: 'roll', values: values.slice() } };
}

function doPassTurn(state, side) {
  if (state.turn.phase !== PHASE.MOVING) {
    return { error: `cannot pass-turn in phase: ${state.turn.phase}` };
  }
  if (!isActive(state, side)) return { error: 'not your turn' };
  return {
    state: {
      ...state,
      turn: {
        activePlayer: opponent(side),
        phase: PHASE.PRE_ROLL,
        dice: null,
      },
    },
    ended: false,
    summary: { kind: 'pass-turn' },
  };
}
```

- [ ] **Step 5: Run — verify all pass**

Run: `node --test test/backgammon-actions.test.js`
Expected: 12 tests pass (6 + 6).

- [ ] **Step 6: Commit**

```bash
git add plugins/backgammon/server/actions.js test/backgammon-actions.test.js test/_helpers/backgammon-fixtures.js
git commit -m "feat(backgammon): roll action with auto-pass on no legal moves"
```

---

## Task 16: Actions — `move` + auto-pass-turn

**Files:**
- Modify: `plugins/backgammon/server/actions.js`
- Test: `test/backgammon-actions.test.js` (extend)

`move` validates against `legalFirstMoves` (which enforces must-use-both / higher-die), applies the move, removes the consumed die, and auto-pass-turns when remaining is empty OR no further legal moves remain.

When a move bears off the 15th checker, the leg ends. We wire the leg-end short-circuit *here* (before the auto-pass branch would otherwise step past it): after applying a `move`, if either `bornOffA === 15` or `bornOffB === 15`, route through `resolveLeg` and `isMatchOver`. The same `endLegAndMaybeMatch` helper is reused by `decline-double` (Task 18) and `resign` (Task 19).

- [ ] **Step 1: Append failing tests**

Add to `test/backgammon-actions.test.js`:

```js
import { resolveLeg } from '../plugins/backgammon/server/match.js';

test('move: applies valid move, removes consumed die', () => {
  const s = stateAfterInitialRoll({ winner: 'a', hi: 5, lo: 3 });
  // A has checker at index 0 (count 2). die=3 → 0→3.
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 0, to: 3 } },
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.state.turn.dice.remaining, [5]);
  assert.equal(result.state.board.points[0].count, 1);
  assert.equal(result.state.board.points[3].color, 'a');
});

test('move: rejects illegal move', () => {
  const s = stateAfterInitialRoll({ winner: 'a', hi: 5, lo: 3 });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 0, to: 7 } },  // die would be 7, not in remaining
  });
  assert.match(result.error, /legal/i);
});

test('move: rejects when phase is not moving', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 0, to: 3 } },
  });
  assert.match(result.error, /phase/i);
});

test('move: rejects from opponent', () => {
  const s = stateAfterInitialRoll({ winner: 'a', hi: 5, lo: 3 });
  const result = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'move', payload: { from: 0, to: 3 } },
  });
  assert.match(result.error, /not your turn/i);
});

test('move: auto-passes when remaining empties', () => {
  const s = stateAfterInitialRoll({ winner: 'a', hi: 5, lo: 3 });
  const r1 = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 0, to: 3 } },
  });
  const r2 = applyBackgammonAction({
    state: r1.state, actorId: 1,
    action: { type: 'move', payload: { from: 0, to: 5 } },  // die=5
  });
  assert.equal(r2.state.turn.phase, 'pre-roll');
  assert.equal(r2.state.turn.activePlayer, 'b');
  assert.equal(r2.state.turn.dice, null);
});

test('move: leg ends when 15th checker borne off', () => {
  // Set up an A turn with all 14 checkers borne off, last on index 23 (1-point).
  // die=1 bears off exactly.
  const base = stateAfterInitialRoll({ winner: 'a', hi: 1, lo: 2 });
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  points[23] = { color: 'a', count: 1 };
  // B is still mid-game; still has 15 checkers somewhere
  points[10] = { color: 'b', count: 15 };
  const s = {
    ...base,
    board: { points, barA: 0, barB: 0, bornOffA: 14, bornOffB: 0 },
  };
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 23, to: 'off' } },
  });
  assert.equal(result.error, undefined);
  // Leg classified as gammon (B has 0 borne off, no checkers in A home).
  // Score updated, board reset, gameNumber incremented.
  assert.equal(result.state.match.scoreA, 2);  // gammon × cube=1
  assert.equal(result.state.match.gameNumber, 2);
  assert.equal(result.state.turn.phase, 'initial-roll');
  // Match continues (target 3, scoreA 2): ended=false (still need 1 more).
  assert.equal(result.ended, false);
});

test('move: leg ends → match ends when target reached', () => {
  // target=1 — first leg completes ends match.
  let s = buildInitialState({
    participants: PARTICIPANTS, rng: det(), options: { matchLength: 1 },
  });
  // Hand-craft: A on index 23 with one checker, 14 borne off.
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  points[23] = { color: 'a', count: 1 };
  points[10] = { color: 'b', count: 15 };
  s = {
    ...s,
    board: { points, barA: 0, barB: 0, bornOffA: 14, bornOffB: 0 },
    turn: {
      activePlayer: 'a',
      phase: 'moving',
      dice: { values: [1, 2], remaining: [1, 2], throwParams: [] },
    },
  };
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'move', payload: { from: 23, to: 'off' } },
  });
  assert.equal(result.ended, true);
  assert.deepEqual(result.scoreDelta, { 1: 1 });  // userId 1 (=side 'a') wins target=1 points
});
```

- [ ] **Step 2: Run — verify failure**

Run: `node --test test/backgammon-actions.test.js`
Expected: tests fail (`move` not handled, leg-end not wired).

- [ ] **Step 3: Implement `doMove` in `actions.js`**

Add to `plugins/backgammon/server/actions.js`:

```js
import { legalFirstMoves } from './validate.js';
import { applyMove, enterFromBar, bearOff } from './board.js';
import { classifyLegEnd, resolveLeg, isMatchOver } from './match.js';

// In the dispatcher switch, add:
//   case 'move': return doMove(state, action.payload, side);

function applyOnePly(board, player, m) {
  if (m.from === 'bar') return enterFromBar(board, player, m.to);
  if (m.to === 'off')   return bearOff(board, player, m.from);
  return applyMove(board, player, m.from, m.to);
}

function removeOneDie(remaining, die) {
  const idx = remaining.indexOf(die);
  if (idx < 0) return remaining.slice();
  return [...remaining.slice(0, idx), ...remaining.slice(idx + 1)];
}

function bornOffWinner(board) {
  if (board.bornOffA === 15) return 'a';
  if (board.bornOffB === 15) return 'b';
  return null;
}

function doMove(state, payload, side) {
  if (state.turn.phase !== PHASE.MOVING) {
    return { error: `cannot move in phase: ${state.turn.phase}` };
  }
  if (!isActive(state, side)) return { error: 'not your turn' };
  const from = payload?.from;
  const to = payload?.to;
  if (from === undefined || to === undefined) return { error: 'move requires {from, to}' };

  const candidates = legalFirstMoves(state.board, state.turn.dice.remaining, side);
  const chosen = candidates.find(m => m.from === from && m.to === to);
  if (!chosen) return { error: 'move is not legal under current dice' };

  const nextBoard = applyOnePly(state.board, side, chosen);
  const nextRemaining = removeOneDie(state.turn.dice.remaining, chosen.die);

  // Leg end?
  const winner = bornOffWinner(nextBoard);
  if (winner) {
    return endLegAndMaybeMatch({
      state: { ...state, board: nextBoard,
               turn: { ...state.turn, dice: { ...state.turn.dice, remaining: nextRemaining } } },
      winner,
      type: classifyLegEnd(nextBoard, winner).type,
      multiplier: classifyLegEnd(nextBoard, winner).multiplier,
      cubeValue: state.cube.value,
    });
  }

  const next = {
    ...state,
    board: nextBoard,
    turn: {
      ...state.turn,
      dice: { ...state.turn.dice, remaining: nextRemaining },
    },
  };

  // Auto-pass if remaining empty OR no further legal moves
  if (nextRemaining.length === 0 ||
      legalFirstMoves(next.board, nextRemaining, side).length === 0) {
    return doPassTurn(next, side);
  }

  return { state: next, ended: false, summary: { kind: 'move' } };
}

function endLegAndMaybeMatch({ state, winner, type, multiplier, cubeValue }) {
  const nextState = resolveLeg({ state, winner, type, multiplier, cubeValue });
  const matchWinner = isMatchOver(nextState.match);
  if (matchWinner) {
    const winnerUserId = nextState.sides[matchWinner];
    return {
      state: nextState,
      ended: true,
      scoreDelta: { [winnerUserId]: nextState.match.target },
      summary: { kind: 'match-end', winner: matchWinner, type },
    };
  }
  return { state: nextState, ended: false, summary: { kind: 'leg-end', winner, type } };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `node --test test/backgammon-actions.test.js`
Expected: 19 tests pass (12 + 7).

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/actions.js test/backgammon-actions.test.js
git commit -m "feat(backgammon): move action with auto-pass and leg/match end"
```

---

## Task 17: Actions — explicit `pass-turn` (already implemented, lock in tests)

**Files:**
- Test: `test/backgammon-actions.test.js` (extend)

`pass-turn` was implemented in Task 15 to support auto-pass. This task adds explicit-call tests.

- [ ] **Step 1: Append tests**

Add to `test/backgammon-actions.test.js`:

```js
test('pass-turn: explicit call by active player switches sides', () => {
  const s = stateAfterInitialRoll({ winner: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'pass-turn', payload: {} },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.turn.activePlayer, 'b');
  assert.equal(result.state.turn.phase, 'pre-roll');
  assert.equal(result.state.turn.dice, null);
});

test('pass-turn: rejects from non-active player', () => {
  const s = stateAfterInitialRoll({ winner: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 2,
    action: { type: 'pass-turn', payload: {} },
  });
  assert.match(result.error, /not your turn/i);
});
```

- [ ] **Step 2: Run — should pass without code changes**

Run: `node --test test/backgammon-actions.test.js`
Expected: 21 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/backgammon-actions.test.js
git commit -m "test(backgammon): explicit pass-turn coverage"
```

---

## Task 18: Actions — cube actions (`offer-double`, `accept-double`, `decline-double`)

**Files:**
- Modify: `plugins/backgammon/server/actions.js`
- Test: `test/backgammon-actions.test.js` (extend)

- `offer-double`: actor must be `activePlayer` and `phase === 'pre-roll'`. Sets `cube.pendingOffer`, `phase: awaiting-double-response`.
- `accept-double`: actor must be the *non-offerer* (== opponent of activePlayer). Doubles cube, transfers ownership, `phase: 'pre-roll'`.
- `decline-double`: actor must be the *non-offerer*. Awards pre-double cube value to offerer; ends leg; classification is `'single'` (the leg ended without bear-off, by decline). Routes through `endLegAndMaybeMatch`.

- [ ] **Step 1: Append failing tests**

Add to `test/backgammon-actions.test.js`:

```js
test('offer-double: legal at pre-roll by active player', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'offer-double', payload: {} },
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.state.cube.pendingOffer, { from: 'a' });
  assert.equal(result.state.turn.phase, 'awaiting-double-response');
});

test('offer-double: rejected during Crawford', () => {
  const base = statePreRoll({ activePlayer: 'a' });
  const s = { ...base, match: { ...base.match, crawford: true } };
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'offer-double', payload: {} },
  });
  assert.match(result.error, /crawford|cannot/i);
});

test('offer-double: rejected when actor does not own cube', () => {
  const base = statePreRoll({ activePlayer: 'a' });
  const s = { ...base, cube: { value: 2, owner: 'b', pendingOffer: null } };
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'offer-double', payload: {} },
  });
  assert.match(result.error, /cannot/i);
});

test('accept-double: by opponent doubles cube and transfers ownership', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const offered = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'offer-double', payload: {} },
  }).state;
  const result = applyBackgammonAction({
    state: offered, actorId: 2,
    action: { type: 'accept-double', payload: {} },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.cube.value, 2);
  assert.equal(result.state.cube.owner, 'b');
  assert.equal(result.state.cube.pendingOffer, null);
  assert.equal(result.state.turn.phase, 'pre-roll');
  // Active player unchanged — A was about to roll
  assert.equal(result.state.turn.activePlayer, 'a');
});

test('accept-double: rejected from offerer', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const offered = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'offer-double', payload: {} },
  }).state;
  const result = applyBackgammonAction({
    state: offered, actorId: 1,
    action: { type: 'accept-double', payload: {} },
  });
  assert.match(result.error, /opponent|cannot/i);
});

test('decline-double: ends leg, awards pre-double cube to offerer, match continues', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const offered = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'offer-double', payload: {} },
  }).state;
  const result = applyBackgammonAction({
    state: offered, actorId: 2,
    action: { type: 'decline-double', payload: {} },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.match.scoreA, 1);  // pre-double cube value = 1
  assert.equal(result.state.turn.phase, 'initial-roll');
  assert.equal(result.state.legHistory.length, 1);
  assert.equal(result.state.legHistory[0].type, 'single');
  assert.equal(result.ended, false);
});

test('decline-double: target=1 → leg end IS match end', () => {
  const base = buildInitialState({
    participants: PARTICIPANTS, rng: det(), options: { matchLength: 1 },
  });
  const s = { ...base, turn: { activePlayer: 'a', phase: 'pre-roll', dice: null } };
  const offered = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'offer-double', payload: {} },
  }).state;
  const result = applyBackgammonAction({
    state: offered, actorId: 2,
    action: { type: 'decline-double', payload: {} },
  });
  assert.equal(result.ended, true);
  assert.deepEqual(result.scoreDelta, { 1: 1 });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `node --test test/backgammon-actions.test.js`
Expected: cube-action tests fail.

- [ ] **Step 3: Wire cube actions into `actions.js`**

Add to `plugins/backgammon/server/actions.js`:

```js
import { canOffer, applyOffer, applyAccept, applyDecline } from './cube.js';

// In the dispatcher switch:
//   case 'offer-double':   return doOfferDouble(state, side);
//   case 'accept-double':  return doAcceptDouble(state, side);
//   case 'decline-double': return doDeclineDouble(state, side);

function doOfferDouble(state, side) {
  if (state.turn.phase !== PHASE.PRE_ROLL) {
    return { error: `cannot offer-double in phase: ${state.turn.phase}` };
  }
  if (!isActive(state, side)) return { error: 'not your turn' };
  if (!canOffer({ cube: state.cube, match: state.match }, side)) {
    return { error: 'cannot offer double now' };
  }
  return {
    state: {
      ...state,
      cube: applyOffer(state.cube, side),
      turn: { ...state.turn, phase: PHASE.AWAITING_DOUBLE_RESPONSE },
    },
    ended: false,
    summary: { kind: 'offer-double' },
  };
}

function doAcceptDouble(state, side) {
  if (state.turn.phase !== PHASE.AWAITING_DOUBLE_RESPONSE) {
    return { error: `cannot accept-double in phase: ${state.turn.phase}` };
  }
  if (state.cube.pendingOffer === null || state.cube.pendingOffer.from === side) {
    return { error: 'only opponent of offerer can accept' };
  }
  return {
    state: {
      ...state,
      cube: applyAccept(state.cube, side),
      turn: { ...state.turn, phase: PHASE.PRE_ROLL },
    },
    ended: false,
    summary: { kind: 'accept-double' },
  };
}

function doDeclineDouble(state, side) {
  if (state.turn.phase !== PHASE.AWAITING_DOUBLE_RESPONSE) {
    return { error: `cannot decline-double in phase: ${state.turn.phase}` };
  }
  if (state.cube.pendingOffer === null || state.cube.pendingOffer.from === side) {
    return { error: 'only opponent of offerer can decline' };
  }
  const { awardedToOfferer, offerer } = applyDecline(state.cube);
  return endLegAndMaybeMatch({
    state,
    winner: offerer,
    type: 'single',
    multiplier: 1,
    cubeValue: awardedToOfferer,
  });
}
```

- [ ] **Step 4: Run — verify pass**

Run: `node --test test/backgammon-actions.test.js`
Expected: 28 tests pass (21 + 7).

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/actions.js test/backgammon-actions.test.js
git commit -m "feat(backgammon): cube actions (offer/accept/decline)"
```

---

## Task 19: Actions — `resign`

**Files:**
- Modify: `plugins/backgammon/server/actions.js`
- Test: `test/backgammon-actions.test.js` (extend)

`resign` is legal in any phase except `awaiting-double-response`. Awards `cube.value` to opponent, leg type `'resigned'`, then routes through `endLegAndMaybeMatch`.

- [ ] **Step 1: Append failing tests**

Add to `test/backgammon-actions.test.js`:

```js
test('resign: A resigns mid-leg, B awarded cube value', () => {
  const s = stateAfterInitialRoll({ winner: 'a' });
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'resign', payload: {} },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.state.match.scoreB, 1);  // cube=1 awarded to B
  assert.equal(result.state.legHistory[0].type, 'resigned');
  assert.equal(result.ended, false);
});

test('resign: rejected during awaiting-double-response', () => {
  const s = statePreRoll({ activePlayer: 'a' });
  const offered = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'offer-double', payload: {} },
  }).state;
  const result = applyBackgammonAction({
    state: offered, actorId: 2,
    action: { type: 'resign', payload: {} },
  });
  assert.match(result.error, /awaiting/i);
});

test('resign: target=1 ends match', () => {
  const base = buildInitialState({
    participants: PARTICIPANTS, rng: det(), options: { matchLength: 1 },
  });
  const s = { ...base, turn: { activePlayer: 'a', phase: 'pre-roll', dice: null } };
  const result = applyBackgammonAction({
    state: s, actorId: 1,
    action: { type: 'resign', payload: {} },
  });
  assert.equal(result.ended, true);
  assert.deepEqual(result.scoreDelta, { 2: 1 });  // B (userId 2) wins
});
```

- [ ] **Step 2: Run — verify failure**

Run: `node --test test/backgammon-actions.test.js`
Expected: resign tests fail.

- [ ] **Step 3: Implement**

Add to `plugins/backgammon/server/actions.js`:

```js
// Switch case:
//   case 'resign': return doResign(state, side);

function doResign(state, side) {
  if (state.turn.phase === PHASE.AWAITING_DOUBLE_RESPONSE) {
    return { error: 'cannot resign while awaiting double response' };
  }
  return endLegAndMaybeMatch({
    state,
    winner: opponent(side),
    type: 'resigned',
    multiplier: 1,
    cubeValue: state.cube.value,
  });
}
```

- [ ] **Step 4: Run — verify pass**

Run: `node --test test/backgammon-actions.test.js`
Expected: 31 tests pass (28 + 3).

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/actions.js test/backgammon-actions.test.js
git commit -m "feat(backgammon): resign action"
```

---

## Task 20: Public view

**Files:**
- Modify: `plugins/backgammon/server/view.js`
- Test: `test/backgammon-view.test.js`

Backgammon is open information. The view passes through state and adds `youAre: 'a' | 'b' | null`.

- [ ] **Step 1: Write the failing test**

Create `test/backgammon-view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgammonPublicView } from '../plugins/backgammon/server/view.js';
import { buildInitialState } from '../plugins/backgammon/server/state.js';
import { PARTICIPANTS, det } from './_helpers/backgammon-fixtures.js';

test('publicView: passes through full state', () => {
  const state = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const view = backgammonPublicView({ state, viewerId: 1 });
  assert.deepEqual(view.match, state.match);
  assert.deepEqual(view.cube, state.cube);
  assert.deepEqual(view.board, state.board);
  assert.deepEqual(view.turn, state.turn);
  assert.deepEqual(view.legHistory, state.legHistory);
  assert.deepEqual(view.initialRoll, state.initialRoll);
  assert.deepEqual(view.sides, state.sides);
});

test('publicView: youAre = "a" for participant 1', () => {
  const state = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const view = backgammonPublicView({ state, viewerId: 1 });
  assert.equal(view.youAre, 'a');
});

test('publicView: youAre = "b" for participant 2', () => {
  const state = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const view = backgammonPublicView({ state, viewerId: 2 });
  assert.equal(view.youAre, 'b');
});

test('publicView: youAre = null for non-participant', () => {
  const state = buildInitialState({ participants: PARTICIPANTS, rng: det() });
  const view = backgammonPublicView({ state, viewerId: 999 });
  assert.equal(view.youAre, null);
});
```

- [ ] **Step 2: Run — verify failure**

Run: `node --test test/backgammon-view.test.js`
Expected: `view.match` is undefined (Task 1 stub returns `{...state}` only).

Wait — `{...state}` shallow-spreads, so `view.match` should equal `state.match`. So the first test passes accidentally and only the `youAre` tests fail. Verify:

```bash
node --test test/backgammon-view.test.js
```

Expected: at least 3 of the 4 tests fail (`youAre` undefined).

- [ ] **Step 3: Implement**

Replace `plugins/backgammon/server/view.js`:

```js
export function backgammonPublicView({ state, viewerId }) {
  let youAre = null;
  if (state.sides?.a === viewerId) youAre = 'a';
  else if (state.sides?.b === viewerId) youAre = 'b';
  return { ...state, youAre };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `node --test test/backgammon-view.test.js`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/backgammon/server/view.js test/backgammon-view.test.js
git commit -m "feat(backgammon): publicView open-info passthrough + youAre"
```

---

## Task 21: Register plugin in host registry + integration smoke

**Files:**
- Modify: `src/plugins/index.js`
- Modify: `test/backgammon-plugin.test.js` (extend)

- [ ] **Step 1: Append integration tests to `test/backgammon-plugin.test.js`**

Add to the end of the file:

```js
test('initialState produces full game state with default match length', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  const s = backgammonPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  assert.equal(s.match.target, 3);
  assert.equal(s.board.points.length, 24);
  assert.equal(s.turn.phase, 'initial-roll');
});

test('publicView wired through plugin manifest', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  const state = backgammonPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  const view = backgammonPlugin.publicView({ state, viewerId: 1 });
  assert.equal(view.youAre, 'a');
});

test('applyAction wired through plugin manifest (roll-initial flow)', () => {
  let counter = 0; const rng = () => { counter += 0.137; return counter % 1; };
  let state = backgammonPlugin.initialState({
    participants: [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }],
    rng,
  });
  state = backgammonPlugin.applyAction({
    state, actorId: 1, rng,
    action: { type: 'roll-initial', payload: { value: 5, throwParams: [] } },
  }).state;
  const result = backgammonPlugin.applyAction({
    state, actorId: 2, rng,
    action: { type: 'roll-initial', payload: { value: 3, throwParams: [] } },
  });
  assert.equal(result.state.turn.activePlayer, 'a');
  assert.equal(result.state.turn.phase, 'moving');
});

test('plugin appears in host registry', async () => {
  const { plugins } = await import('../src/plugins/index.js');
  assert.equal(plugins.backgammon, backgammonPlugin);
});
```

- [ ] **Step 2: Run — verify the registry test fails**

Run: `node --test test/backgammon-plugin.test.js`
Expected: the first three new tests pass; `plugin appears in host registry` fails because the registry doesn't have `backgammon` yet.

- [ ] **Step 3: Register the plugin**

Modify `src/plugins/index.js`:

```js
// Static plugin registry. Add a plugin by importing it and adding it to the
// exported map. The order here is the order plugins appear in any picker UI.

import wordsPlugin from '../../plugins/words/plugin.js';
import rummikubPlugin from '../../plugins/rummikub/plugin.js';
import backgammonPlugin from '../../plugins/backgammon/plugin.js';

export const plugins = {
  words: wordsPlugin,
  rummikub: rummikubPlugin,
  backgammon: backgammonPlugin,
};
```

- [ ] **Step 4: Run — verify pass**

Run: `node --test test/backgammon-plugin.test.js`
Expected: 6 tests pass.

- [ ] **Step 5: Run the full host test suite — nothing should regress**

Run: `npm test`
Expected: all backgammon tests pass; all rummikub tests pass; all words tests pass; all host tests pass. Total count includes the new ~70 backgammon tests.

If any non-backgammon test fails, treat it as a regression — investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/index.js test/backgammon-plugin.test.js
git commit -m "feat(plugins): register backgammon in host registry"
```

---

## Task 22: Self-review pass against spec

**Files:** none (read-only verification)

This is the writing-plans skill's required final pass. Walk the spec sections against the implementation; fix any gaps inline before declaring Phase B done.

- [ ] **Step 1: Re-read spec §1, §4, §7**

Run: `grep -n '^##\|^###' docs/superpowers/specs/2026-05-06-backgammon-design.md`
Then open the file and read §1 (Goals), §4 (Backgammon plugin), §7 (Open questions).

- [ ] **Step 2: Spec coverage checklist**

For each spec item, confirm a task implemented it. Tick each off:

- [ ] §1 Goal: backgammon plugin follows host plugin contract → Tasks 1, 21
- [ ] §1 Goal: support match play (best-of-N legs) → Tasks 3, 12, 13
- [ ] §1 Non-goals (beavers, raccoons, Jacoby, etc.) — verify NOT implemented
- [ ] §4.1 file layout matches: state, actions, validate, board, cube, match, view → Tasks 2–20
- [ ] §4.2 state shape: match/cube/board/turn/legHistory/initialRoll all present → Task 3
- [ ] §4.3 every action in the action surface table is handled → Tasks 14–19
  - `roll-initial`, `roll`, `move`, `pass-turn`, `offer-double`, `accept-double`, `decline-double`, `resign`
- [ ] §4.4 move validation rules covered:
  - bar-entry-first → Task 5
  - blocked points → Tasks 5, 6
  - hit blot → Task 4
  - must-use-both, higher-die → Task 7
  - doubles → Task 9
  - bear-off (exact + higher-die) → Task 8
  - gammon/backgammon classification → Task 11
- [ ] §4.5 cube + Crawford: offer/accept/decline, ownership transfer, cap, Crawford suppression, post-Crawford restoration → Tasks 10, 12, 18
- [ ] §4.6 match-as-row mechanics: leg-end returns ended:false, match-end returns ended:true, scoreDelta keyed by winnerUserId, full reset between legs → Tasks 12, 13, 16, 18, 19
- [ ] §4.7 initial roll every leg, tie reroll → Task 14
- [ ] §4.8 publicView sets youAre, no fields hidden → Task 20

- [ ] **Step 3: Placeholder scan**

Run: `grep -rnE 'TODO|FIXME|TBD|XXX' plugins/backgammon/`
Expected: no matches. Any match → fix before sign-off.

- [ ] **Step 4: Type-consistency scan**

Skim the public APIs across modules. Fix any mismatch:
- `enumerateLegalMoves`, `legalFirstMoves`, `isLegalMove` signatures all `(board, dice, player)`?
- Action results consistently shaped `{ state, ended, scoreDelta?, summary?, error? }`?
- `match.target` referenced everywhere (not e.g. `matchLength`)?

- [ ] **Step 5: Run all tests one last time**

Run: `npm test`
Expected: full suite passes; no skipped or pending tests.

- [ ] **Step 6: Verify clean working tree (excluding pre-existing rummikub work)**

Run: `git status -- plugins/backgammon test src/plugins/index.js`
Expected: empty (everything committed).

- [ ] **Step 7: Push the branch**

```bash
git push -u origin feat/backgammon-engine
```

- [ ] **Step 8: Phase B done — handoff**

Phase B engine is complete and pushed. Next phase is C (client) — out of scope here. Do NOT open a PR yet; the user may want to review locally first or bundle Phase B into a larger PR with Phase C.

---

## Done

When all 22 tasks are complete:
- `plugins/backgammon/server/*.js` and `plugins/backgammon/plugin.js` exist
- `src/plugins/index.js` registers `backgammon`
- ~70 new tests in `test/backgammon-*.test.js` all pass
- `npm test` is fully green
- Branch `feat/backgammon-engine` is pushed
- No `client/` work yet — Phase C handles UI
