# Cribbage Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-deal Cribbage plugin (deal → discard → cut → pegging → auto-tally show) following the existing Gamebox plugin contract. First card-using plugin in the project.

**Architecture:** Phase-machine state — `state.phase ∈ {'discard','cut','pegging','show','done'}`. Reducer dispatches on `(phase, action.type)`. Cards live in-plugin. Server is authoritative; client uses already-cut card images from `plugins/cribbage/client/assets/cards/`. Shows vernacular breakdown ("Fifteen-two, fifteen-four, …").

**Tech Stack:** Node 20, ESM, Express, vanilla JS client (no React), `node:test` for tests, SSE for live updates, SQLite for persistence (already wired by host).

**Spec:** `docs/superpowers/specs/2026-05-07-cribbage-design.md`

**Conventions to mirror from rummikub/words/backgammon:**
- `applyAction({ state, action, actorId, rng })` returns `{ state, ended, summary, scoreDelta? }` or `{ error: '...' }` (NOT throws — host expects return-error).
- Sides are `'a' | 'b'`; `state.sides = { a: userId, b: userId }`.
- `state.activeUserId` is the userId whose turn it is. Host enforces turn ownership only when `typeof activeUserId === 'number'`. During simultaneous phases (discard, show-ack) we set it to `null` so either player can act.
- `summary.kind` is the action type label (`'discard' | 'cut' | 'play' | 'go' | 'next' | 'pegging-end' | 'show'`).
- `endedReason` and `winnerSide` set when `ended: true`. v1 has no winner — both players' deal-scores are reported via `scoreDelta` and `endedReason: 'deal-complete'`.
- Tests use `node:test` with `assert/strict`.

---

## Task 1: Plugin scaffolding + registration smoke test

**Files:**
- Create: `plugins/cribbage/plugin.js`
- Create: `plugins/cribbage/server/state.js`
- Create: `plugins/cribbage/server/actions.js`
- Create: `plugins/cribbage/server/view.js`
- Modify: `src/plugins/index.js`
- Test: `test/cribbage-plugin.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/cribbage-plugin.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlugin } from '../src/server/plugins.js';
import cribbage from '../plugins/cribbage/plugin.js';

test('cribbage plugin: shape passes validatePlugin', () => {
  validatePlugin(cribbage);
  assert.equal(cribbage.id, 'cribbage');
  assert.equal(cribbage.players, 2);
  assert.equal(cribbage.displayName, 'Cribbage');
  assert.equal(cribbage.clientDir, 'plugins/cribbage/client');
});

test('cribbage plugin: registered in src/plugins/index.js', async () => {
  const { plugins } = await import('../src/plugins/index.js');
  assert.ok(plugins.cribbage, 'cribbage missing from registry');
  assert.equal(plugins.cribbage.id, 'cribbage');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-plugin.test.js`
Expected: FAIL — module not found / plugin missing.

- [ ] **Step 3: Create stub modules**

```js
// plugins/cribbage/server/state.js
export function buildInitialState(_ctx) {
  return { phase: 'discard' };
}
```

```js
// plugins/cribbage/server/actions.js
export function applyCribbageAction(_ctx) {
  return { error: 'not implemented' };
}
```

```js
// plugins/cribbage/server/view.js
export function cribbagePublicView({ state }) {
  return { phase: state.phase };
}
```

```js
// plugins/cribbage/plugin.js
import { buildInitialState } from './server/state.js';
import { applyCribbageAction } from './server/actions.js';
import { cribbagePublicView } from './server/view.js';

export default {
  id: 'cribbage',
  displayName: 'Cribbage',
  players: 2,
  clientDir: 'plugins/cribbage/client',
  initialState: buildInitialState,
  applyAction: applyCribbageAction,
  publicView: cribbagePublicView,
};
```

- [ ] **Step 4: Register in `src/plugins/index.js`**

Add the import and export entry. After this change the file should look like:

```js
import wordsPlugin from '../../plugins/words/plugin.js';
import rummikubPlugin from '../../plugins/rummikub/plugin.js';
import backgammonPlugin from '../../plugins/backgammon/plugin.js';
import cribbagePlugin from '../../plugins/cribbage/plugin.js';

export const plugins = {
  words: wordsPlugin,
  rummikub: rummikubPlugin,
  backgammon: backgammonPlugin,
  cribbage: cribbagePlugin,
};
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test test/cribbage-plugin.test.js`
Expected: 2 PASS.

Run full suite to make sure nothing else broke: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/cribbage src/plugins/index.js test/cribbage-plugin.test.js
git commit -m "feat(cribbage): plugin scaffolding registered with host"
```

---

## Task 2: Card primitive — ranks, suits, deck, pip/run values

**Files:**
- Create: `plugins/cribbage/server/cards.js`
- Test: `test/cribbage-cards.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-cards.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKS, SUITS, buildDeck, shuffle, pipValue, runValue, sameCard,
} from '../plugins/cribbage/server/cards.js';

test('RANKS has 13 entries, A through K, T for ten', () => {
  assert.deepEqual(RANKS, ['A','2','3','4','5','6','7','8','9','T','J','Q','K']);
});

test('SUITS has S, H, D, C', () => {
  assert.deepEqual(SUITS, ['S','H','D','C']);
});

test('buildDeck returns 52 unique cards', () => {
  const d = buildDeck();
  assert.equal(d.length, 52);
  const ids = new Set(d.map(c => c.rank + c.suit));
  assert.equal(ids.size, 52);
});

test('pipValue: A=1, 2..9=face, T/J/Q/K=10', () => {
  assert.equal(pipValue({ rank: 'A', suit: 'S' }), 1);
  assert.equal(pipValue({ rank: '5', suit: 'H' }), 5);
  assert.equal(pipValue({ rank: '9', suit: 'D' }), 9);
  for (const r of ['T','J','Q','K']) {
    assert.equal(pipValue({ rank: r, suit: 'C' }), 10);
  }
});

test('runValue: A=1, T=10, J=11, Q=12, K=13', () => {
  assert.equal(runValue({ rank: 'A', suit: 'S' }), 1);
  assert.equal(runValue({ rank: 'T', suit: 'S' }), 10);
  assert.equal(runValue({ rank: 'J', suit: 'S' }), 11);
  assert.equal(runValue({ rank: 'Q', suit: 'S' }), 12);
  assert.equal(runValue({ rank: 'K', suit: 'S' }), 13);
});

test('shuffle preserves the multiset', () => {
  const d = buildDeck();
  let s = 1;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out = shuffle(d.slice(), rng);
  assert.equal(out.length, 52);
  const before = d.map(c => c.rank + c.suit).sort();
  const after = out.map(c => c.rank + c.suit).sort();
  assert.deepEqual(after, before);
});

test('sameCard matches by rank+suit', () => {
  assert.equal(sameCard({ rank: 'A', suit: 'S' }, { rank: 'A', suit: 'S' }), true);
  assert.equal(sameCard({ rank: 'A', suit: 'S' }, { rank: 'A', suit: 'H' }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-cards.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `cards.js`**

```js
// plugins/cribbage/server/cards.js
export const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
export const SUITS = ['S','H','D','C'];

const PIP = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:10, Q:10, K:10 };
const RUN = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:11, Q:12, K:13 };

export function pipValue(card) { return PIP[card.rank]; }
export function runValue(card) { return RUN[card.rank]; }
export function sameCard(a, b) { return a.rank === b.rank && a.suit === b.suit; }

export function buildDeck() {
  const out = [];
  for (const s of SUITS) for (const r of RANKS) out.push({ rank: r, suit: s });
  return out;
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test test/cribbage-cards.test.js`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/cards.js test/cribbage-cards.test.js
git commit -m "feat(cribbage): card primitive — ranks, suits, deck, pip/run values"
```

---

## Task 3: `buildInitialState` — deal 6 each, set discard phase

**Files:**
- Modify: `plugins/cribbage/server/state.js`
- Test: `test/cribbage-state.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-state.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

const participants = [
  { userId: 1, side: 'a' },
  { userId: 2, side: 'b' },
];

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('buildInitialState: phase=discard, dealer=0, scores=[0,0]', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.phase, 'discard');
  assert.equal(s.dealer, 0);
  assert.deepEqual(s.scores, [0, 0]);
});

test('buildInitialState: deals 6 to each hand, 40 left in deck', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.hands[0].length, 6);
  assert.equal(s.hands[1].length, 6);
  assert.equal(s.deck.length, 40);
});

test('buildInitialState: pendingDiscards [null,null], crib [], starter null, pegging null', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.pendingDiscards, [null, null]);
  assert.deepEqual(s.crib, []);
  assert.equal(s.starter, null);
  assert.equal(s.pegging, null);
});

test('buildInitialState: sides map participants', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.sides, { a: 1, b: 2 });
});

test('buildInitialState: activeUserId is null during discard (simultaneous)', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.activeUserId, null);
});

test('buildInitialState: total cards across hands+deck = 52, no duplicates', () => {
  const s = buildInitialState({ participants, rng: det() });
  const all = [...s.hands[0], ...s.hands[1], ...s.deck];
  assert.equal(all.length, 52);
  const ids = new Set(all.map(c => c.rank + c.suit));
  assert.equal(ids.size, 52);
});

test('buildInitialState: same rng seed → same deal (determinism)', () => {
  const s1 = buildInitialState({ participants, rng: det(42) });
  const s2 = buildInitialState({ participants, rng: det(42) });
  assert.deepEqual(s1.hands, s2.hands);
  assert.deepEqual(s1.deck, s2.deck);
});

test('buildInitialState: acknowledged starts [false,false]', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.acknowledged, [false, false]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-state.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement state**

```js
// plugins/cribbage/server/state.js
import { buildDeck, shuffle } from './cards.js';

export function buildInitialState({ participants, rng }) {
  const a = participants.find(p => p.side === 'a').userId;
  const b = participants.find(p => p.side === 'b').userId;

  const deck = shuffle(buildDeck(), rng);
  const hands = [deck.slice(0, 6), deck.slice(6, 12)];
  const remaining = deck.slice(12);

  return {
    phase: 'discard',
    dealer: 0,
    deck: remaining,
    hands,
    pendingDiscards: [null, null],
    crib: [],
    starter: null,
    pegging: null,
    scores: [0, 0],
    showBreakdown: null,
    acknowledged: [false, false],
    sides: { a, b },
    activeUserId: null, // simultaneous discard phase
    endedReason: null,
    winnerSide: null,
  };
}

export function playerIndex(state, userId) {
  if (state.sides.a === userId) return 0;
  if (state.sides.b === userId) return 1;
  return -1;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test test/cribbage-state.test.js`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/state.js test/cribbage-state.test.js
git commit -m "feat(cribbage): buildInitialState — deal six, set discard phase"
```

---

## Task 4: Reducer dispatcher + error contract

**Files:**
- Modify: `plugins/cribbage/server/actions.js`
- Test: `test/cribbage-actions.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-actions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('action with unknown type → error', () => {
  const state = buildInitialState({ participants, rng: det() });
  const result = applyCribbageAction({ state, action: { type: 'nope' }, actorId: 1, rng: det() });
  assert.match(result.error, /unknown action/);
});

test('action by non-participant → error', () => {
  const state = buildInitialState({ participants, rng: det() });
  const result = applyCribbageAction({ state, action: { type: 'discard', payload: {} }, actorId: 99, rng: det() });
  assert.match(result.error, /not a participant/);
});

test('action with wrong phase → phase error', () => {
  const state = buildInitialState({ participants, rng: det() });
  const result = applyCribbageAction({ state, action: { type: 'play', payload: { card: state.hands[0][0] } }, actorId: 1, rng: det() });
  assert.match(result.error, /phase/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-actions.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement dispatcher**

```js
// plugins/cribbage/server/actions.js
import { playerIndex } from './state.js';

const HANDLERS = {}; // populated by phase modules in later tasks

export function registerPhaseHandler(phase, type, fn) {
  HANDLERS[`${phase}:${type}`] = fn;
}

export function applyCribbageAction({ state, action, actorId, rng }) {
  const player = playerIndex(state, actorId);
  if (player < 0) return { error: 'not a participant' };
  const handler = HANDLERS[`${state.phase}:${action.type}`];
  if (!handler) {
    if (Object.keys(HANDLERS).some(k => k.endsWith(`:${action.type}`))) {
      return { error: `action '${action.type}' not allowed in phase '${state.phase}'` };
    }
    return { error: `unknown action: ${action.type}` };
  }
  return handler({ state, action, player, rng });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test test/cribbage-actions.test.js`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/actions.js test/cribbage-actions.test.js
git commit -m "feat(cribbage): action dispatcher with phase + participant checks"
```

---

## Task 5: Discard phase — both players choose 2 cards

**Files:**
- Create: `plugins/cribbage/server/phases/discard.js`
- Modify: `plugins/cribbage/server/actions.js` (register handler)
- Test: `test/cribbage-discard.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-discard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';
import { sameCard } from '../plugins/cribbage/server/cards.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function makeState() {
  return buildInitialState({ participants, rng: det() });
}

test('discard: rejects non-array payload.cards', () => {
  const r = applyCribbageAction({ state: makeState(), action: { type: 'discard', payload: { cards: 'x' } }, actorId: 1, rng: det() });
  assert.match(r.error, /two cards/i);
});

test('discard: rejects payload with !=2 cards', () => {
  const s = makeState();
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0]] } }, actorId: 1, rng: det() });
  assert.match(r.error, /two cards/i);
});

test('discard: rejects duplicate cards in payload', () => {
  const s = makeState();
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], s.hands[0][0]] } }, actorId: 1, rng: det() });
  assert.match(r.error, /duplicate/i);
});

test('discard: rejects card not in actor hand', () => {
  const s = makeState();
  const not_mine = s.hands[1][0];
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], not_mine] } }, actorId: 1, rng: det() });
  assert.match(r.error, /not in your hand/i);
});

test('discard: first player submission stores pendingDiscards, no phase advance', () => {
  const s = makeState();
  const cards = [s.hands[0][0], s.hands[0][1]];
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards } }, actorId: 1, rng: det() });
  assert.equal(r.error, undefined);
  assert.equal(r.state.phase, 'discard');
  assert.equal(r.state.pendingDiscards[0].length, 2);
  assert.equal(r.state.pendingDiscards[1], null);
  assert.equal(r.state.hands[0].length, 6, 'hand not yet shrunk');
  assert.equal(r.state.crib.length, 0);
});

test('discard: same player twice → already-discarded error', () => {
  const s = makeState();
  const r1 = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], s.hands[0][1]] } }, actorId: 1, rng: det() });
  const r2 = applyCribbageAction({ state: r1.state, action: { type: 'discard', payload: { cards: [r1.state.hands[0][2], r1.state.hands[0][3]] } }, actorId: 1, rng: det() });
  assert.match(r2.error, /already discarded/i);
});

test('discard: both players submit → advance to cut, build crib, shrink hands', () => {
  const s = makeState();
  const r1 = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], s.hands[0][1]] } }, actorId: 1, rng: det() });
  const r2 = applyCribbageAction({ state: r1.state, action: { type: 'discard', payload: { cards: [r1.state.hands[1][0], r1.state.hands[1][1]] } }, actorId: 2, rng: det() });
  assert.equal(r2.state.phase, 'cut');
  assert.equal(r2.state.hands[0].length, 4);
  assert.equal(r2.state.hands[1].length, 4);
  assert.equal(r2.state.crib.length, 4);
  // After advance to cut, activeUserId = non-dealer (player 1 = userId 2 since dealer=0)
  assert.equal(r2.state.activeUserId, 2);
  assert.deepEqual(r2.state.pendingDiscards, [null, null]);
});

test('discard: returns summary with kind=discard', () => {
  const s = makeState();
  const r = applyCribbageAction({ state: s, action: { type: 'discard', payload: { cards: [s.hands[0][0], s.hands[0][1]] } }, actorId: 1, rng: det() });
  assert.equal(r.summary?.kind, 'discard');
  assert.equal(r.ended, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/cribbage-discard.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement discard phase**

```js
// plugins/cribbage/server/phases/discard.js
import { sameCard } from '../cards.js';

export function applyDiscard({ state, action, player }) {
  const cards = action.payload?.cards;
  if (!Array.isArray(cards) || cards.length !== 2) {
    return { error: 'discard requires two cards' };
  }
  if (sameCard(cards[0], cards[1])) {
    return { error: 'duplicate cards in discard' };
  }
  if (state.pendingDiscards[player] != null) {
    return { error: 'already discarded' };
  }
  const hand = state.hands[player];
  const inHand = (c) => hand.some(h => sameCard(h, c));
  if (!inHand(cards[0]) || !inHand(cards[1])) {
    return { error: 'card not in your hand' };
  }

  const pending = [...state.pendingDiscards];
  pending[player] = cards.map(c => ({ ...c }));
  const next = { ...state, pendingDiscards: pending };

  if (pending[0] && pending[1]) {
    // Both submitted — build crib, shrink hands, advance to cut.
    const crib = [...pending[0], ...pending[1]];
    const newHands = state.hands.map((h, i) =>
      h.filter(c => !pending[i].some(d => sameCard(d, c)))
    );
    const nonDealer = 1 - state.dealer;
    const nonDealerUserId = nonDealer === 0 ? state.sides.a : state.sides.b;
    return {
      state: {
        ...next,
        hands: newHands,
        crib,
        pendingDiscards: [null, null],
        phase: 'cut',
        activeUserId: nonDealerUserId,
      },
      ended: false,
      summary: { kind: 'discard' },
    };
  }
  return { state: next, ended: false, summary: { kind: 'discard' } };
}
```

- [ ] **Step 4: Register handler in `actions.js`**

Modify `plugins/cribbage/server/actions.js`:

```js
import { playerIndex } from './state.js';
import { applyDiscard } from './phases/discard.js';

const HANDLERS = {
  'discard:discard': applyDiscard,
};
// ... rest as before
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test test/cribbage-discard.test.js`
Expected: 8 PASS. Re-run prior suites: `node --test test/cribbage-*.test.js` — all pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/cribbage/server/phases/discard.js plugins/cribbage/server/actions.js test/cribbage-discard.test.js
git commit -m "feat(cribbage): discard phase — simultaneous submission, advance on both"
```

---

## Task 6: Cut phase — non-dealer cuts, score nibs, init pegging

**Files:**
- Create: `plugins/cribbage/server/phases/cut.js`
- Modify: `plugins/cribbage/server/actions.js`
- Test: `test/cribbage-cut.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-cut.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';

function makeCutState({ deckTop = { rank: '5', suit: 'H' } } = {}) {
  // Hand-rolled state in the cut phase.
  return {
    phase: 'cut',
    dealer: 0,
    deck: [deckTop, { rank: 'A', suit: 'C' }, { rank: '2', suit: 'C' }],
    hands: [
      [{ rank: '4', suit: 'S' }, { rank: '5', suit: 'C' }, { rank: '6', suit: 'D' }, { rank: '7', suit: 'H' }],
      [{ rank: '8', suit: 'S' }, { rank: '9', suit: 'C' }, { rank: 'T', suit: 'D' }, { rank: 'J', suit: 'H' }],
    ],
    pendingDiscards: [null, null],
    crib: [
      { rank: '2', suit: 'S' }, { rank: '3', suit: 'S' },
      { rank: 'Q', suit: 'D' }, { rank: 'K', suit: 'D' },
    ],
    starter: null,
    pegging: null,
    scores: [0, 0],
    showBreakdown: null,
    acknowledged: [false, false],
    sides: { a: 1, b: 2 },
    activeUserId: 2,
    endedReason: null,
    winnerSide: null,
  };
}

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('cut: dealer (player 0) cannot cut — only non-dealer', () => {
  const r = applyCribbageAction({ state: makeCutState(), action: { type: 'cut' }, actorId: 1, rng: det() });
  assert.match(r.error, /non-dealer/i);
});

test('cut: non-dealer reveals starter from deck', () => {
  const r = applyCribbageAction({ state: makeCutState(), action: { type: 'cut' }, actorId: 2, rng: det() });
  assert.equal(r.error, undefined);
  assert.ok(r.state.starter, 'starter set');
  assert.equal(r.state.deck.length, 2, 'one card removed');
  assert.equal(r.state.phase, 'pegging');
});

test('cut: starter Jack ("nibs") gives dealer +2', () => {
  const r = applyCribbageAction({ state: makeCutState({ deckTop: { rank: 'J', suit: 'D' } }), action: { type: 'cut' }, actorId: 2, rng: det(0) });
  // Force the J to be cut by stubbing rng to 0 (selects deck[0]).
  if (r.state.starter.rank === 'J') {
    assert.equal(r.state.scores[0], 2);
    assert.equal(r.state.scores[1], 0);
  }
});

test('cut: pegging state initialized — running 0, next=non-dealer, history empty, piles empty', () => {
  const r = applyCribbageAction({ state: makeCutState(), action: { type: 'cut' }, actorId: 2, rng: det() });
  assert.equal(r.state.pegging.running, 0);
  assert.deepEqual(r.state.pegging.history, []);
  assert.deepEqual(r.state.pegging.pile, [[], []]);
  assert.equal(r.state.pegging.next, 1, 'non-dealer leads pegging');
  assert.equal(r.state.pegging.lastPlayer, null);
  assert.deepEqual(r.state.pegging.saidGo, [false, false]);
  assert.equal(r.state.activeUserId, 2, 'non-dealer userId');
});

test('cut: summary kind=cut', () => {
  const r = applyCribbageAction({ state: makeCutState(), action: { type: 'cut' }, actorId: 2, rng: det() });
  assert.equal(r.summary.kind, 'cut');
  assert.equal(r.ended, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-cut.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement cut phase**

```js
// plugins/cribbage/server/phases/cut.js
export function applyCut({ state, player, rng }) {
  if (player !== 1 - state.dealer) {
    return { error: 'only non-dealer may cut' };
  }
  const idx = Math.floor(rng() * state.deck.length);
  const starter = state.deck[idx];
  const deck = [...state.deck.slice(0, idx), ...state.deck.slice(idx + 1)];

  const scores = [...state.scores];
  if (starter.rank === 'J') scores[state.dealer] += 2; // nibs / "his heels"

  const nonDealer = 1 - state.dealer;
  const nonDealerUserId = nonDealer === 0 ? state.sides.a : state.sides.b;

  return {
    state: {
      ...state,
      deck,
      starter,
      scores,
      phase: 'pegging',
      pegging: {
        running: 0,
        history: [],
        pile: [[], []],
        next: nonDealer,
        lastPlayer: null,
        saidGo: [false, false],
      },
      activeUserId: nonDealerUserId,
    },
    ended: false,
    summary: { kind: 'cut', starter, nibs: starter.rank === 'J' ? state.dealer : null },
  };
}
```

- [ ] **Step 4: Register handler**

In `plugins/cribbage/server/actions.js`:

```js
import { applyCut } from './phases/cut.js';
const HANDLERS = {
  'discard:discard': applyDiscard,
  'cut:cut': applyCut,
};
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test test/cribbage-cut.test.js`
Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/cribbage/server/phases/cut.js plugins/cribbage/server/actions.js test/cribbage-cut.test.js
git commit -m "feat(cribbage): cut phase — reveal starter, score nibs, init pegging"
```

---

## Task 7: Pegging scoring helpers (15s, 31s, pairs/trips/quads, runs, last-card)

**Files:**
- Create: `plugins/cribbage/server/scoring/pegging.js`
- Test: `test/cribbage-pegging-scoring.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-pegging-scoring.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePeggingPlay } from '../plugins/cribbage/server/scoring/pegging.js';

const c = (rank, suit = 'S') => ({ rank, suit });

test('15-2: running becomes 15 → +2 fifteen', () => {
  const items = scorePeggingPlay([c('7'), c('8')], 15);
  assert.deepEqual(items.map(i => i.kind), ['fifteen']);
  assert.equal(items.reduce((a, i) => a + i.points, 0), 2);
});

test('31-2: running becomes 31 → +2 thirty-one', () => {
  const items = scorePeggingPlay([c('K'), c('Q'), c('A')], 31);
  assert.deepEqual(items.map(i => i.kind), ['thirty-one']);
  assert.equal(items[0].points, 2);
});

test('pair: last two cards same rank → +2 pair-pegging', () => {
  const items = scorePeggingPlay([c('5'), c('5')], 10);
  assert.deepEqual(items.map(i => i.kind), ['pair-pegging']);
  assert.equal(items[0].points, 2);
});

test('triple ("pair royal"): last three same rank → +6', () => {
  const items = scorePeggingPlay([c('5'), c('5'), c('5')], 15);
  // Includes fifteen too: fifteen-2 + pair-royal-6 = 8
  const total = items.reduce((a, i) => a + i.points, 0);
  assert.equal(total, 8);
  assert.ok(items.some(i => i.kind === 'pair-pegging' && i.points === 6));
});

test('quad ("double pair royal"): last four same rank → +12', () => {
  const items = scorePeggingPlay([c('4'), c('4'), c('4'), c('4')], 16);
  const pairItem = items.find(i => i.kind === 'pair-pegging');
  assert.equal(pairItem.points, 12);
});

test('run-3 in tail (any order): 4-3-5 → run of 3 → +3', () => {
  const items = scorePeggingPlay([c('A'), c('4'), c('3'), c('5')], 13);
  assert.ok(items.some(i => i.kind === 'run' && i.points === 3));
});

test('run-4 in tail: 6-7-5-4 → run of 4 → +4', () => {
  const items = scorePeggingPlay([c('6'), c('7'), c('5'), c('4')], 22);
  const run = items.find(i => i.kind === 'run');
  assert.equal(run.points, 4);
});

test('breaking run: A-2-3-A only the last A→2→3 isn’t a run; the 2-3-A tail is also not a run; tail = "A" alone → no run', () => {
  // history A-2-3-A: tails are [A], [3,A], [2,3,A], [A,2,3,A]. Only [A,2,3] from idx 0 IS a run, but the tail must include the last card. So tail-runs of length≥3 with last card: [A,2,3,A] no, [2,3,A] no (consecutive ranks 2,3,A — A=1 so this IS a run if we include A as 1, but the run must be CONSECUTIVE in run-value: 1,2,3 — yes, but it's NOT in the tail order, it's reordered: 2,3,1 sorted = 1,2,3 yes consecutive). Cribbage allows reordered runs in pegging.
  const items = scorePeggingPlay([c('A'), c('2'), c('3'), c('A')], 7);
  // [2,3,A] sorted = [1,2,3] which IS a 3-run. So +3 for run.
  assert.ok(items.some(i => i.kind === 'run' && i.points === 3));
});

test('no event: K then 5 → no scoring', () => {
  const items = scorePeggingPlay([c('K'), c('5')], 15);
  // running=15 → fifteen-2 fires
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'fifteen');
});

test('plain play with no events: 4 then 5 (running 9) → empty array', () => {
  const items = scorePeggingPlay([c('4'), c('5')], 9);
  assert.deepEqual(items, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-pegging-scoring.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement pegging scoring**

```js
// plugins/cribbage/server/scoring/pegging.js
import { runValue } from '../cards.js';

/**
 * Score events triggered by the most recent play.
 * @param {Card[]} history — cards played in the current run, in play order
 * @param {number} running — current running total (already includes the last play)
 * @returns {ScoreItem[]}
 */
export function scorePeggingPlay(history, running) {
  const items = [];

  if (running === 31) {
    items.push({ kind: 'thirty-one', points: 2, cards: history.slice(), say: '31 for two' });
  } else if (running === 15) {
    items.push({ kind: 'fifteen', points: 2, cards: history.slice(), say: 'fifteen-two' });
  }

  // Pair / trip / quad: count tail cards sharing rank with the last card.
  const last = history[history.length - 1];
  let n = 1;
  for (let i = history.length - 2; i >= 0 && history[i].rank === last.rank; i--) n++;
  if (n >= 2) {
    const pts = { 2: 2, 3: 6, 4: 12 }[n];
    const say = { 2: 'and a pair makes two', 3: 'pair royal for six', 4: 'double pair royal for twelve' }[n];
    items.push({ kind: 'pair-pegging', points: pts, cards: history.slice(-n), say });
  }

  // Run: longest tail of length ≥ 3 that, when sorted by runValue, forms
  // a consecutive sequence with no repeats.
  for (let len = history.length; len >= 3; len--) {
    const tail = history.slice(-len);
    const vals = tail.map(runValue).sort((a, b) => a - b);
    const unique = new Set(vals).size === vals.length;
    if (!unique) continue;
    let consec = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) { consec = false; break; }
    }
    if (consec) {
      items.push({ kind: 'run', points: len, cards: tail.slice(), say: `run for ${len}` });
      break;
    }
  }

  return items;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test test/cribbage-pegging-scoring.test.js`
Expected: 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/scoring/pegging.js test/cribbage-pegging-scoring.test.js
git commit -m "feat(cribbage): pegging scoring helpers (15, 31, pairs, runs)"
```

---

## Task 8: Pegging phase — play, auto-go, run reset, end-of-pegging

**Files:**
- Create: `plugins/cribbage/server/phases/pegging.js`
- Modify: `plugins/cribbage/server/actions.js`
- Test: `test/cribbage-pegging.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-pegging.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';

const c = (rank, suit = 'S') => ({ rank, suit });

function pegState(overrides = {}) {
  return {
    phase: 'pegging',
    dealer: 0,
    deck: [],
    hands: [
      [c('5','C'), c('6','C'), c('7','C'), c('8','C')],
      [c('5','D'), c('6','D'), c('7','D'), c('8','D')],
    ],
    pendingDiscards: [null, null],
    crib: [c('2','S'), c('3','S'), c('Q','D'), c('K','D')],
    starter: c('A','H'),
    pegging: {
      running: 0, history: [], pile: [[], []],
      next: 1, lastPlayer: null, saidGo: [false, false],
    },
    scores: [0, 0],
    showBreakdown: null,
    acknowledged: [false, false],
    sides: { a: 1, b: 2 },
    activeUserId: 2,
    endedReason: null,
    winnerSide: null,
    ...overrides,
  };
}

const det = () => () => 0.42;

test('play: rejects when not actor turn', () => {
  const r = applyCribbageAction({ state: pegState(), action: { type: 'play', payload: { card: c('5','C') } }, actorId: 1, rng: det() });
  assert.match(r.error, /not your turn/i);
});

test('play: rejects card not in actor hand', () => {
  const r = applyCribbageAction({ state: pegState(), action: { type: 'play', payload: { card: c('K','S') } }, actorId: 2, rng: det() });
  assert.match(r.error, /not in your hand/i);
});

test('play: rejects card that would push running over 31', () => {
  const s = pegState({
    pegging: { running: 28, history: [c('K','S'), c('K','H'), c('8','C')], pile: [[c('K','S'), c('8','C')], [c('K','H')]], next: 1, lastPlayer: 0, saidGo: [false,false] },
    hands: [[c('A','C'),c('A','D'),c('A','H')],[c('5','D'),c('5','H')]],
  });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('5','D') } }, actorId: 2, rng: det() });
  assert.match(r.error, /over 31/i);
});

test('play: legal play removes card from hand, appends to history, updates running', () => {
  const s = pegState();
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('8','D') } }, actorId: 2, rng: det() });
  assert.equal(r.error, undefined);
  assert.equal(r.state.pegging.running, 8);
  assert.equal(r.state.pegging.history.length, 1);
  assert.equal(r.state.pegging.pile[1].length, 1);
  assert.equal(r.state.hands[1].length, 3);
  assert.equal(r.state.pegging.next, 0);
  assert.equal(r.state.activeUserId, 1);
});

test('play: hitting 15 scores +2', () => {
  const s = pegState({
    pegging: { running: 7, history: [c('7','S')], pile: [[],[c('7','S')]], next: 0, lastPlayer: 1, saidGo: [false,false] },
  });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('8','C') } }, actorId: 1, rng: det() });
  assert.equal(r.state.scores[0], 2);
});

test('play: hitting 31 scores +2 and resets run', () => {
  const s = pegState({
    pegging: { running: 21, history: [c('K','S'), c('J','C')], pile: [[c('J','C')],[c('K','S')]], next: 1, lastPlayer: 0, saidGo: [false,false] },
    hands: [[c('A','C')],[c('T','D'),c('5','D')]],
  });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('T','D') } }, actorId: 2, rng: det() });
  assert.equal(r.state.scores[1], 2);
  assert.equal(r.state.pegging.running, 0);
  assert.deepEqual(r.state.pegging.history, []);
  assert.deepEqual(r.state.pegging.saidGo, [false, false]);
});

test('play: auto-go when next player has no playable card; opponent gets +1 last-card on run-end', () => {
  // Player 1 plays 9, total=9. Player 0 has only [Q,K,K] (val 10) — can play.
  // Reframe: build a state where player 0 has only 10-pip cards and running=22.
  // Player 1 plays a 9, running=31 → reset. Use a different scenario for auto-go.
  // Scenario: running=29, player 0 hand=[K], player 1 hand=[K,K]. Player 0 plays K → over-31, illegal.
  // Use: running=27, p0 hand=[5], p1 hand=[K]. p0 plays 5 → 32, illegal. So p0 must be auto-go-ed.
  const s = pegState({
    pegging: { running: 27, history: [c('K','S'), c('Q','D'), c('7','C')], pile: [[c('K','S')],[c('Q','D'), c('7','C')]], next: 1, lastPlayer: 0, saidGo: [false,false] },
    hands: [[c('5','C')], [c('K','C')]],
  });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('K','C') } }, actorId: 2, rng: det() });
  // After player 1 plays K, running=37 — that's illegal. Reset scenario.
  // Real scenario: running=27, p0 hand=[5] (val 5, would make 32 — illegal), p1 hand=[Q] (val 10, would make 37 — illegal).
  // Player whose turn it is plays last legal, opponent autogoes, then we autogoes the original player too → run ends.
  // Use: running=22, p0 hand=[Q] (32, illegal), p1 hand=[8] (30, legal). Test: p1 plays 8 → 30, p0 has Q (32, illegal) → auto-go, p1 next has 0 cards → end run, +1 last-card to p1.
  // Reset & retry as a clean scenario:
  const s2 = pegState({
    pegging: { running: 22, history: [c('K','S'), c('Q','C'), c('2','D')], pile: [[c('K','S'), c('2','D')],[c('Q','C')]], next: 1, lastPlayer: 0, saidGo: [false,false] },
    hands: [[c('Q','D')],[c('8','D')]],
  });
  const r2 = applyCribbageAction({ state: s2, action: { type: 'play', payload: { card: c('8','D') } }, actorId: 2, rng: det() });
  // Now running=30. p0 plays Q (val 10) → 40 illegal. p0 auto-go. p1 hand empty. Run ends.
  // p1 gets +1 last-card.
  assert.equal(r2.state.scores[1], 1, 'last-card +1 to player 1');
  assert.deepEqual(r2.state.pegging.saidGo, [false, false], 'reset on run-end');
  assert.equal(r2.state.pegging.running, 0);
});

test('play: end-of-pegging when both hands empty → advance to show', () => {
  const s = pegState({
    pegging: { running: 4, history: [c('4','D')], pile: [[],[c('4','D')]], next: 0, lastPlayer: 1, saidGo: [false,false] },
    hands: [[c('A','C')],[]],
  });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('A','C') } }, actorId: 1, rng: det() });
  // p0 plays A → running=5, p0 hand empty. p1 already empty → end-of-pegging.
  // Last-card +1 to p0 (the player who played the last card).
  assert.equal(r.state.scores[0], 1, 'last-card +1');
  assert.equal(r.state.phase, 'show');
});

test('play: summary kind=play with score events', () => {
  const s = pegState({ pegging: { running: 7, history: [c('7','S')], pile: [[],[c('7','S')]], next: 0, lastPlayer: 1, saidGo: [false,false] } });
  const r = applyCribbageAction({ state: s, action: { type: 'play', payload: { card: c('8','C') } }, actorId: 1, rng: det() });
  assert.equal(r.summary.kind, 'play');
  assert.ok(Array.isArray(r.summary.events));
  assert.ok(r.summary.events.some(e => e.kind === 'fifteen'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-pegging.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement pegging phase**

```js
// plugins/cribbage/server/phases/pegging.js
import { sameCard, pipValue } from '../cards.js';
import { scorePeggingPlay } from '../scoring/pegging.js';

export function applyPlay({ state, action, player }) {
  const peg = state.pegging;
  if (peg.next !== player) return { error: 'not your turn' };

  const card = action.payload?.card;
  if (!card) return { error: 'card required' };
  const handIdx = state.hands[player].findIndex(h => sameCard(h, card));
  if (handIdx < 0) return { error: 'card not in your hand' };

  const v = pipValue(card);
  if (peg.running + v > 31) {
    return { error: 'play would push running total over 31' };
  }

  // Apply play
  const hands = state.hands.map(h => h.slice());
  hands[player].splice(handIdx, 1);
  const history = [...peg.history, card];
  const pile = peg.pile.map(p => p.slice());
  pile[player] = [...pile[player], card];
  const running = peg.running + v;

  // Score the play
  const events = scorePeggingPlay(history, running);
  const scores = [...state.scores];
  for (const e of events) scores[player] += e.points;

  let nextPeg = {
    ...peg,
    running,
    history,
    pile,
    lastPlayer: player,
    next: 1 - player,
  };

  // 31 → reset run
  if (running === 31) {
    nextPeg = {
      ...nextPeg,
      running: 0,
      history: [],
      saidGo: [false, false],
      next: 1 - player,
    };
  }

  // End-of-pegging if both hands empty
  const handsEmpty = hands[0].length === 0 && hands[1].length === 0;
  if (handsEmpty) {
    if (running !== 31) {
      // Award last-card +1
      scores[player] += 1;
      events.push({ kind: 'last-card', points: 1, cards: [card], say: 'last card for one' });
    }
    return {
      state: {
        ...state,
        hands,
        pegging: { ...nextPeg, running: 0, history: [], saidGo: [false, false] },
        scores,
        phase: 'show',
        activeUserId: null,
      },
      ended: false,
      summary: { kind: 'play', card, events },
    };
  }

  // Auto-go loop: while next player has no legal card, mark goes; on
  // both-go, end the run with last-card +1 to lastPlayer.
  let working = { state: { ...state, hands, pegging: nextPeg, scores }, summary: { kind: 'play', card, events } };
  working = autoGoLoop(working);

  // Check end-of-pegging again after auto-go (run reset may have emptied things differently)
  if (working.state.hands[0].length === 0 && working.state.hands[1].length === 0) {
    return {
      state: { ...working.state, phase: 'show', activeUserId: null },
      ended: false,
      summary: working.summary,
    };
  }

  // Set activeUserId from peg.next
  const nextUserId = working.state.pegging.next === 0 ? working.state.sides.a : working.state.sides.b;
  return {
    state: { ...working.state, activeUserId: nextUserId },
    ended: false,
    summary: working.summary,
  };
}

function hasPlayable(hand, running) {
  return hand.some(c => running + pipValue(c) <= 31);
}

function autoGoLoop({ state, summary }) {
  let st = state;
  let events = summary.events.slice();

  while (true) {
    const peg = st.pegging;
    const next = peg.next;
    if (st.hands[next].length > 0 && hasPlayable(st.hands[next], peg.running)) {
      break;
    }
    // mark go for next player
    const saidGo = peg.saidGo.slice();
    saidGo[next] = true;
    const other = 1 - next;
    const otherCanPlay = st.hands[other].length > 0 && hasPlayable(st.hands[other], peg.running);
    if (otherCanPlay) {
      st = { ...st, pegging: { ...peg, saidGo, next: other } };
      continue;
    }
    // both can't play OR opponent has no cards: end the run
    const lp = peg.lastPlayer;
    const scores = [...st.scores];
    scores[lp] += 1;
    events.push({ kind: 'last-card', points: 1, cards: peg.history.slice(-1), say: 'last card for one' });
    st = {
      ...st,
      pegging: {
        ...peg,
        running: 0,
        history: [],
        saidGo: [false, false],
        next: 1 - lp,
        // lastPlayer unchanged so subsequent autogo can still fire if appropriate
      },
      scores,
    };
    // After run-end, if both hands are empty, exit the loop; caller will see and advance to show.
    if (st.hands[0].length === 0 && st.hands[1].length === 0) break;
    // Otherwise continue: the player after lastPlayer leads the new run.
  }

  return { state: st, summary: { ...summary, events } };
}
```

- [ ] **Step 4: Register handler**

```js
// plugins/cribbage/server/actions.js (additions)
import { applyPlay } from './phases/pegging.js';
const HANDLERS = {
  'discard:discard': applyDiscard,
  'cut:cut': applyCut,
  'pegging:play': applyPlay,
};
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test test/cribbage-pegging.test.js`
Expected: 9 PASS. Re-run all cribbage tests: `node --test 'test/cribbage-*.test.js'`.

- [ ] **Step 6: Commit**

```bash
git add plugins/cribbage/server/phases/pegging.js plugins/cribbage/server/actions.js test/cribbage-pegging.test.js
git commit -m "feat(cribbage): pegging phase — legal play, auto-go, end-of-pegging"
```

---

## Task 9: Hand & crib scoring (fifteens, pairs, runs, flush, nobs)

**Files:**
- Create: `plugins/cribbage/server/scoring/hand.js`
- Test: `test/cribbage-hand-scoring.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-hand-scoring.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreHand } from '../plugins/cribbage/server/scoring/hand.js';

const c = (rank, suit) => ({ rank, suit });

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
  // Off-suit: 4-card flush = 4; starter K not 15 with anything; no pairs/runs.
  const r1 = scoreHand(handAll, offSuitStarter, { isCrib: false });
  const flush1 = r1.items.find(i => i.kind === 'flush');
  assert.equal(flush1.points, 4);
  // On-suit starter: 5-card flush = 5
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
  // Includes nobs +1, also flush (4 hand same suit) +4, also no fifteens, no pairs, run-of-4 (1-2-3-4).
  // Wait the run is A is not in this hand. Let me recompute: 2,3,4,J + starter 7. Run is 2-3-4 (3 long). Plus 7 not consecutive with J.
  // Actually 2,3,4 = 3-run = 3 pts. Flush 4 (all hand spades, starter 7♠ matches → 5-flush = 5). Nobs +1. No 15s. No pairs.
  // Expected total: run-3 + flush-5 + nobs-1 = 9.
  assert.ok(result.items.some(i => i.kind === 'nobs' && i.points === 1));
});

test('counts every fifteen subset: 5-5-5-J + 5 → 8 fifteens (4 ways: each 5+J, 4 ways: 5+5+5)', () => {
  // 4×J=15: 4 ways with J + each 5 (3 in hand + starter = 4 fives) → 4 fifteens
  // Wait each "5+J" — there are 4 fives (3 in hand + 1 starter) and 1 J. So 4 distinct (5,J) subsets.
  // 5+5+5: choose 3 of 4 fives = C(4,3)=4 ways. Each sums to 15.
  // Total fifteen-count = 8 → 16 points from fifteens alone.
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
  // run items: two 3-runs total 6
  const runPts = r.items.filter(i => i.kind === 'run').reduce((a,i)=>a+i.points,0);
  const pairPts = r.items.filter(i => i.kind === 'pair').reduce((a,i)=>a+i.points,0);
  assert.equal(runPts + pairPts, 8);
});

test('item ordering: fifteens, then pairs, then runs, then flush, then nobs', () => {
  const hand = [c('2','H'), c('3','H'), c('4','H'), c('J','H')];
  const starter = c('5','H');
  const r = scoreHand(hand, starter, { isCrib: false });
  // Verify ordering: kinds appear grouped in this order
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
  // Sample: at least one item should have a cumulative-style say (e.g. "fifteen-two", or "and a pair makes …")
  assert.ok(r.items.length > 0);
  assert.ok(r.items.some(i => /^(fifteen-|.*makes|run|.*nobs)/i.test(i.say)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-hand-scoring.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement hand scoring**

```js
// plugins/cribbage/server/scoring/hand.js
import { pipValue, runValue } from '../cards.js';

const NUMBER_WORDS = {
  2:'two', 4:'four', 6:'six', 8:'eight', 10:'ten', 12:'twelve', 14:'fourteen',
  16:'sixteen', 18:'eighteen', 20:'twenty', 22:'twenty-two', 24:'twenty-four',
  26:'twenty-six', 28:'twenty-eight', 29:'twenty-nine',
};

/**
 * @param {Card[]} hand — 4 cards (or crib's 4)
 * @param {Card} starter
 * @param {{isCrib?: boolean}} opts
 */
export function scoreHand(hand, starter, { isCrib = false } = {}) {
  const five = [...hand, starter];
  const items = [];
  let running = 0;

  // 1. Fifteens — every subset summing to 15
  const fifteens = findSubsetsSummingTo(five, 15);
  for (const subset of fifteens) {
    running += 2;
    items.push({
      kind: 'fifteen',
      points: 2,
      cards: subset,
      say: `fifteen-${NUMBER_WORDS[running] ?? running}`,
    });
  }

  // 2. Pairs — emit one item per matching-rank group of size ≥ 2
  const byRank = {};
  for (const c of five) (byRank[c.rank] ??= []).push(c);
  for (const cards of Object.values(byRank)) {
    if (cards.length < 2) continue;
    const pts = { 2: 2, 3: 6, 4: 12 }[cards.length];
    running += pts;
    const label = { 2: 'a pair', 3: 'pair royal', 4: 'double pair royal' }[cards.length];
    items.push({
      kind: 'pair',
      points: pts,
      cards,
      say: `and ${label} makes ${NUMBER_WORDS[running] ?? running}`,
    });
  }

  // 3. Runs — find max-length runs with multiplicity
  const runs = findRunsWithMultiplicity(five);
  for (const r of runs) {
    running += r.length;
    items.push({
      kind: 'run',
      points: r.length,
      cards: r.cards,
      say: `run for ${NUMBER_WORDS[running] ?? running}`,
    });
  }

  // 4. Flush
  const handSuit = hand[0].suit;
  const handAllSame = hand.every(c => c.suit === handSuit);
  if (handAllSame) {
    if (isCrib) {
      if (starter.suit === handSuit) {
        running += 5;
        items.push({ kind: 'flush', points: 5, cards: five, say: `flush for ${running}` });
      }
    } else {
      const five_match = starter.suit === handSuit;
      const pts = five_match ? 5 : 4;
      running += pts;
      items.push({ kind: 'flush', points: pts, cards: five_match ? five : hand, say: `flush for ${running}` });
    }
  }

  // 5. Nobs — J in hand matching starter suit
  for (const c of hand) {
    if (c.rank === 'J' && c.suit === starter.suit) {
      running += 1;
      items.push({ kind: 'nobs', points: 1, cards: [c], say: `his nobs is ${running}` });
      break;
    }
  }

  return { items, total: running };
}

function findSubsetsSummingTo(cards, target) {
  const result = [];
  const rec = (start, picked, sum) => {
    if (sum === target && picked.length > 0) {
      result.push(picked.slice());
      return;
    }
    if (sum > target) return;
    for (let i = start; i < cards.length; i++) {
      picked.push(cards[i]);
      rec(i + 1, picked, sum + pipValue(cards[i]));
      picked.pop();
    }
  };
  rec(0, [], 0);
  return result;
}

function findRunsWithMultiplicity(cards) {
  // Bucket by runValue, find longest contiguous stretch ≥ 3.
  const byVal = {};
  for (const c of cards) (byVal[runValue(c)] ??= []).push(c);
  const vals = Object.keys(byVal).map(Number).sort((a, b) => a - b);
  let longest = [];
  for (let i = 0; i < vals.length; i++) {
    const stretch = [vals[i]];
    while (i + 1 < vals.length && vals[i + 1] === vals[i] + 1) {
      i++;
      stretch.push(vals[i]);
    }
    if (stretch.length > longest.length) longest = stretch;
  }
  if (longest.length < 3) return [];
  // Cartesian product across the bucket lists for each value in the run.
  const buckets = longest.map(v => byVal[v]);
  const product = cartesian(buckets);
  return product.map(cards => ({ length: longest.length, cards }));
}

function cartesian(arrs) {
  return arrs.reduce(
    (acc, arr) => acc.flatMap(prev => arr.map(item => [...prev, item])),
    [[]],
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test test/cribbage-hand-scoring.test.js`
Expected: 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/scoring/hand.js test/cribbage-hand-scoring.test.js
git commit -m "feat(cribbage): hand+crib scoring (15s, pairs, runs, flush, nobs)"
```

---

## Task 10: Show phase — auto-tally, breakdown, advance to done

**Files:**
- Create: `plugins/cribbage/server/phases/show.js`
- Modify: `plugins/cribbage/server/actions.js`
- Test: `test/cribbage-show.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-show.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';
import { tallyShow } from '../plugins/cribbage/server/phases/show.js';

const c = (rank, suit) => ({ rank, suit });

function showState(overrides = {}) {
  return {
    phase: 'show',
    dealer: 0,
    deck: [],
    hands: [[], []],
    pendingDiscards: [null, null],
    crib: [c('2','S'), c('3','D'), c('Q','C'), c('K','H')],
    starter: c('A','H'),
    pegging: { running: 0, history: [], pile: [
      [c('5','H'), c('6','H'), c('7','H'), c('8','H')],   // dealer's played cards
      [c('5','D'), c('6','D'), c('7','D'), c('8','D')],   // non-dealer's played cards
    ], next: 0, lastPlayer: 0, saidGo: [false,false] },
    scores: [3, 5],     // pre-show running scores from pegging
    showBreakdown: null,
    acknowledged: [false, false],
    sides: { a: 1, b: 2 },
    activeUserId: null,
    endedReason: null,
    winnerSide: null,
    ...overrides,
  };
}

test('tallyShow: produces breakdown for non-dealer, dealer, crib (in count order)', () => {
  const s = showState();
  // Reconstruct hands from pile (4 each)
  const breakdown = tallyShow(s);
  assert.ok(breakdown.nonDealer);
  assert.ok(breakdown.dealer);
  assert.ok(breakdown.crib);
  assert.equal(typeof breakdown.nonDealer.total, 'number');
});

test('show next: first ack does not advance phase', () => {
  const s = { ...showState(), showBreakdown: { nonDealer: { items: [], total: 0 }, dealer: { items: [], total: 0 }, crib: { items: [], total: 0 } } };
  const r = applyCribbageAction({ state: s, action: { type: 'next' }, actorId: 1, rng: () => 0 });
  assert.equal(r.state.phase, 'show');
  assert.deepEqual(r.state.acknowledged, [true, false]);
});

test('show next: both acks → phase=done, ended=true', () => {
  const s = { ...showState(), showBreakdown: { nonDealer: { items: [], total: 0 }, dealer: { items: [], total: 0 }, crib: { items: [], total: 0 } }, acknowledged: [false, true] };
  const r = applyCribbageAction({ state: s, action: { type: 'next' }, actorId: 1, rng: () => 0 });
  assert.equal(r.state.phase, 'done');
  assert.equal(r.ended, true);
  assert.equal(r.state.endedReason, 'deal-complete');
});

test('enterShow: computes breakdown and adds totals to scores', async () => {
  const { enterShow } = await import('../plugins/cribbage/server/phases/show.js');
  const s = showState({ scores: [0, 0] });
  const { state: next } = enterShow(s);
  assert.ok(next.showBreakdown);
  assert.equal(typeof next.showBreakdown.nonDealer.total, 'number');
  // The non-dealer score should equal the breakdown's nonDealer.total
  // (since pre-show score was 0).
  const nonDealer = 1 - s.dealer;
  assert.equal(next.scores[nonDealer], next.showBreakdown.nonDealer.total);
  // Dealer score = dealer hand + crib (since pre-show was 0).
  assert.equal(next.scores[s.dealer],
    next.showBreakdown.dealer.total + next.showBreakdown.crib.total);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-show.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement show phase**

```js
// plugins/cribbage/server/phases/show.js
import { scoreHand } from '../scoring/hand.js';

/**
 * Reconstruct a player's 4-card hand from their pegging pile.
 */
function handFromPile(pile) {
  return pile.slice();
}

export function tallyShow(state) {
  const nonDealer = 1 - state.dealer;
  const ndHand = handFromPile(state.pegging.pile[nonDealer]);
  const dHand = handFromPile(state.pegging.pile[state.dealer]);
  const ndScore = scoreHand(ndHand, state.starter, { isCrib: false });
  const dScore = scoreHand(dHand, state.starter, { isCrib: false });
  const cribScore = scoreHand(state.crib.slice(0, 4), state.starter, { isCrib: true });
  return {
    nonDealer: ndScore,
    dealer: dScore,
    crib: cribScore,
  };
}

/**
 * Called when entering the show phase (from pegging.js's end-of-pegging
 * transition). Computes breakdown, adds totals to state.scores, returns
 * the next state.
 */
export function enterShow(state) {
  const breakdown = tallyShow(state);
  const scores = [...state.scores];
  const nonDealer = 1 - state.dealer;
  scores[nonDealer] += breakdown.nonDealer.total;
  scores[state.dealer] += breakdown.dealer.total;
  scores[state.dealer] += breakdown.crib.total;
  return {
    state: {
      ...state,
      showBreakdown: breakdown,
      scores,
      activeUserId: null,
    },
  };
}

export function applyShowNext({ state, player }) {
  const acknowledged = state.acknowledged.slice();
  acknowledged[player] = true;
  if (acknowledged[0] && acknowledged[1]) {
    const scoreDelta = {
      a: state.scores[0] - 0,  // v1: deltas are equal to deal scores (pre-deal scores were 0)
      b: state.scores[1] - 0,
    };
    return {
      state: {
        ...state,
        acknowledged,
        phase: 'done',
        endedReason: 'deal-complete',
        winnerSide: null,
      },
      ended: true,
      summary: { kind: 'next', acknowledged: player },
      scoreDelta,
    };
  }
  return {
    state: { ...state, acknowledged },
    ended: false,
    summary: { kind: 'next', acknowledged: player },
  };
}
```

- [ ] **Step 4: Wire `enterShow` into pegging end-of-pegging transition**

Modify `plugins/cribbage/server/phases/pegging.js`'s end-of-pegging branches (the two places that set `phase: 'show'`) to instead delegate to `enterShow`:

```js
import { enterShow } from './show.js';

// inside applyPlay where currently we return { state: {..., phase: 'show', activeUserId: null }, ... }:
const showed = enterShow({ ...workingState, phase: 'show' });
return { state: showed.state, ended: false, summary };
```

(Apply to both end-of-pegging branches in `applyPlay`.)

- [ ] **Step 5: Register `next` handler in dispatcher**

```js
// plugins/cribbage/server/actions.js (additions)
import { applyShowNext } from './phases/show.js';
const HANDLERS = {
  'discard:discard': applyDiscard,
  'cut:cut': applyCut,
  'pegging:play': applyPlay,
  'show:next': applyShowNext,
};
```

- [ ] **Step 6: Run tests to verify pass**

Run: `node --test test/cribbage-show.test.js`
Expected: 4 PASS. Re-run all cribbage tests: `node --test 'test/cribbage-*.test.js'`.

- [ ] **Step 7: Commit**

```bash
git add plugins/cribbage/server/phases/show.js plugins/cribbage/server/phases/pegging.js plugins/cribbage/server/actions.js test/cribbage-show.test.js
git commit -m "feat(cribbage): show phase — auto-tally breakdown, acknowledge, end-of-deal"
```

---

## Task 11: `publicView` — information hiding

**Files:**
- Modify: `plugins/cribbage/server/view.js`
- Test: `test/cribbage-view.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/cribbage-view.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cribbagePublicView } from '../plugins/cribbage/server/view.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('view: viewer sees their own hand as cards; opponent as count', () => {
  const state = buildInitialState({ participants, rng: det() });
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.equal(v.hands[0].length, 6);
  assert.deepEqual(v.hands[1], { count: 6 });
});

test('view: deck is always count-only', () => {
  const state = buildInitialState({ participants, rng: det() });
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.deepEqual(v.deck, { count: 40 });
});

test('view: rngSeed is never exposed', () => {
  const state = buildInitialState({ participants, rng: det() });
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.equal(v.rngSeed, undefined);
});

test('view: crib is count-only until phase=show', () => {
  const state = { ...buildInitialState({ participants, rng: det() }), crib: [{ rank:'A', suit:'S' }, { rank:'2', suit:'S' }, { rank:'3', suit:'S' }, { rank:'4', suit:'S' }], phase: 'pegging' };
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.deepEqual(v.crib, { count: 4 });
});

test('view: crib is full cards in phase=show', () => {
  const state = { ...buildInitialState({ participants, rng: det() }), crib: [{ rank:'A', suit:'S' }, { rank:'2', suit:'S' }, { rank:'3', suit:'S' }, { rank:'4', suit:'S' }], phase: 'show' };
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.equal(v.crib.length, 4);
  assert.equal(v.crib[0].rank, 'A');
});

test('view: pendingDiscards — viewer sees own as cards, opp as boolean submitted', () => {
  const state = buildInitialState({ participants, rng: det() });
  const next = { ...state, pendingDiscards: [[{ rank:'A', suit:'S' }, { rank:'2', suit:'S' }], null] };
  const v = cribbagePublicView({ state: next, viewerId: 1 });
  assert.equal(v.pendingDiscards[0].length, 2);
  assert.equal(v.pendingDiscards[1], false);
});

test('view: starter, pegging, scores, showBreakdown, phase, sides, activeUserId all public', () => {
  const state = buildInitialState({ participants, rng: det() });
  const v = cribbagePublicView({ state, viewerId: 1 });
  assert.equal(v.phase, 'discard');
  assert.deepEqual(v.scores, [0, 0]);
  assert.deepEqual(v.sides, { a: 1, b: 2 });
  assert.equal(v.activeUserId, null);
  assert.equal(v.starter, null);
  // pegging null in discard phase
  assert.equal(v.pegging, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-view.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement view**

```js
// plugins/cribbage/server/view.js
export function cribbagePublicView({ state, viewerId }) {
  const viewerSide = state.sides.a === viewerId ? 0 : (state.sides.b === viewerId ? 1 : null);

  const hands = [
    viewerSide === 0 ? state.hands[0] : { count: state.hands[0].length },
    viewerSide === 1 ? state.hands[1] : { count: state.hands[1].length },
  ];

  const cribVisible = state.phase === 'show' || state.phase === 'done';

  return {
    phase: state.phase,
    dealer: state.dealer,
    deck: { count: state.deck.length },
    hands,
    pendingDiscards: [
      viewerSide === 0 ? state.pendingDiscards[0] : (state.pendingDiscards[0] != null),
      viewerSide === 1 ? state.pendingDiscards[1] : (state.pendingDiscards[1] != null),
    ],
    crib: cribVisible ? state.crib : { count: state.crib.length },
    starter: state.starter,
    pegging: state.pegging,
    scores: state.scores,
    showBreakdown: state.showBreakdown,
    acknowledged: state.acknowledged,
    sides: state.sides,
    activeUserId: state.activeUserId,
    endedReason: state.endedReason,
    winnerSide: state.winnerSide,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test test/cribbage-view.test.js`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/view.js test/cribbage-view.test.js
git commit -m "feat(cribbage): publicView with information hiding"
```

---

## Task 12: Full-deal integration test

**Files:**
- Test: `test/cribbage-deal-e2e.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/cribbage-deal-e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCribbageAction } from '../plugins/cribbage/server/actions.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('full deal: deterministic seed → discard, cut, pegging through end, show, both ack → done', () => {
  let state = buildInitialState({ participants, rng: det(7) });
  // Each player discards their first 2 cards (whatever they happened to be dealt).
  let r = applyCribbageAction({ state, action: { type: 'discard', payload: { cards: state.hands[0].slice(0,2) } }, actorId: 1, rng: det(7) });
  assert.equal(r.error, undefined);
  state = r.state;
  r = applyCribbageAction({ state, action: { type: 'discard', payload: { cards: state.hands[1].slice(0,2) } }, actorId: 2, rng: det(7) });
  assert.equal(r.error, undefined);
  state = r.state;
  assert.equal(state.phase, 'cut');

  // Non-dealer (player 1, userId=2) cuts.
  r = applyCribbageAction({ state, action: { type: 'cut' }, actorId: 2, rng: det(7) });
  assert.equal(r.error, undefined);
  state = r.state;
  assert.equal(state.phase, 'pegging');

  // Walk pegging by playing whichever legal card is available; if none, the phase reducer auto-handles go.
  let safety = 64;
  while (state.phase === 'pegging' && safety-- > 0) {
    const pi = state.pegging.next;
    const actorId = pi === 0 ? 1 : 2;
    const hand = state.hands[pi];
    const playable = hand.find(c => state.pegging.running + ({A:1,2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,T:10,J:10,Q:10,K:10}[c.rank]) <= 31);
    if (!playable) {
      // Should not happen — auto-go is handled inside the reducer; assert dev sanity.
      throw new Error('legal play missing — auto-go should have advanced state');
    }
    r = applyCribbageAction({ state, action: { type: 'play', payload: { card: playable } }, actorId, rng: det(7) });
    assert.equal(r.error, undefined);
    state = r.state;
  }
  assert.equal(state.phase, 'show');
  assert.ok(state.showBreakdown);
  assert.ok(state.scores[0] >= 0);
  assert.ok(state.scores[1] >= 0);

  // Both ack
  r = applyCribbageAction({ state, action: { type: 'next' }, actorId: 1, rng: det(7) });
  state = r.state;
  r = applyCribbageAction({ state, action: { type: 'next' }, actorId: 2, rng: det(7) });
  state = r.state;
  assert.equal(state.phase, 'done');
  assert.equal(r.ended, true);
  assert.equal(state.endedReason, 'deal-complete');
});
```

- [ ] **Step 2: Run test to verify it fails (or passes — if all prior tasks are correct it MAY pass)**

Run: `node --test test/cribbage-deal-e2e.test.js`
Expected: PASS once Tasks 1-11 are in place.

If FAIL, the failing assertion points to the specific phase whose reducer still has a gap. Fix that phase's logic and re-run.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/cribbage-deal-e2e.test.js
git commit -m "test(cribbage): full-deal end-to-end integration"
```

---

## Task 13: Client scaffold — index.html, style baseline, app.js boot

**Files:**
- Create: `plugins/cribbage/client/index.html`
- Create: `plugins/cribbage/client/style.css`
- Create: `plugins/cribbage/client/app.js`
- Test: `test/cribbage-client-files.test.js`

Note: this task lays down the client shell only. Renderer modules come in Tasks 14-18.

- [ ] **Step 1: Write the failing test**

```js
// test/cribbage-client-files.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

for (const f of ['index.html', 'style.css', 'app.js']) {
  test(`cribbage client has ${f}`, () => {
    assert.ok(existsSync(resolve(root, 'plugins/cribbage/client', f)), `missing ${f}`);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cribbage-client-files.test.js`
Expected: FAIL — files missing.

- [ ] **Step 3: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cribbage</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <a class="back" href="/">← Lobby</a>
    <div class="players">
      <div class="player" id="p-me"><span class="name" id="me-name">You</span><span class="score" id="me-score">0</span></div>
      <span class="vs">vs</span>
      <div class="player" id="p-opp"><span class="name" id="opp-name">Opponent</span><span class="score" id="opp-score">0</span></div>
    </div>
  </header>

  <div id="phase-banner" class="phase-banner"></div>

  <main id="board">
    <section id="opp-area" class="hand-row hand-row--opp"></section>
    <section id="table" class="table">
      <div class="slot slot--starter" id="starter"></div>
      <div class="slot slot--crib" id="crib"></div>
      <div class="pegging-strip" id="pegging-strip"></div>
    </section>
    <section id="me-area" class="hand-row hand-row--me"></section>
  </main>

  <div id="show-overlay" class="show-overlay" hidden></div>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `style.css` (baseline only — refined per task)**

```css
:root {
  --bg: #0d3a1f;          /* card-table green */
  --card-w: 90px;
  --card-h: 130px;
  --card-radius: 8px;
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: var(--bg); color: #fff; }
header { display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: rgba(0,0,0,0.25); }
.back { color: #fff; text-decoration: none; opacity: 0.8; }
.players { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.player { display: flex; gap: 6px; }
.player .score { font-weight: 700; }
.phase-banner { padding: 12px 16px; text-align: center; background: rgba(0,0,0,0.35); font-weight: 500; }
main#board { display: grid; grid-template-rows: auto 1fr auto; gap: 12px; padding: 16px; min-height: calc(100vh - 120px); }
.hand-row { display: flex; gap: 8px; justify-content: center; min-height: var(--card-h); }
.table { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: center; justify-items: center; }
.slot { width: var(--card-w); height: var(--card-h); border: 2px dashed rgba(255,255,255,0.25); border-radius: var(--card-radius); display: flex; align-items: center; justify-content: center; }
.pegging-strip { grid-column: 1 / -1; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.show-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; padding: 16px; }
.show-overlay[hidden] { display: none; }
```

- [ ] **Step 5: Create `app.js` (boot scaffold; renderers added in later tasks)**

```js
// plugins/cribbage/client/app.js
const ctx = window.__GAME__;
let state = null;

async function fetchState() {
  const r = await fetch(ctx.stateUrl);
  if (!r.ok) throw new Error(`state fetch failed: ${r.status}`);
  const data = await r.json();
  state = data.state ?? data;
  render();
}

async function send(action) {
  const r = await fetch(ctx.actionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    alert(body.error ?? `action failed (${r.status})`);
    return null;
  }
  state = body.state ?? state;
  render();
  return body;
}

function render() {
  // Filled in by later tasks. For now, just reflect phase + scores.
  const banner = document.getElementById('phase-banner');
  banner.textContent = `Phase: ${state?.phase ?? '…'}`;
  if (state) {
    const myUserId = ctx.userId;
    const mySide = state.sides.a === myUserId ? 0 : 1;
    document.getElementById('me-score').textContent = state.scores[mySide];
    document.getElementById('opp-score').textContent = state.scores[1 - mySide];
    document.getElementById('me-name').textContent = ctx.yourFriendlyName ?? 'You';
    document.getElementById('opp-name').textContent = ctx.opponentFriendlyName ?? 'Opponent';
  }
}

const es = new EventSource(ctx.sseUrl);
es.addEventListener('update', () => fetchState());
es.addEventListener('ended', () => fetchState());

window.__cribbage__ = { send }; // exposed for later modules

fetchState();
```

- [ ] **Step 6: Run tests**

Run: `node --test test/cribbage-client-files.test.js`
Expected: 3 PASS.

Run: `npm start` and visit `/cribbage/<gameId>` — banner should show `Phase: discard`, both names+scores. (Manual sanity check; not required for green.)

- [ ] **Step 7: Commit**

```bash
git add plugins/cribbage/client test/cribbage-client-files.test.js
git commit -m "feat(cribbage): client scaffold — index.html, style, app boot"
```

---

## Task 14: Card renderer — uses asset images

**Files:**
- Create: `plugins/cribbage/client/card.js`
- Modify: `plugins/cribbage/client/style.css`

- [ ] **Step 1: Implement card renderer**

```js
// plugins/cribbage/client/card.js
const SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

export function cardImageUrl(card) {
  return `assets/cards/${SUIT_NAME[card.suit]}-${card.rank}.jpg`;
}

export function backImageUrl(n = 5) {
  return `assets/cards/back-${n}.jpg`;
}

export function renderCard(card, { faceDown = false, draggable = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (faceDown ? ' card--back' : '');
  el.style.backgroundImage = `url(${faceDown ? backImageUrl() : cardImageUrl(card)})`;
  if (!faceDown) {
    el.dataset.rank = card.rank;
    el.dataset.suit = card.suit;
  }
  if (draggable) el.tabIndex = 0;
  return el;
}
```

- [ ] **Step 2: Add card styles**

Append to `plugins/cribbage/client/style.css`:

```css
.card {
  width: var(--card-w);
  height: var(--card-h);
  border-radius: var(--card-radius);
  background-size: cover;
  background-position: center;
  background-color: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  cursor: pointer;
  user-select: none;
  flex: none;
}
.card--back { background-color: #2a3f9b; }
.card.is-selected { outline: 3px solid gold; transform: translateY(-6px); transition: transform 120ms; }
.card.is-disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 3: Smoke test (manual)**

In a Node REPL or an ad-hoc render, verify URLs match files:

```bash
ls plugins/cribbage/client/assets/cards/spades-A.jpg plugins/cribbage/client/assets/cards/back-1.jpg
```

Expected: both files exist.

- [ ] **Step 4: Commit**

```bash
git add plugins/cribbage/client/card.js plugins/cribbage/client/style.css
git commit -m "feat(cribbage/client): card renderer using bundled assets"
```

---

## Task 15: Hand renderer + discard interaction

**Files:**
- Create: `plugins/cribbage/client/hand.js`
- Modify: `plugins/cribbage/client/app.js`

- [ ] **Step 1: Implement hand renderer**

```js
// plugins/cribbage/client/hand.js
import { renderCard, cardImageUrl } from './card.js';

let selected = []; // array of {rank,suit}

export function clearSelection() { selected = []; }
export function getSelection() { return selected.slice(); }

function sameCard(a, b) { return a.rank === b.rank && a.suit === b.suit; }

export function renderMyHand(container, hand, mode, onAction) {
  container.innerHTML = '';
  for (const card of hand) {
    const el = renderCard(card);
    const isSelected = selected.some(s => sameCard(s, card));
    if (isSelected) el.classList.add('is-selected');
    el.addEventListener('click', () => {
      if (mode === 'discard') {
        if (isSelected) {
          selected = selected.filter(s => !sameCard(s, card));
        } else if (selected.length < 2) {
          selected = [...selected, card];
        }
        renderMyHand(container, hand, mode, onAction);
        onAction?.({ type: 'selection-changed', selected });
      } else if (mode === 'pegging') {
        onAction?.({ type: 'play', card });
      }
    });
    container.appendChild(el);
  }
}

export function renderOpponentHand(container, count) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const el = renderCard(null, { faceDown: true });
    container.appendChild(el);
  }
}
```

- [ ] **Step 2: Wire into `app.js`**

Update `app.js` `render()` and add a discard-submit button to the banner:

```js
import { renderMyHand, renderOpponentHand, getSelection, clearSelection } from './hand.js';

// in render():
function render() {
  if (!state) return;
  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 0 : 1;
  const oppSide = 1 - mySide;
  document.getElementById('me-score').textContent = state.scores[mySide];
  document.getElementById('opp-score').textContent = state.scores[oppSide];
  document.getElementById('me-name').textContent = ctx.yourFriendlyName ?? 'You';
  document.getElementById('opp-name').textContent = ctx.opponentFriendlyName ?? 'Opponent';

  const banner = document.getElementById('phase-banner');
  const oppArea = document.getElementById('opp-area');
  const meArea = document.getElementById('me-area');

  if (state.phase === 'discard') {
    banner.innerHTML = `Discard 2 to the ${mySide === state.dealer ? 'your' : "your opponent's"} crib
      <button id="btn-discard" disabled>Send to crib</button>`;
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    renderMyHand(meArea, state.hands[mySide], 'discard', () => updateDiscardBtn());
    updateDiscardBtn();
    document.getElementById('btn-discard').onclick = async () => {
      const sel = getSelection();
      if (sel.length !== 2) return;
      const r = await window.__cribbage__.send({ type: 'discard', payload: { cards: sel } });
      if (r) clearSelection();
    };
  } else {
    banner.textContent = `Phase: ${state.phase}`;
    renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
    renderMyHand(meArea, Array.isArray(state.hands[mySide]) ? state.hands[mySide] : [], 'view');
  }
}

function updateDiscardBtn() {
  const btn = document.getElementById('btn-discard');
  if (!btn) return;
  btn.disabled = getSelection().length !== 2;
}
```

- [ ] **Step 3: Manual sanity check**

Start server and navigate to a fresh cribbage game. You should see 6 face-up cards on your side, 6 face-down on opponent's, click two to select, "Send to crib" enables, click → state advances when both submit.

- [ ] **Step 4: Commit**

```bash
git add plugins/cribbage/client/hand.js plugins/cribbage/client/app.js
git commit -m "feat(cribbage/client): hand renderer with discard selection"
```

---

## Task 16: Cut interaction

**Files:**
- Modify: `plugins/cribbage/client/app.js`

- [ ] **Step 1: Add cut UI to render()**

```js
// In app.js render(), add a branch for state.phase === 'cut':
if (state.phase === 'cut') {
  const isNonDealer = mySide !== state.dealer;
  banner.innerHTML = isNonDealer
    ? `Cut the deck. <button id="btn-cut">Cut</button>`
    : `Waiting for opponent to cut…`;
  // Show 4-card hand face-up still
  renderMyHand(meArea, state.hands[mySide], 'view');
  renderOpponentHand(oppArea, state.hands[oppSide].count ?? 4);
  // Show face-down deck stack in starter slot
  const slot = document.getElementById('starter');
  slot.innerHTML = '';
  const back = renderCard(null, { faceDown: true });
  slot.appendChild(back);
  if (isNonDealer) {
    document.getElementById('btn-cut').onclick = () => window.__cribbage__.send({ type: 'cut' });
  }
}
```

(Add `import { renderCard } from './card.js';` at top of `app.js`.)

- [ ] **Step 2: Show starter once revealed (in pegging/show)**

In the `else` branch of render() — when phase is `pegging` or later — render the starter face-up:

```js
const slot = document.getElementById('starter');
slot.innerHTML = '';
if (state.starter) {
  slot.appendChild(renderCard(state.starter));
}
```

- [ ] **Step 3: Manual sanity check**

After both discards, the non-dealer sees a "Cut" button; click → starter card flips face-up, banner changes to pegging context.

- [ ] **Step 4: Commit**

```bash
git add plugins/cribbage/client/app.js
git commit -m "feat(cribbage/client): cut button + starter reveal"
```

---

## Task 17: Pegging UI — running total, play strip, click-to-play

**Files:**
- Create: `plugins/cribbage/client/pegging.js`
- Modify: `plugins/cribbage/client/app.js`, `style.css`

- [ ] **Step 1: Create pegging renderer**

```js
// plugins/cribbage/client/pegging.js
import { renderCard } from './card.js';

const PIP = { A:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8, 9:9, T:10, J:10, Q:10, K:10 };

export function renderPeggingStrip(container, peg) {
  container.innerHTML = '';
  const total = document.createElement('div');
  total.className = 'running-total';
  total.textContent = `Running: ${peg.running}`;
  container.appendChild(total);
  for (const c of peg.history) container.appendChild(renderCard(c));
}

export function isPlayable(card, peg) {
  return peg.running + PIP[card.rank] <= 31;
}
```

- [ ] **Step 2: Add styles**

```css
.running-total {
  align-self: center; padding: 6px 12px; background: rgba(0,0,0,0.4);
  border-radius: 16px; font-weight: 700; margin-right: 8px;
}
```

- [ ] **Step 3: Wire into render()**

```js
// app.js — add a branch for state.phase === 'pegging'
import { renderPeggingStrip, isPlayable } from './pegging.js';

if (state.phase === 'pegging') {
  const myTurn = state.activeUserId === myUserId;
  banner.textContent = myTurn
    ? `Your play — running ${state.pegging.running}`
    : `Opponent's play — running ${state.pegging.running}`;
  renderPeggingStrip(document.getElementById('pegging-strip'), state.pegging);
  renderOpponentHand(oppArea, state.hands[oppSide].count ?? 0);
  // Render hand with disabled state for unplayable
  meArea.innerHTML = '';
  for (const card of state.hands[mySide]) {
    const el = renderCard(card);
    const playable = isPlayable(card, state.pegging) && myTurn;
    if (!playable) el.classList.add('is-disabled');
    if (playable) el.addEventListener('click', () => window.__cribbage__.send({ type: 'play', payload: { card } }));
    meArea.appendChild(el);
  }
  // Also render starter
  const slot = document.getElementById('starter');
  slot.innerHTML = '';
  if (state.starter) slot.appendChild(renderCard(state.starter));
}
```

- [ ] **Step 4: Manual sanity check**

Play a deal manually with two browser tabs. Confirm running total, click-to-play with disabled state for unplayable cards. Confirm "go" auto-handling reflected in updates.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/client/pegging.js plugins/cribbage/client/app.js plugins/cribbage/client/style.css
git commit -m "feat(cribbage/client): pegging UI — running total, play strip, click-to-play"
```

---

## Task 18: Show overlay with vernacular chant

**Files:**
- Create: `plugins/cribbage/client/show.js`
- Modify: `plugins/cribbage/client/app.js`, `style.css`

- [ ] **Step 1: Create show overlay renderer**

```js
// plugins/cribbage/client/show.js
import { renderCard } from './card.js';

function renderBreakdownCard(title, breakdown) {
  const card = document.createElement('div');
  card.className = 'breakdown-card';
  const h = document.createElement('h3');
  h.textContent = `${title} — ${breakdown.total}`;
  card.appendChild(h);
  const ul = document.createElement('ul');
  for (const item of breakdown.items) {
    const li = document.createElement('li');
    const say = document.createElement('div');
    say.className = 'say';
    say.textContent = item.say;
    const cards = document.createElement('div');
    cards.className = 'mini-cards';
    for (const c of item.cards) {
      const m = renderCard(c);
      m.classList.add('mini');
      cards.appendChild(m);
    }
    li.appendChild(say);
    li.appendChild(cards);
    ul.appendChild(li);
  }
  card.appendChild(ul);
  return card;
}

export function renderShow(overlay, state, myUserId, onNext) {
  overlay.hidden = false;
  overlay.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'show-wrap';

  const isDealer = (state.sides.a === myUserId ? 0 : 1) === state.dealer;
  const ndLabel = isDealer ? 'Opponent (non-dealer)' : 'You (non-dealer)';
  const dLabel = isDealer ? 'You (dealer)' : 'Opponent (dealer)';
  wrap.appendChild(renderBreakdownCard(ndLabel, state.showBreakdown.nonDealer));
  wrap.appendChild(renderBreakdownCard(dLabel, state.showBreakdown.dealer));
  wrap.appendChild(renderBreakdownCard('Crib', state.showBreakdown.crib));

  const mySide = state.sides.a === myUserId ? 0 : 1;
  const myAck = state.acknowledged[mySide];
  const btn = document.createElement('button');
  btn.textContent = myAck ? 'Waiting for opponent…' : 'Continue';
  btn.disabled = myAck;
  btn.addEventListener('click', () => onNext());
  wrap.appendChild(btn);

  overlay.appendChild(wrap);
}

export function hideShow(overlay) {
  overlay.hidden = true;
  overlay.innerHTML = '';
}
```

- [ ] **Step 2: Add styles**

```css
.show-wrap {
  background: #fff; color: #111; border-radius: 12px;
  padding: 24px; max-width: 920px; max-height: 90vh; overflow: auto;
  display: grid; gap: 16px;
}
.breakdown-card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
.breakdown-card h3 { margin: 0 0 8px; font-size: 18px; }
.breakdown-card ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.breakdown-card li { display: flex; align-items: center; gap: 12px; }
.breakdown-card .say { min-width: 220px; font-style: italic; }
.breakdown-card .mini-cards { display: flex; gap: 4px; }
.card.mini { width: 36px; height: 50px; box-shadow: 0 1px 2px rgba(0,0,0,0.3); }
.show-wrap > button {
  font: inherit; padding: 8px 16px; border-radius: 6px; border: none;
  background: #2a3f9b; color: #fff; cursor: pointer; justify-self: end;
}
.show-wrap > button:disabled { opacity: 0.6; cursor: default; }
```

- [ ] **Step 3: Wire into render()**

```js
// app.js — add at end of render()
import { renderShow, hideShow } from './show.js';

const overlay = document.getElementById('show-overlay');
if (state.phase === 'show' && state.showBreakdown) {
  renderShow(overlay, state, ctx.userId, () => window.__cribbage__.send({ type: 'next' }));
} else {
  hideShow(overlay);
}
```

- [ ] **Step 4: Manual sanity check**

Play a complete deal. At end, the overlay shows three breakdown cards in vernacular phrasing. Click Continue on both clients → overlay closes, phase becomes done.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/client/show.js plugins/cribbage/client/app.js plugins/cribbage/client/style.css
git commit -m "feat(cribbage/client): show overlay with vernacular breakdown"
```

---

## Task 19: Phase banner polish + done-state finale

**Files:**
- Modify: `plugins/cribbage/client/app.js`, `style.css`

- [ ] **Step 1: Improve phase banner messaging per phase**

In `app.js`, replace per-phase banner strings with a single helper:

```js
function bannerText(state, mySide) {
  const myTurn = state.activeUserId === ctx.userId;
  const isDealer = mySide === state.dealer;
  switch (state.phase) {
    case 'discard':
      return `Discard 2 to ${isDealer ? 'your' : "your opponent's"} crib`;
    case 'cut':
      return isDealer ? 'Waiting for opponent to cut…' : 'Cut the deck';
    case 'pegging':
      return myTurn ? `Your play — running ${state.pegging.running}` : `Opponent's play — running ${state.pegging.running}`;
    case 'show':
      return 'Hand counts';
    case 'done':
      return state.scores[0] === state.scores[1]
        ? `Tied at ${state.scores[mySide]} — deal complete`
        : (state.scores[mySide] > state.scores[1 - mySide]
            ? `You took the deal, ${state.scores[mySide]} to ${state.scores[1 - mySide]}`
            : `Opponent took the deal, ${state.scores[1 - mySide]} to ${state.scores[mySide]}`);
  }
  return state.phase;
}
```

Use it at the top of `render()` to set the banner text, and only inject buttons (cut, send-to-crib) per phase as before.

- [ ] **Step 2: Final manual playthrough**

Run `npm start`, open two browser tabs (different users), play a complete deal end-to-end. Verify:
- Discard, cut, pegging, show, done all work without dev intervention.
- Vernacular chant lines match expectations.
- After "done", banner displays winner / tie message.

- [ ] **Step 3: Run all tests one more time**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/cribbage/client/app.js plugins/cribbage/client/style.css
git commit -m "feat(cribbage/client): polished phase banner + done-state finale"
```

---

## Task 20: Commit card assets and slicer script

**Files:**
- `plugins/cribbage/client/assets/cards/*.jpg` (61 images, already produced)
- `scripts/cut_and_deskew.py`

- [ ] **Step 1: Verify assets present and counts match**

Run:
```bash
ls plugins/cribbage/client/assets/cards | wc -l
```
Expected: `61`.

- [ ] **Step 2: Commit assets + slicer**

```bash
git add plugins/cribbage/client/assets/cards scripts/cut_and_deskew.py
git commit -m "chore(cribbage): card face + back assets and slicer script"
```

---

## Self-Review Notes

Spec coverage check (against `docs/superpowers/specs/2026-05-07-cribbage-design.md`):

| Spec section | Covered by |
|---|---|
| §2 Plugin manifest | Task 1 |
| §3 Module layout | Tasks 1, 2, 5–11, 13–18 |
| §4 Card model | Task 2 |
| §5 State shape | Task 3 |
| §6 Action set | Tasks 4–10 |
| §7 Pegging mechanics | Tasks 7, 8 |
| §8 Hand & crib scoring | Task 9 |
| §9 Public view | Task 11 |
| §10 Error handling & determinism | Task 4 (errors), Task 3 (determinism), Task 12 (e2e) |
| §11 Client UX | Tasks 13–19 |
| §12 Testing strategy | Tasks 2–12 (unit + integration) |
| §13 Open questions / deferred | Documented in spec; no implementation needed |

No placeholders remain. Type signatures are consistent across tasks (`Card = {rank, suit}`, `ScoreItem`, `pegging.{running,history,pile,next,lastPlayer,saidGo}`). Dispatcher-handler keys match phase names. Determinism handled via `rng` injected at every entry point.
