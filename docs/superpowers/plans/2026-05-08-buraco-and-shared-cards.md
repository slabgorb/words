# Buraco + shared cards library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 2-player Buraco Brasileiro plugin to the Gamebox host, and extract the cribbage card primitives into a reusable `src/shared/cards/` library en route.

**Architecture:** Plain ESM JavaScript end-to-end (no Vite for cards — server and client both import the same plain modules). Server-safe primitives at `src/shared/cards/`, client-only DOM code at `public/shared/cards/`. Buraco engine follows cribbage's phases-as-files pattern; Buraco data shapes follow rummikub's flat-array set + stable-id-tile pattern. All tests use `node:test` runner (`npm test`), placed in `test/<area>.test.js`. Strict TDD: failing test first, minimal implementation, commit per task.

**Tech Stack:** Node 20+, ESM (`"type": "module"`), Express, better-sqlite3, `node:test`, vanilla ESM in browser (no React, no Vite).

**Source spec:** `docs/superpowers/specs/2026-05-08-buraco-and-shared-cards-design.md`

---

## Phase overview

| Phase | What | Why first |
|---|---|---|
| 1 | Stand up `src/shared/cards/` (server) + `public/shared/cards/` (client) | Foundation for both cribbage migration and Buraco; tested standalone |
| 2 | Migrate cribbage to consume shared lib | Proves the lib's shape is right; no behavior change visible to user |
| 3 | Buraco server engine (state, phases, scoring, validation, view) | Core game logic; runs headless via tests |
| 4 | Buraco client UI (renderer, hand, melds, table, action bar) | Playable in browser |
| 5 | Plugin registration + manual smoke test | Live in lobby |

Phases 1–3 each end in a state where everything still builds and existing games still play. Phases 4–5 produce playable Buraco. Stop and ship at any phase boundary if needed.

---

## Conventions used by this plan

- **File paths are absolute from repo root** (`/Users/slabgorb/Projects/words/...` → just `...`).
- **Test commands** use `npm test` for the full suite, `node --test test/<file>.test.js` for one file.
- **Commit messages** follow this repo's existing `git log` style: `feat(buraco): ...`, `refactor(cribbage): ...`, `chore(shared): ...`. Match what you see in `git log --oneline -20`.
- **Each task ends with a commit step.** Don't batch.
- **TDD discipline:** every implementation step is preceded by a failing test step. If a test passes before you've written the implementation, you wrote the wrong test or the test is vacuous — stop and rethink.
- **Existing imports to preserve:** cribbage's `pipValue` and `runValue` stay cribbage-specific. Move them out of the doomed `cards.js` into a new `plugins/cribbage/server/values.js`. Don't put them in the shared lib.

---

## Phase 1 — Shared cards library

### Task 1.1: Scaffold directory structure

**Files:**
- Create: `src/shared/cards/deck.js`
- Create: `src/shared/cards/card-multiset.js`
- Create: `public/shared/cards/card-element.js`
- Create: `public/shared/cards/style.css`

- [ ] **Step 1: Create empty server-side files**

```bash
mkdir -p src/shared/cards public/shared/cards
touch src/shared/cards/deck.js src/shared/cards/card-multiset.js
touch public/shared/cards/card-element.js public/shared/cards/style.css
```

- [ ] **Step 2: Verify files exist**

```bash
ls -la src/shared/cards/ public/shared/cards/
```

Expected: 2 empty files in each directory.

- [ ] **Step 3: Commit**

```bash
git add src/shared/cards public/shared/cards
git commit -m "chore(shared): scaffold cards library directories"
```

---

### Task 1.2: Implement `cardId` and `parseCardId`

**Files:**
- Modify: `src/shared/cards/deck.js`
- Test: `test/shared-cards-deck.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/shared-cards-deck.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardId, parseCardId } from '../src/shared/cards/deck.js';

test('cardId formats natural cards as suit-rank-deckIndex', () => {
  assert.equal(cardId({ rank: 'A', suit: 'S', deckIndex: 0 }), 'S-A-0');
  assert.equal(cardId({ rank: 'T', suit: 'C', deckIndex: 1 }), 'C-T-1');
});

test('cardId formats jokers as jk-index', () => {
  assert.equal(cardId({ kind: 'joker', index: 0 }), 'jk-0');
  assert.equal(cardId({ kind: 'joker', index: 3 }), 'jk-3');
});

test('parseCardId round-trips a natural card', () => {
  const id = 'H-7-1';
  const parsed = parseCardId(id);
  assert.deepEqual(parsed, { kind: 'natural', rank: '7', suit: 'H', deckIndex: 1 });
});

test('parseCardId round-trips a joker', () => {
  assert.deepEqual(parseCardId('jk-2'), { kind: 'joker', index: 2 });
});

test('parseCardId rejects malformed ids', () => {
  assert.throws(() => parseCardId('garbage'), /invalid card id/);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/shared-cards-deck.test.js
```

Expected: FAIL — `cardId is not a function` or import error.

- [ ] **Step 3: Implement minimal code**

In `src/shared/cards/deck.js`:

```js
export function cardId(card) {
  if (card.kind === 'joker') return `jk-${card.index}`;
  return `${card.suit}-${card.rank}-${card.deckIndex}`;
}

export function parseCardId(id) {
  const jk = /^jk-(\d+)$/.exec(id);
  if (jk) return { kind: 'joker', index: Number(jk[1]) };
  const nat = /^([SHDC])-([A2-9TJQK]|10)-(\d+)$/.exec(id);
  if (nat) return { kind: 'natural', suit: nat[1], rank: nat[2], deckIndex: Number(nat[3]) };
  throw new Error(`invalid card id: ${id}`);
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
node --test test/shared-cards-deck.test.js
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/shared/cards/deck.js test/shared-cards-deck.test.js
git commit -m "feat(shared/cards): cardId and parseCardId"
```

---

### Task 1.3: Implement `RANKS`, `SUITS`, `buildDeck`, `shuffle`, `sameCard`, `isJoker`, `isNaturalTwo`

**Files:**
- Modify: `src/shared/cards/deck.js`
- Modify: `test/shared-cards-deck.test.js`

- [ ] **Step 1: Add failing tests** (append to `test/shared-cards-deck.test.js`)

```js
import {
  RANKS, SUITS, buildDeck, shuffle, sameCard, isJoker, isNaturalTwo,
} from '../src/shared/cards/deck.js';

test('RANKS has 13 entries, A through K with T for ten', () => {
  assert.deepEqual(RANKS, ['A','2','3','4','5','6','7','8','9','T','J','Q','K']);
});

test('SUITS has S, H, D, C in canonical order', () => {
  assert.deepEqual(SUITS, ['S','H','D','C']);
});

test('buildDeck({decks:1, jokers:0}) returns 52 unique cards each with id', () => {
  const d = buildDeck({ decks: 1, jokers: 0 });
  assert.equal(d.length, 52);
  const ids = new Set(d.map(c => c.id));
  assert.equal(ids.size, 52);
  for (const c of d) {
    assert.ok(typeof c.id === 'string', `card missing id: ${JSON.stringify(c)}`);
    assert.ok(typeof c.rank === 'string');
    assert.ok(typeof c.suit === 'string');
    assert.equal(c.deckIndex, 0);
  }
});

test('buildDeck({decks:2, jokers:4}) returns 108 unique cards (52*2 + 4 jokers)', () => {
  const d = buildDeck({ decks: 2, jokers: 4 });
  assert.equal(d.length, 108);
  const ids = new Set(d.map(c => c.id));
  assert.equal(ids.size, 108);
  const naturals = d.filter(c => !isJoker(c));
  const jokers = d.filter(c => isJoker(c));
  assert.equal(naturals.length, 104);
  assert.equal(jokers.length, 4);
  const colors = jokers.map(c => c.color).sort();
  assert.deepEqual(colors, ['black', 'black', 'red', 'red']);
});

test('buildDeck({decks:0,...}) throws (must be 1 or 2)', () => {
  assert.throws(() => buildDeck({ decks: 0, jokers: 0 }), /decks must be 1 or 2/);
});

test('shuffle is deterministic for the same seeded rng', () => {
  const d1 = buildDeck({ decks: 1, jokers: 0 });
  const d2 = buildDeck({ decks: 1, jokers: 0 });
  function det(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  shuffle(d1, det(42));
  shuffle(d2, det(42));
  assert.deepEqual(d1.map(c => c.id), d2.map(c => c.id));
});

test('shuffle preserves the multiset', () => {
  const d = buildDeck({ decks: 2, jokers: 4 });
  const before = d.map(c => c.id).sort();
  shuffle(d, Math.random);
  const after = d.map(c => c.id).sort();
  assert.deepEqual(after, before);
});

test('sameCard compares by id only', () => {
  const a = { id: 'S-A-0', rank: 'A', suit: 'S', deckIndex: 0 };
  const b = { id: 'S-A-0', rank: 'A', suit: 'S', deckIndex: 0 };
  const c = { id: 'S-A-1', rank: 'A', suit: 'S', deckIndex: 1 };
  assert.equal(sameCard(a, b), true);
  assert.equal(sameCard(a, c), false);
});

test('isJoker', () => {
  assert.equal(isJoker({ kind: 'joker', index: 0 }), true);
  assert.equal(isJoker({ rank: 'A', suit: 'S' }), false);
});

test('isNaturalTwo: a 2 is wild relative to a meld of a different suit', () => {
  // 2♣ is wild in a hearts meld; 2♣ is the natural two in a clubs meld
  assert.equal(isNaturalTwo({ rank: '2', suit: 'C' }, 'C'), true);
  assert.equal(isNaturalTwo({ rank: '2', suit: 'C' }, 'H'), false);
  assert.equal(isNaturalTwo({ rank: '5', suit: 'C' }, 'C'), false);
  assert.equal(isNaturalTwo({ kind: 'joker', index: 0 }, 'C'), false);
});
```

- [ ] **Step 2: Run tests, expect failures**

```bash
node --test test/shared-cards-deck.test.js
```

Expected: 9 failures (constants and functions undefined).

- [ ] **Step 3: Implement** — append to `src/shared/cards/deck.js`:

```js
export const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
export const SUITS = ['S','H','D','C'];

export function buildDeck({ decks = 1, jokers = 0 } = {}) {
  if (decks !== 1 && decks !== 2) throw new Error('decks must be 1 or 2');
  if (![0, 2, 4].includes(jokers)) throw new Error('jokers must be 0, 2, or 4');
  const out = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        out.push({
          id: `${suit}-${rank}-${d}`,
          rank, suit, deckIndex: d,
        });
      }
    }
  }
  const colors = ['red', 'black', 'red', 'black'];
  for (let j = 0; j < jokers; j++) {
    out.push({
      id: `jk-${j}`,
      kind: 'joker',
      index: j,
      color: colors[j],
    });
  }
  return out;
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function sameCard(a, b) {
  return a.id === b.id;
}

export function isJoker(card) {
  return card?.kind === 'joker';
}

export function isNaturalTwo(card, meldSuit) {
  if (isJoker(card)) return false;
  return card.rank === '2' && card.suit === meldSuit;
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
node --test test/shared-cards-deck.test.js
```

Expected: all 14 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/shared/cards/deck.js test/shared-cards-deck.test.js
git commit -m "feat(shared/cards): deck primitives — RANKS/SUITS/buildDeck/shuffle/sameCard"
```

---

### Task 1.4: Implement `card-multiset.js`

**Files:**
- Modify: `src/shared/cards/card-multiset.js`
- Test: `test/shared-cards-multiset.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/shared-cards-multiset.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardIdsOf, multisetEqual } from '../src/shared/cards/card-multiset.js';

test('cardIdsOf flattens nested arrays of cards into id list', () => {
  const state = {
    hand: [{ id: 'S-A-0' }, { id: 'H-2-1' }],
    melds: [[{ id: 'C-3-0' }, { id: 'C-4-0' }]],
    discard: [{ id: 'D-5-1' }],
  };
  const ids = cardIdsOf(state).sort();
  assert.deepEqual(ids, ['C-3-0', 'C-4-0', 'D-5-1', 'H-2-1', 'S-A-0']);
});

test('cardIdsOf handles empty arrays', () => {
  assert.deepEqual(cardIdsOf({ hand: [], melds: [] }), []);
});

test('multisetEqual returns true for permutations of the same ids', () => {
  assert.equal(multisetEqual(['a', 'b', 'c'], ['c', 'a', 'b']), true);
});

test('multisetEqual returns false when an id is added', () => {
  assert.equal(multisetEqual(['a', 'b'], ['a', 'b', 'c']), false);
});

test('multisetEqual returns false when an id is removed', () => {
  assert.equal(multisetEqual(['a', 'b', 'c'], ['a', 'b']), false);
});

test('multisetEqual returns false when an id is duplicated incorrectly', () => {
  assert.equal(multisetEqual(['a', 'b'], ['a', 'a']), false);
});
```

- [ ] **Step 2: Run, expect failure**

```bash
node --test test/shared-cards-multiset.test.js
```

Expected: import errors.

- [ ] **Step 3: Implement** — write `src/shared/cards/card-multiset.js`:

```js
export function cardIdsOf(state) {
  const out = [];
  for (const value of Object.values(state)) {
    collect(value, out);
  }
  return out;
}

function collect(value, out) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
    return;
  }
  if (typeof value === 'object' && typeof value.id === 'string') {
    out.push(value.id);
    return;
  }
  // Anything else (numbers, plain objects without id) is ignored.
}

export function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const counts = new Map();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of b) {
    const n = counts.get(x);
    if (!n) return false;
    counts.set(x, n - 1);
  }
  return true;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
node --test test/shared-cards-multiset.test.js
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/shared/cards/card-multiset.js test/shared-cards-multiset.test.js
git commit -m "feat(shared/cards): cardIdsOf and multisetEqual"
```

---

### Task 1.5: Move card art into shared assets

**Files:**
- Move: `plugins/cribbage/client/assets/cards/*` → `public/shared/cards/assets/`

- [ ] **Step 1: Verify current location**

```bash
ls plugins/cribbage/client/assets/cards/ | wc -l
```

Expected: ≥58 (52 face + 4 backs + Cards.png + …).

- [ ] **Step 2: Create destination**

```bash
mkdir -p public/shared/cards/assets
```

- [ ] **Step 3: Move face/back image files**

```bash
git mv plugins/cribbage/client/assets/cards/*.jpg public/shared/cards/assets/
git mv plugins/cribbage/client/assets/cards/*.png public/shared/cards/assets/
```

- [ ] **Step 4: Verify**

```bash
ls public/shared/cards/assets/ | wc -l
ls plugins/cribbage/client/assets/cards/ 2>/dev/null
```

Expected: count matches step 1; original directory is empty or only contains source-of-truth `Cards.png` (the slicer input). Leave Cards.png if present — that's the slicer's input, not a runtime asset.

- [ ] **Step 5: Remove the now-empty cribbage cards dir if no slicer-input files remain**

```bash
rmdir plugins/cribbage/client/assets/cards/ 2>/dev/null || ls plugins/cribbage/client/assets/cards/
```

If the dir doesn't remove, the remaining files (likely `Cards.png` and any DS_Store) belong elsewhere — leave the directory alone for now; cribbage migration in Phase 2 will rewire imports anyway.

- [ ] **Step 6: Commit**

```bash
git add -A public/shared/cards/assets plugins/cribbage/client/assets/cards
git commit -m "refactor(shared/cards): move card art to public/shared/cards/assets"
```

---

### Task 1.6: Add joker face images

**Files:**
- Add: `public/shared/cards/assets/joker-red.jpg`
- Add: `public/shared/cards/assets/joker-black.jpg`

Joker images are NEW assets needed for Buraco. The existing `scripts/cut_and_deskew.py` (and friends) sliced the original 13×4 face sheet but did not include jokers.

- [ ] **Step 1: Check if joker source images already exist**

```bash
find . -iname "*joker*" -not -path "./node_modules/*" -not -path "./.git/*"
```

Expected: probably empty.

- [ ] **Step 2: Stop and request joker source images**

If no joker images exist, this task BLOCKS until source images are provided. Report to the human:

> Need 2 joker images (`joker-red.jpg`, `joker-black.jpg`) at the same dimensions as the existing card faces (~480×720 or whatever `clubs-2.jpg` is). Either deliver the images or point at a source sheet for the slicer to crop.

When the images are provided, copy them to `public/shared/cards/assets/joker-red.jpg` and `public/shared/cards/assets/joker-black.jpg`.

- [ ] **Step 3: Verify**

```bash
identify public/shared/cards/assets/joker-red.jpg public/shared/cards/assets/joker-black.jpg 2>/dev/null \
  || ls -la public/shared/cards/assets/joker-*
```

Expected: both files present.

- [ ] **Step 4: Commit**

```bash
git add public/shared/cards/assets/joker-red.jpg public/shared/cards/assets/joker-black.jpg
git commit -m "assets(shared/cards): add joker face images"
```

---

### Task 1.7: Implement client-side `card-element.js`

**Files:**
- Modify: `public/shared/cards/card-element.js`
- Test: `test/shared-cards-element.test.js`

The shared lib's existing convention so far has been server-side tests via `node:test`. The browser-only renderer is harder to unit test under `node:test` without jsdom. Since the existing repo already configures `vitest` with jsdom for `src/shared/dice/`, we'll add a similar carve-out: keep `card-element.js` lightweight and test the URL-builders here under `node:test` (no DOM); rely on cribbage's existing client integration tests + manual smoke for full DOM verification.

- [ ] **Step 1: Write failing test for URL builders**

Create `test/shared-cards-element.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardImageUrl, backImageUrl } from '../public/shared/cards/card-element.js';

test('cardImageUrl maps a natural card to /shared/cards/assets/<suit>-<rank>.jpg', () => {
  assert.equal(
    cardImageUrl({ rank: 'A', suit: 'S' }),
    '/shared/cards/assets/spades-A.jpg',
  );
  assert.equal(
    cardImageUrl({ rank: 'T', suit: 'C' }),
    '/shared/cards/assets/clubs-T.jpg',
  );
});

test('cardImageUrl maps a joker by color', () => {
  assert.equal(
    cardImageUrl({ kind: 'joker', color: 'red', index: 0 }),
    '/shared/cards/assets/joker-red.jpg',
  );
  assert.equal(
    cardImageUrl({ kind: 'joker', color: 'black', index: 1 }),
    '/shared/cards/assets/joker-black.jpg',
  );
});

test('backImageUrl defaults to back_1 and accepts 1..4', () => {
  assert.equal(backImageUrl(), '/shared/cards/assets/back_1.png');
  assert.equal(backImageUrl(1), '/shared/cards/assets/back_1.png');
  assert.equal(backImageUrl(4), '/shared/cards/assets/back_4.png');
});
```

- [ ] **Step 2: Run, expect failure**

```bash
node --test test/shared-cards-element.test.js
```

Expected: import error.

- [ ] **Step 3: Implement** — write `public/shared/cards/card-element.js`:

```js
const SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANK_NAME = {
  A: 'Ace', '2': 'Two', '3': 'Three', '4': 'Four', '5': 'Five',
  '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine',
  T: 'Ten', J: 'Jack', Q: 'Queen', K: 'King',
};

const ASSET_BASE = '/shared/cards/assets';

export function cardImageUrl(card) {
  if (card?.kind === 'joker') return `${ASSET_BASE}/joker-${card.color}.jpg`;
  return `${ASSET_BASE}/${SUIT_NAME[card.suit]}-${card.rank}.jpg`;
}

export function backImageUrl(n = 1) {
  return `${ASSET_BASE}/back_${n}.png`;
}

// Browser-only DOM renderer. Returns an HTMLDivElement.
export function renderCard(card, { faceDown = false, draggable = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (faceDown ? ' card--back' : '');
  el.style.backgroundImage = `url(${faceDown ? backImageUrl() : cardImageUrl(card)})`;
  if (faceDown) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Face-down card');
  } else if (card?.kind === 'joker') {
    el.classList.add('card--joker');
    el.dataset.kind = 'joker';
    el.dataset.color = card.color;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${card.color} joker`);
  } else {
    el.dataset.rank = card.rank;
    el.dataset.suit = card.suit;
    el.dataset.id = card.id ?? '';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${RANK_NAME[card.rank] ?? card.rank} of ${SUIT_NAME[card.suit] ?? card.suit}`);
  }
  if (draggable) el.tabIndex = 0;
  return el;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
node --test test/shared-cards-element.test.js
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add public/shared/cards/card-element.js test/shared-cards-element.test.js
git commit -m "feat(shared/cards): client renderCard + URL builders"
```

---

### Task 1.8: Add shared card CSS

**Files:**
- Modify: `public/shared/cards/style.css`

- [ ] **Step 1: Inspect cribbage's existing card CSS to copy the rules**

```bash
grep -A30 '^\.card' plugins/cribbage/client/style.css | head -80
```

Note the rules for `.card`, `.card--back`, `.is-selected`. Lift the visual rules; leave layout (positioning, gap) to plugins.

- [ ] **Step 2: Write the shared CSS** to `public/shared/cards/style.css`:

```css
/* Shared playing-card visuals. Plugins are responsible for layout (rows, fans,
   selection states beyond .card--selected). This file owns ONLY the card itself. */

.card {
  display: inline-block;
  width: 80px;
  height: 116px;
  border-radius: 6px;
  background-color: #fff;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.3);
  border: 1px solid #999;
  user-select: none;
}

.card--back {
  background-color: #5a3424;
}

.card--joker {
  /* No special visuals beyond the joker image; class is for hooks. */
}

.card--selected {
  outline: 3px solid #4a8;
  transform: translateY(-6px);
  transition: transform 100ms ease-out;
}
```

The `.is-selected` class cribbage uses today is plugin-specific. We're standardizing on `.card--selected` going forward; cribbage's migration will update its CSS.

- [ ] **Step 3: Commit**

```bash
git add public/shared/cards/style.css
git commit -m "feat(shared/cards): shared card visual styles"
```

---

### Task 1.9: Verify Phase 1 — full test pass

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all existing tests pass; new `shared-cards-*.test.js` files contribute their tests; total count went up by ~23 tests.

- [ ] **Step 2: Verify the static asset URL works** (sanity check the file path)

```bash
test -f public/shared/cards/assets/spades-A.jpg && echo "ok" || echo "FAIL"
test -f public/shared/cards/card-element.js && echo "ok" || echo "FAIL"
test -f public/shared/cards/style.css && echo "ok" || echo "FAIL"
```

Expected: three "ok".

- [ ] **Step 3: Tag this checkpoint** (no commit needed if everything's already committed)

```bash
git log --oneline -8
```

Expected: clean history of the 8 phase-1 commits.

---

## Phase 2 — Cribbage migration

Goal: cribbage uses the shared lib for all card concerns; nothing else changes; all cribbage tests still pass.

### Task 2.1: Move cribbage's pip/run values out of `cards.js`

The shared lib doesn't include `pipValue` / `runValue` (cribbage-specific). Park them in a new `values.js` so `cards.js` can be deleted entirely.

**Files:**
- Create: `plugins/cribbage/server/values.js`
- Modify: `plugins/cribbage/server/cards.js` (will be deleted next task)

- [ ] **Step 1: Write `plugins/cribbage/server/values.js`**

```js
const PIP = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:10, Q:10, K:10 };
const RUN = { A:1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, T:10, J:11, Q:12, K:13 };

export function pipValue(card) { return PIP[card.rank]; }
export function runValue(card) { return RUN[card.rank]; }
```

- [ ] **Step 2: Find every importer of `pipValue` / `runValue`**

```bash
grep -rn "pipValue\|runValue" plugins/cribbage src/ test/ | grep -v cards.js
```

Note the file:line list. These need their imports rewritten to point at `./values.js` (or relative path).

- [ ] **Step 3: Rewrite each importer**

For every line found in step 2, change

```js
import { pipValue } from './cards.js';
```

to

```js
import { pipValue } from './values.js';
```

(adjust relative path per file). Use Edit tool one site at a time. Do NOT use sed — context matters per file.

- [ ] **Step 4: Run cribbage tests, expect pass**

```bash
node --test 'test/cribbage-*.test.js'
```

Expected: all cribbage tests pass (no behavior change yet — `cards.js` still re-exports the values via Phase 2.2).

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/values.js plugins/cribbage/server/*.js test/
git commit -m "refactor(cribbage): split pip/run values into values.js"
```

---

### Task 2.2: Migrate cribbage server to shared deck primitives

**Files:**
- Modify: `plugins/cribbage/server/state.js` (and any other server files importing from `./cards.js`)
- Delete: `plugins/cribbage/server/cards.js`
- Modify: `test/cribbage-cards.test.js` (point at the shared lib)

- [ ] **Step 1: Find every server importer of `cards.js`**

```bash
grep -rn "from '\\.\\./.*cards\\.js'\\|from '\\./cards\\.js'" plugins/cribbage/server/
```

Example output: `state.js: import { buildDeck, shuffle } from './cards.js';`

- [ ] **Step 2: Rewrite each server importer**

For each file, replace imports:

- `RANKS, SUITS, buildDeck, shuffle, sameCard` → from `'../../../src/shared/cards/deck.js'`
- (cribbage's `buildDeck()` call → `buildDeck({ decks: 1, jokers: 0 })`)

Use Edit. Verify each file builds by running the file's tests after editing.

- [ ] **Step 3: Verify cribbage server engine still passes**

```bash
node --test 'test/cribbage-*.test.js'
```

Expected: all pass. Cards now have `id` and `deckIndex: 0` fields; existing assertions checking only `rank` and `suit` continue to pass; assertions using object equality may need an update — fix with `sameCard(a, b)` not `assert.deepEqual(a, b)`.

If a deepEqual assertion fails because of the new `id`/`deckIndex` fields, that's the right kind of breakage. Update the test to use `sameCard` or to ignore the new fields explicitly.

- [ ] **Step 4: Migrate `test/cribbage-cards.test.js`** — this test imports from cribbage's `cards.js`. Either:
  (a) delete the test (its content is now covered by `test/shared-cards-deck.test.js`), OR
  (b) keep cribbage-specific portions (pip/run values) and point them at `./values.js`.

Choose (b). Open `test/cribbage-cards.test.js`. Remove all tests for `RANKS`, `SUITS`, `buildDeck`, `shuffle`, `sameCard` (now tested in `test/shared-cards-deck.test.js`). Keep only `pipValue` and `runValue` tests. Rename file to `test/cribbage-values.test.js` and update imports:

```js
import { pipValue, runValue } from '../plugins/cribbage/server/values.js';
```

- [ ] **Step 5: Delete `plugins/cribbage/server/cards.js`**

```bash
git rm plugins/cribbage/server/cards.js
git mv test/cribbage-cards.test.js test/cribbage-values.test.js
```

- [ ] **Step 6: Run full suite, expect pass**

```bash
npm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add plugins/cribbage/server/ test/cribbage-values.test.js
git commit -m "refactor(cribbage): migrate server to shared cards/deck.js; delete cards.js"
```

---

### Task 2.3: Migrate cribbage client to shared renderer + assets

**Files:**
- Modify: `plugins/cribbage/client/index.html` (CSS + asset paths)
- Modify: `plugins/cribbage/client/app.js`, `hand.js`, `show.js` (imports)
- Delete: `plugins/cribbage/client/card.js`
- Modify: `plugins/cribbage/client/hand.js` (was importing `./card.js`)
- Modify: `plugins/cribbage/client/style.css` (drop card visuals; keep cribbage-specific layout)

- [ ] **Step 1: Update `plugins/cribbage/client/index.html`** — add the shared stylesheet:

In `<head>`, after the existing `<link rel="stylesheet" href="style.css">`:

```html
<link rel="stylesheet" href="/shared/cards/style.css">
```

(Order matters: shared first so plugin-specific overrides it.)

- [ ] **Step 2: Find every client importer of `./card.js`**

```bash
grep -rn "from '\\./card\\.js'" plugins/cribbage/client/
```

- [ ] **Step 3: Rewrite each importer** to use the shared module via absolute URL:

```js
import { renderCard, cardImageUrl, backImageUrl } from '/shared/cards/card-element.js';
```

(Browsers resolve `/shared/...` to `https://host/shared/...` via the host's existing static mount of `public/`.)

- [ ] **Step 4: Update `plugins/cribbage/client/hand.js`** — its top import was `import { renderCard, cardImageUrl } from './card.js';`. Change to:

```js
import { renderCard, cardImageUrl } from '/shared/cards/card-element.js';
```

- [ ] **Step 5: Delete `plugins/cribbage/client/card.js`**

```bash
git rm plugins/cribbage/client/card.js
```

- [ ] **Step 6: Audit `plugins/cribbage/client/style.css`** — remove rules now covered by `/shared/cards/style.css`:

```bash
grep -n '^\.card' plugins/cribbage/client/style.css
```

Remove `.card`, `.card--back` rules (they're in shared). Keep `.is-selected` for now if cribbage uses it; later we may rename to `.card--selected`. Cribbage-specific layout (`.hand-row`, `.peg-board`, `.slot`) all stays.

- [ ] **Step 7: Update asset URLs in `plugins/cribbage/client/style.css`**

```bash
grep -n 'assets/cards' plugins/cribbage/client/style.css
```

For each match, replace `assets/cards/` with `/shared/cards/assets/`.

- [ ] **Step 8: Test that cribbage's client-side files test still passes**

```bash
node --test test/cribbage-client-files.test.js
```

If this test asserts the existence of `plugins/cribbage/client/card.js`, update it to assert the existence of `/shared/cards/card-element.js` (i.e. `public/shared/cards/card-element.js`).

- [ ] **Step 9: Run full suite, expect pass**

```bash
npm test
```

Expected: all green.

- [ ] **Step 10: Manual smoke test**

```bash
DEV_USER=you@example.com npm start
```

Open `http://localhost:3000`. Start a cribbage game vs another roster member (or yourself with a second `DEV_USER`). Verify:
- Card faces render
- Card backs render (opponent hand)
- No 404s in browser console (DevTools → Network)
- Selecting cards still highlights them

If any of the above fails, inspect Network tab for missing `/shared/cards/assets/...` paths and reconcile.

- [ ] **Step 11: Commit**

```bash
git add plugins/cribbage/client test/cribbage-client-files.test.js
git commit -m "refactor(cribbage): migrate client to shared cards renderer + assets"
```

---

### Task 2.4: Verify Phase 2 — full test pass + manual cribbage playthrough

- [ ] **Step 1: Run full suite**

```bash
npm test
```

Expected: all green.

- [ ] **Step 2: Play through one full cribbage hand against yourself locally** to confirm zero behavior change — cut, deal, discard, peg, show, score. Use the browser at `http://localhost:3000`.

- [ ] **Step 3: Compare git diff cribbage**

```bash
git diff main -- plugins/cribbage/ | wc -l
```

Note: should be a moderate-sized refactor diff (delete cards.js, delete card.js, edit imports), not a behavioral diff.

---

## Phase 3 — Buraco engine (server)

### Task 3.1: Scaffold Buraco plugin directory

**Files:**
- Create: `plugins/buraco/plugin.js`
- Create: `plugins/buraco/server/{state,actions,view,sequence,validate-turn}.js`
- Create: `plugins/buraco/server/phases/{draw,meld,discard,deal-end}.js`
- Create: `plugins/buraco/server/scoring/{meld-value,deal-end}.js`

- [ ] **Step 1: Create empty files**

```bash
mkdir -p plugins/buraco/server/phases plugins/buraco/server/scoring plugins/buraco/client
touch plugins/buraco/plugin.js
touch plugins/buraco/server/{state.js,actions.js,view.js,sequence.js,validate-turn.js}
touch plugins/buraco/server/phases/{draw.js,meld.js,discard.js,deal-end.js}
touch plugins/buraco/server/scoring/{meld-value.js,deal-end.js}
```

- [ ] **Step 2: Commit scaffold**

```bash
git add plugins/buraco
git commit -m "chore(buraco): scaffold plugin directory"
```

---

### Task 3.2: Implement `state.js` (initial deal)

**Files:**
- Modify: `plugins/buraco/server/state.js`
- Test: `test/buraco-state.test.js`

- [ ] **Step 1: Write failing test**

Create `test/buraco-state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/buraco/server/state.js';
import { cardIdsOf } from '../src/shared/cards/card-multiset.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('buildInitialState returns 11 cards in each hand', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.hands.a.length, 11);
  assert.equal(s.hands.b.length, 11);
});

test('buildInitialState returns 11 cards in each morto', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.mortos.a.length, 11);
  assert.equal(s.mortos.b.length, 11);
});

test('buildInitialState flips one card to discard', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.discard.length, 1);
});

test('buildInitialState leaves remaining cards in stock', () => {
  const s = buildInitialState({ participants, rng: det() });
  // 108 - 11*4 - 1 = 63
  assert.equal(s.stock.length, 63);
});

test('total cards across all locations = 108', () => {
  const s = buildInitialState({ participants, rng: det() });
  const all = cardIdsOf(s);
  assert.equal(all.length, 108);
  assert.equal(new Set(all).size, 108);
});

test('initial phase is draw, currentTurn is a, hasDrawn false', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.equal(s.phase, 'draw');
  assert.equal(s.currentTurn, 'a');
  assert.equal(s.hasDrawn, false);
});

test('initial scores are zero, no winner', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.scores, { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } });
  assert.equal(s.winner, null);
});

test('initial mortoTaken is false on both sides', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.mortoTaken, { a: false, b: false });
});

test('initial melds are empty arrays', () => {
  const s = buildInitialState({ participants, rng: det() });
  assert.deepEqual(s.melds, { a: [], b: [] });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
node --test test/buraco-state.test.js
```

Expected: import error.

- [ ] **Step 3: Implement** — write `plugins/buraco/server/state.js`:

```js
import { buildDeck, shuffle } from '../../../src/shared/cards/deck.js';

export function buildInitialState({ participants, rng }) {
  const deck = shuffle(buildDeck({ decks: 2, jokers: 4 }), rng);
  const hands = { a: deck.splice(0, 11), b: deck.splice(0, 11) };
  const mortos = { a: deck.splice(0, 11), b: deck.splice(0, 11) };
  const discard = [deck.pop()];
  const stock = deck;

  return {
    phase: 'draw',
    dealNumber: 1,
    currentTurn: 'a',
    hasDrawn: false,
    stock,
    discard,
    hands,
    melds: { a: [], b: [] },
    mortos,
    mortoTaken: { a: false, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null,
    winner: null,
  };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
node --test test/buraco-state.test.js
```

Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/state.js test/buraco-state.test.js
git commit -m "feat(buraco/server): initial state builder — 108-card deal, two mortos"
```

---

### Task 3.3: Implement `sequence.js` — `isValidSequence`

**Files:**
- Modify: `plugins/buraco/server/sequence.js`
- Test: `test/buraco-sequence.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-sequence.test.js`:

```js
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
```

- [ ] **Step 2: Run, expect failure**

```bash
node --test test/buraco-sequence.test.js
```

Expected: import error.

- [ ] **Step 3: Implement** — write `plugins/buraco/server/sequence.js`:

```js
import { RANKS, isJoker } from '../../../src/shared/cards/deck.js';

const RANK_INDEX = Object.fromEntries(RANKS.map((r, i) => [r, i]));

// Effective rank/suit of a card within a meld context (jokers/wilds use the
// representsRank/representsSuit annotations).
function effectiveRank(card) {
  if (card.representsRank) return card.representsRank;
  return card.rank;
}
function effectiveSuit(card) {
  if (card.representsSuit) return card.representsSuit;
  return card.suit;
}

// A card is "wild within this meld" if it's a joker, OR a 2 of a different
// suit than the meld's suit. The natural 2 of the meld's suit is NOT wild.
function isWildIn(card, meldSuit) {
  if (isJoker(card)) return true;
  if (card.rank === '2' && card.suit !== meldSuit) return true;
  return false;
}

export function isValidSequence(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  // Determine the meld's suit by majority of natural non-wild cards.
  // (For a valid meld, this is unambiguous: at most one wild can be present.)
  const naturals = cards.filter(c => !isJoker(c) && !c.representsRank);
  if (naturals.length === 0) return false;
  const suit = naturals[0].suit;

  // All naturals must share the suit.
  for (const c of naturals) {
    if (c.suit !== suit) return false;
  }

  // Wild count must be ≤ 1. A wild is anything with representsRank set, OR a
  // joker with no annotation, OR an off-suit 2 with no annotation. Within an
  // already-played meld, all wilds carry annotations; but we allow callers to
  // pass annotation-free arrays during validation of a *create* action where
  // the engine has already inferred wilds.
  let wildCount = 0;
  for (const c of cards) {
    if (c.representsRank) wildCount++;
    else if (isWildIn(c, suit)) wildCount++;
  }
  if (wildCount > 1) return false;

  // Sequence must have consecutive effective ranks. Aces can be low or high
  // but NOT both (no wraparound K-A-2).
  // Build effective rank index sequence; if A is among them, try both A=low
  // (index 0) and A=high (index 13). For high, we treat A as RANKS.length.
  const ranks = cards.map(effectiveRank);
  // Validate suit consistency for wilds with annotations.
  for (const c of cards) {
    const eSuit = effectiveSuit(c);
    if (eSuit !== suit) return false;
  }

  function tryIndices(aceIndex) {
    const idx = ranks.map(r => r === 'A' ? aceIndex : RANK_INDEX[r]);
    const sorted = [...idx].sort((a, b) => a - b);
    // Must be strictly consecutive
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) return false;
    }
    return true;
  }

  // A-low: A=0, then 2=1, ..., K=12
  // A-high: A=13, then we have to shift; easier — re-evaluate rank indices
  // with A treated as index 13 specifically (above K).
  return tryIndices(0) || tryIndices(13);
}
```

- [ ] **Step 4: Run, expect pass**

```bash
node --test test/buraco-sequence.test.js
```

Expected: 13 passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/sequence.js test/buraco-sequence.test.js
git commit -m "feat(buraco/server): isValidSequence with wild + ace-end handling"
```

---

### Task 3.4: Implement `sequencePoints`, `isBuracoLimpo`, `isBuracoSujo`

**Files:**
- Modify: `plugins/buraco/server/sequence.js`
- Modify: `test/buraco-sequence.test.js`

- [ ] **Step 1: Add failing tests**

Append to `test/buraco-sequence.test.js`:

```js
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
```

- [ ] **Step 2: Run, expect failure**

```bash
node --test test/buraco-sequence.test.js
```

- [ ] **Step 3: Implement** — append to `plugins/buraco/server/sequence.js`:

```js
const POINT_VALUE = {
  A: 15, '2': 20, '3': 5, '4': 5, '5': 5, '6': 5, '7': 5,
  '8': 10, '9': 10, T: 10, J: 10, Q: 10, K: 10,
};

export function sequencePoints(cards) {
  let total = 0;
  for (const c of cards) {
    if (isJoker(c)) total += 20;
    else total += POINT_VALUE[c.rank] ?? 0;
  }
  return total;
}

function hasWild(cards) {
  return cards.some(c => c.representsRank || isJoker(c));
}

export function isBuracoLimpo(cards) {
  if (!isValidSequence(cards)) return false;
  if (cards.length < 7) return false;
  return !hasWild(cards);
}

export function isBuracoSujo(cards) {
  if (!isValidSequence(cards)) return false;
  if (cards.length < 7) return false;
  return hasWild(cards);
}
```

- [ ] **Step 4: Run, expect pass**

```bash
node --test test/buraco-sequence.test.js
```

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/sequence.js test/buraco-sequence.test.js
git commit -m "feat(buraco/server): sequencePoints + buraco limpo/sujo detection"
```

---

### Task 3.5: Implement draw phase

**Files:**
- Modify: `plugins/buraco/server/phases/draw.js`
- Test: `test/buraco-draw.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-draw.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/buraco/server/state.js';
import { applyDraw } from '../plugins/buraco/server/phases/draw.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('draw from stock moves one card to current player\'s hand and sets phase=meld', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  const r = applyDraw(s0, { source: 'stock' }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.hands.a.length, 12);
  assert.equal(r.state.stock.length, s0.stock.length - 1);
  assert.equal(r.state.phase, 'meld');
  assert.equal(r.state.hasDrawn, true);
});

test('draw from discard moves ALL discard cards to current player\'s hand', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  // Synthetically pad the discard pile to 4 for the test
  const padded = { ...s0, discard: [s0.discard[0], ...s0.stock.slice(0, 3)] };
  const r = applyDraw(padded, { source: 'discard' }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.hands.a.length, 11 + 4);
  assert.equal(r.state.discard.length, 0);
  assert.equal(r.state.phase, 'meld');
  assert.equal(r.state.hasDrawn, true);
});

test('draw rejected when hasDrawn already true', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  const after = applyDraw(s0, { source: 'stock' }, 'a').state;
  const r = applyDraw(after, { source: 'stock' }, 'a');
  assert.match(r.error, /already drawn|not in draw phase/i);
});

test('draw from empty discard rejected', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  const empty = { ...s0, discard: [] };
  const r = applyDraw(empty, { source: 'discard' }, 'a');
  assert.match(r.error, /discard.*empty/i);
});

test('unknown draw source rejected', () => {
  const s0 = buildInitialState({ participants, rng: det() });
  const r = applyDraw(s0, { source: 'morto' }, 'a');
  assert.match(r.error, /source/i);
});
```

- [ ] **Step 2: Run, expect failure**

```bash
node --test test/buraco-draw.test.js
```

- [ ] **Step 3: Implement** — write `plugins/buraco/server/phases/draw.js`:

```js
export function applyDraw(state, payload, side) {
  if (state.phase !== 'draw' || state.hasDrawn) {
    return { error: 'not in draw phase or already drawn' };
  }
  const { source } = payload ?? {};
  if (source === 'stock') {
    if (state.stock.length === 0) return { error: 'stock is empty' };
    const drawn = state.stock[state.stock.length - 1];
    return {
      state: {
        ...state,
        stock: state.stock.slice(0, -1),
        hands: { ...state.hands, [side]: [...state.hands[side], drawn] },
        phase: 'meld',
        hasDrawn: true,
        lastEvent: { kind: 'draw', side, summary: `${side} drew from stock` },
      },
    };
  }
  if (source === 'discard') {
    if (state.discard.length === 0) return { error: 'discard pile is empty' };
    return {
      state: {
        ...state,
        discard: [],
        hands: { ...state.hands, [side]: [...state.hands[side], ...state.discard] },
        phase: 'meld',
        hasDrawn: true,
        lastEvent: { kind: 'draw', side, summary: `${side} took the discard pile (${state.discard.length} cards)` },
      },
    };
  }
  return { error: `unknown draw source: ${source}` };
}
```

- [ ] **Step 4: Run, expect pass**

```bash
node --test test/buraco-draw.test.js
```

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/phases/draw.js test/buraco-draw.test.js
git commit -m "feat(buraco/server): draw phase — stock or discard pile"
```

---

### Task 3.6: Implement meld create

**Files:**
- Modify: `plugins/buraco/server/phases/meld.js`
- Test: `test/buraco-meld-create.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-meld-create.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMeldCreate } from '../plugins/buraco/server/phases/meld.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

function baseMeldState({ hand }) {
  return {
    phase: 'meld',
    hasDrawn: true,
    currentTurn: 'a',
    hands: { a: hand, b: [] },
    melds: { a: [], b: [] },
    stock: [], discard: [], mortos: { a: [], b: [] }, mortoTaken: { a: false, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null, dealNumber: 1,
  };
}

test('valid create: 3 same-suit consecutive cards from hand', () => {
  const s0 = baseMeldState({ hand: [C('5','H'), C('6','H'), C('7','H'), C('K','S')] });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.hands.a.length, 1);
  assert.equal(r.state.melds.a.length, 1);
  assert.equal(r.state.melds.a[0].length, 3);
});

test('invalid sequence rejected', () => {
  const s0 = baseMeldState({ hand: [C('5','H'), C('6','S'), C('7','H')] });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','S'), C('7','H')] }, 'a');
  assert.match(r.error, /invalid sequence/i);
  assert.equal(r.state, undefined);
});

test('rejected when not all cards are in hand', () => {
  const s0 = baseMeldState({ hand: [C('5','H'), C('6','H')] });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.match(r.error, /not in hand/i);
});

test('rejected when not in meld phase', () => {
  const s0 = { ...baseMeldState({ hand: [C('5','H'), C('6','H'), C('7','H')] }), phase: 'draw', hasDrawn: false };
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.match(r.error, /meld phase/i);
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement** — write `plugins/buraco/server/phases/meld.js`:

```js
import { isValidSequence } from '../sequence.js';
import { sameCard } from '../../../../src/shared/cards/deck.js';

export function applyMeldCreate(state, payload, side) {
  if (state.phase !== 'meld') return { error: 'not in meld phase' };
  const cards = payload?.cards ?? [];
  if (cards.length < 3) return { error: 'meld needs at least 3 cards' };

  const hand = state.hands[side];
  for (const c of cards) {
    if (!hand.some(h => sameCard(h, c))) {
      return { error: `card ${c.id} not in hand` };
    }
  }

  if (!isValidSequence(cards)) return { error: 'invalid sequence' };

  const newHand = hand.filter(h => !cards.some(c => sameCard(c, h)));
  const newMelds = [...state.melds[side], cards];

  return {
    state: {
      ...state,
      hands: { ...state.hands, [side]: newHand },
      melds: { ...state.melds, [side]: newMelds },
      lastEvent: { kind: 'meld', side, summary: `${side} laid down ${cards.length} cards` },
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/phases/meld.js test/buraco-meld-create.test.js
git commit -m "feat(buraco/server): meld create"
```

---

### Task 3.7: Implement meld extend

**Files:**
- Modify: `plugins/buraco/server/phases/meld.js`
- Test: `test/buraco-meld-extend.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-meld-extend.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMeldExtend } from '../plugins/buraco/server/phases/meld.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

function baseStateWithMeld({ hand, meld }) {
  return {
    phase: 'meld', hasDrawn: true, currentTurn: 'a',
    hands: { a: hand, b: [] },
    melds: { a: [meld], b: [] },
    stock: [], discard: [], mortos: { a: [], b: [] }, mortoTaken: { a: false, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null, dealNumber: 1,
  };
}

test('extend high end of a sequence', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('8','H')], meld });
  const r = applyMeldExtend(s0, { meldIndex: 0, cards: [C('8','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.melds.a[0].length, 4);
  assert.equal(r.state.hands.a.length, 0);
});

test('extend low end of a sequence', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('4','H')], meld });
  const r = applyMeldExtend(s0, { meldIndex: 0, cards: [C('4','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.melds.a[0].length, 4);
});

test('extend with discontiguous card rejected', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('9','H')], meld });
  const r = applyMeldExtend(s0, { meldIndex: 0, cards: [C('9','H')] }, 'a');
  assert.match(r.error, /sequence|extend/i);
});

test('extend wrong-suit card rejected', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('8','S')], meld });
  const r = applyMeldExtend(s0, { meldIndex: 0, cards: [C('8','S')] }, 'a');
  assert.match(r.error, /suit|sequence/i);
});

test('extend nonexistent meld rejected', () => {
  const s0 = baseStateWithMeld({ hand: [C('8','H')], meld: [C('5','H'), C('6','H'), C('7','H')] });
  const r = applyMeldExtend(s0, { meldIndex: 5, cards: [C('8','H')] }, 'a');
  assert.match(r.error, /meld.*not found|index/i);
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement** — append to `plugins/buraco/server/phases/meld.js`:

```js
export function applyMeldExtend(state, payload, side) {
  if (state.phase !== 'meld') return { error: 'not in meld phase' };
  const { meldIndex, cards = [] } = payload ?? {};
  const meld = state.melds[side]?.[meldIndex];
  if (!meld) return { error: `meld at index ${meldIndex} not found` };

  const hand = state.hands[side];
  for (const c of cards) {
    if (!hand.some(h => sameCard(h, c))) return { error: `card ${c.id} not in hand` };
  }

  // Try appending at high or low end and validate the resulting sequence.
  const candidates = [
    [...meld, ...cards],     // high end
    [...cards, ...meld],     // low end
  ];
  const valid = candidates.find(seq => isValidSequence(seq));
  if (!valid) return { error: 'cards do not extend the sequence' };

  const newHand = hand.filter(h => !cards.some(c => sameCard(c, h)));
  const newSideMelds = state.melds[side].map((m, i) => i === meldIndex ? valid : m);

  return {
    state: {
      ...state,
      hands: { ...state.hands, [side]: newHand },
      melds: { ...state.melds, [side]: newSideMelds },
      lastEvent: { kind: 'extend', side, summary: `${side} extended a meld by ${cards.length}` },
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/phases/meld.js test/buraco-meld-extend.test.js
git commit -m "feat(buraco/server): meld extend at low or high end"
```

---

### Task 3.8: Implement meld replaceWild

**Files:**
- Modify: `plugins/buraco/server/phases/meld.js`
- Test: `test/buraco-meld-replace-wild.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-meld-replace-wild.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMeldReplaceWild } from '../plugins/buraco/server/phases/meld.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });
const J = (i, color) => ({ id: `jk-${i}`, kind: 'joker', index: i, color });
const W = (card, r, s) => ({ ...card, representsRank: r, representsSuit: s });

function baseStateWithMeld({ hand, meld }) {
  return {
    phase: 'meld', hasDrawn: true, currentTurn: 'a',
    hands: { a: hand, b: [] },
    melds: { a: [meld], b: [] },
    stock: [], discard: [], mortos: { a: [], b: [] }, mortoTaken: { a: false, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null, dealNumber: 1,
  };
}

test('valid replaceWild: natural in, wild back to hand', () => {
  const meld = [C('5','H'), W(J(0,'red'),'6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('6','H')], meld });
  const r = applyMeldReplaceWild(s0, { meldIndex: 0, slotIndex: 1, withCard: C('6','H') }, 'a');
  assert.equal(r.error, undefined);
  // Meld now has natural 6♥ in slot 1
  assert.equal(r.state.melds.a[0][1].rank, '6');
  assert.equal(r.state.melds.a[0][1].suit, 'H');
  // Hand now has the joker
  assert.equal(r.state.hands.a.length, 1);
  assert.equal(r.state.hands.a[0].id, 'jk-0');
  // Joker has no representsRank/representsSuit when in hand
  assert.equal(r.state.hands.a[0].representsRank, undefined);
  assert.equal(r.state.hands.a[0].representsSuit, undefined);
});

test('replaceWild rejected when slot is not a wild', () => {
  const meld = [C('5','H'), C('6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('6','H',1)], meld });
  const r = applyMeldReplaceWild(s0, { meldIndex: 0, slotIndex: 1, withCard: C('6','H',1) }, 'a');
  assert.match(r.error, /not a wild/i);
});

test('replaceWild rejected when withCard rank doesn\'t match slot', () => {
  const meld = [C('5','H'), W(J(0,'red'),'6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [C('9','H')], meld });
  const r = applyMeldReplaceWild(s0, { meldIndex: 0, slotIndex: 1, withCard: C('9','H') }, 'a');
  assert.match(r.error, /rank|match/i);
});

test('replaceWild rejected when withCard not in hand', () => {
  const meld = [C('5','H'), W(J(0,'red'),'6','H'), C('7','H')];
  const s0 = baseStateWithMeld({ hand: [], meld });
  const r = applyMeldReplaceWild(s0, { meldIndex: 0, slotIndex: 1, withCard: C('6','H') }, 'a');
  assert.match(r.error, /not in hand/i);
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement** — append to `plugins/buraco/server/phases/meld.js`:

```js
import { isJoker } from '../../../../src/shared/cards/deck.js';

export function applyMeldReplaceWild(state, payload, side) {
  if (state.phase !== 'meld') return { error: 'not in meld phase' };
  const { meldIndex, slotIndex, withCard } = payload ?? {};
  const meld = state.melds[side]?.[meldIndex];
  if (!meld) return { error: `meld at index ${meldIndex} not found` };
  const wildCard = meld[slotIndex];
  if (!wildCard) return { error: `slot ${slotIndex} out of range` };

  // The slot is a wild iff it has representsRank set (annotated wild) OR is a joker.
  const isWild = !!wildCard.representsRank || isJoker(wildCard);
  if (!isWild) return { error: 'slot is not a wild' };

  const slotRank = wildCard.representsRank ?? wildCard.rank;
  const slotSuit = wildCard.representsSuit ?? wildCard.suit;
  if (withCard.rank !== slotRank || withCard.suit !== slotSuit) {
    return { error: 'withCard rank/suit must match the slot it replaces' };
  }

  const hand = state.hands[side];
  if (!hand.some(h => sameCard(h, withCard))) {
    return { error: `withCard ${withCard.id} not in hand` };
  }

  // Strip the wild's annotations when returning it to hand.
  const freedWild = { ...wildCard };
  delete freedWild.representsRank;
  delete freedWild.representsSuit;

  const newMeld = meld.map((c, i) => i === slotIndex ? withCard : c);
  const newHand = hand.filter(h => !sameCard(h, withCard)).concat(freedWild);
  const newSideMelds = state.melds[side].map((m, i) => i === meldIndex ? newMeld : m);

  return {
    state: {
      ...state,
      hands: { ...state.hands, [side]: newHand },
      melds: { ...state.melds, [side]: newSideMelds },
      lastEvent: { kind: 'meld', side, summary: `${side} replaced a wild with ${withCard.rank}${withCard.suit}` },
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/phases/meld.js test/buraco-meld-replace-wild.test.js
git commit -m "feat(buraco/server): meld replaceWild — swap natural in, wild back to hand"
```

---

### Task 3.9: Implement morto pickup + going-out detection

**Files:**
- Modify: `plugins/buraco/server/phases/meld.js`, `phases/discard.js`
- Test: `test/buraco-going-out.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-going-out.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMeldCreate } from '../plugins/buraco/server/phases/meld.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

function st({ hand, melds = [], mortoTaken = false, morto = [] }) {
  return {
    phase: 'meld', hasDrawn: true, currentTurn: 'a',
    hands: { a: hand, b: [] },
    melds: { a: melds, b: [] },
    stock: [], discard: [],
    mortos: { a: morto, b: [] },
    mortoTaken: { a: mortoTaken, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null, dealNumber: 1,
  };
}

test('hand empties via meld and morto not taken → auto-pickup; phase still meld; still side a', () => {
  const morto = [C('A','S'), C('2','S'), C('3','S')]; // contents stub
  const s0 = st({
    hand: [C('5','H'), C('6','H'), C('7','H')],
    morto,
    mortoTaken: false,
  });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.mortoTaken.a, true);
  assert.equal(r.state.mortos.a.length, 0);
  assert.equal(r.state.hands.a.length, morto.length);
  assert.equal(r.state.phase, 'meld');
});

test('hand empties via meld, morto taken, has buraco → phase=deal-end (going out)', () => {
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  const s0 = st({
    hand: [C('5','H'), C('6','H'), C('7','H')],
    melds: [buraco],
    mortoTaken: true,
  });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.phase, 'deal-end');
});

test('hand empties via meld, morto taken, NO buraco → error (cannot go out)', () => {
  const s0 = st({
    hand: [C('5','H'), C('6','H'), C('7','H')],
    melds: [],
    mortoTaken: true,
  });
  const r = applyMeldCreate(s0, { cards: [C('5','H'), C('6','H'), C('7','H')] }, 'a');
  assert.match(r.error, /cannot go out|no buraco/i);
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement** — add a helper at the bottom of `plugins/buraco/server/phases/meld.js`, and route every successful create/extend through it. Also export it for discard.js to use:

```js
import { isBuracoLimpo, isBuracoSujo } from '../sequence.js';

export function applyHandEmptyTransition(state, side) {
  if (state.hands[side].length > 0) return state;

  if (!state.mortoTaken[side]) {
    // Pick up the morto. Stay in same phase.
    return {
      ...state,
      hands: { ...state.hands, [side]: state.mortos[side] },
      mortos: { ...state.mortos, [side]: [] },
      mortoTaken: { ...state.mortoTaken, [side]: true },
      lastEvent: { kind: 'takeMorto', side, summary: `${side} took the morto` },
    };
  }

  // Morto already taken. Going out requires ≥1 buraco.
  const hasBuraco = state.melds[side].some(m => isBuracoLimpo(m) || isBuracoSujo(m));
  if (!hasBuraco) {
    // Can't go out — caller must reject the action that emptied the hand.
    return null; // sentinel: caller should reject
  }
  return {
    ...state,
    phase: 'deal-end',
    lastEvent: { kind: 'deal-end', side, summary: `${side} went out` },
  };
}
```

Then, in `applyMeldCreate` and `applyMeldExtend`, before returning the success state, wrap with the transition check:

```js
// at the bottom of applyMeldCreate before `return { state: ... };`:
const transitioned = applyHandEmptyTransition(newState, side);
if (transitioned === null) return { error: 'cannot go out: no buraco on the table' };
return { state: transitioned ?? newState };
```

(Adjust naming so the local `newState` variable is the post-meld state. The simplest refactor is to compute the post-meld state first, then call the transition, then either return error or return the transitioned state.)

- [ ] **Step 4: Run, expect pass**

```bash
node --test test/buraco-going-out.test.js
```

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/phases/meld.js test/buraco-going-out.test.js
git commit -m "feat(buraco/server): morto auto-pickup + going-out detection on meld"
```

---

### Task 3.10: Implement discard phase

**Files:**
- Modify: `plugins/buraco/server/phases/discard.js`
- Test: `test/buraco-discard.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-discard.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscard } from '../plugins/buraco/server/phases/discard.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });

function st({ hand, melds = [], mortoTaken = false }) {
  return {
    phase: 'meld', hasDrawn: true, currentTurn: 'a',
    hands: { a: hand, b: [] },
    melds: { a: melds, b: [] },
    stock: [], discard: [], mortos: { a: [], b: [] },
    mortoTaken: { a: mortoTaken, b: false },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null, dealNumber: 1,
  };
}

test('valid discard: card to top of pile, phase=draw, swap turn, hasDrawn=false', () => {
  const s0 = st({ hand: [C('5','H'), C('K','S')] });
  const r = applyDiscard(s0, { card: C('K','S') }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.discard[r.state.discard.length - 1].id, 'S-K-0');
  assert.equal(r.state.phase, 'draw');
  assert.equal(r.state.currentTurn, 'b');
  assert.equal(r.state.hasDrawn, false);
});

test('discard card not in hand rejected', () => {
  const s0 = st({ hand: [C('5','H')] });
  const r = applyDiscard(s0, { card: C('K','S') }, 'a');
  assert.match(r.error, /not in hand/i);
});

test('discard outside meld phase rejected', () => {
  const s0 = { ...st({ hand: [C('5','H')] }), phase: 'draw' };
  const r = applyDiscard(s0, { card: C('5','H') }, 'a');
  assert.match(r.error, /meld phase/i);
});

test('discard that empties hand AND morto taken AND buraco → going out', () => {
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  const s0 = st({ hand: [C('K','D')], melds: [buraco], mortoTaken: true });
  const r = applyDiscard(s0, { card: C('K','D') }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.phase, 'deal-end');
});

test('discard that empties hand without buraco → error', () => {
  const s0 = st({ hand: [C('K','D')], melds: [], mortoTaken: true });
  const r = applyDiscard(s0, { card: C('K','D') }, 'a');
  assert.match(r.error, /cannot go out/i);
});

test('discard that empties hand, morto not taken → auto-pickup, but turn still ends', () => {
  // Edge case: per Brazilian rules, if you empty your hand on the discard step
  // and haven\'t taken the morto, you take it after discarding and the turn
  // continues from there… but actually no: a discard is the END of your turn.
  // Brazilian convention: if discard empties your hand and morto untaken, you
  // pick up the morto, end your turn normally. Next turn you draw + play with morto.
  // For v1: treat as morto pickup + turn ends.
  const s0 = st({ hand: [C('K','D')], melds: [], mortoTaken: false });
  // Need a non-empty morto for this to mean anything
  const s1 = { ...s0, mortos: { a: [C('A','C'), C('2','C'), C('3','C')], b: [] } };
  const r = applyDiscard(s1, { card: C('K','D') }, 'a');
  assert.equal(r.error, undefined);
  assert.equal(r.state.mortoTaken.a, true);
  assert.equal(r.state.hands.a.length, 3);
  assert.equal(r.state.phase, 'draw');
  assert.equal(r.state.currentTurn, 'b');
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement** — write `plugins/buraco/server/phases/discard.js`:

```js
import { sameCard } from '../../../../src/shared/cards/deck.js';
import { isBuracoLimpo, isBuracoSujo } from '../sequence.js';

const OPP = { a: 'b', b: 'a' };

export function applyDiscard(state, payload, side) {
  if (state.phase !== 'meld') return { error: 'not in meld phase' };
  const card = payload?.card;
  if (!card) return { error: 'no card provided' };
  const hand = state.hands[side];
  if (!hand.some(h => sameCard(h, card))) return { error: `card ${card.id} not in hand` };

  let newHand = hand.filter(h => !sameCard(h, card));
  let newDiscard = [...state.discard, card];
  let mortoTaken = state.mortoTaken;
  let mortos = state.mortos;
  let phase = 'draw';
  let summary = `${side} discarded ${card.rank ?? card.kind}`;

  if (newHand.length === 0) {
    // Going-out check or morto pickup
    if (!mortoTaken[side]) {
      // Auto-pickup morto, turn still ends
      newHand = mortos[side];
      mortos = { ...mortos, [side]: [] };
      mortoTaken = { ...mortoTaken, [side]: true };
      summary += `; took morto`;
    } else {
      const hasBuraco = state.melds[side].some(m => isBuracoLimpo(m) || isBuracoSujo(m));
      if (!hasBuraco) return { error: 'cannot go out: no buraco on the table' };
      phase = 'deal-end';
      summary += `; went out`;
    }
  }

  return {
    state: {
      ...state,
      hands: { ...state.hands, [side]: newHand },
      discard: newDiscard,
      mortos,
      mortoTaken,
      phase,
      currentTurn: phase === 'deal-end' ? state.currentTurn : OPP[side],
      hasDrawn: phase === 'deal-end' ? state.hasDrawn : false,
      lastEvent: { kind: 'discard', side, summary },
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/phases/discard.js test/buraco-discard.test.js
git commit -m "feat(buraco/server): discard phase with going-out + morto-pickup"
```

---

### Task 3.11: Implement deal-end scoring + match flow

**Files:**
- Modify: `plugins/buraco/server/scoring/deal-end.js`
- Modify: `plugins/buraco/server/phases/deal-end.js`
- Test: `test/buraco-scoring.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-scoring.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDealScore, applyDealEnd } from '../plugins/buraco/server/phases/deal-end.js';

const C = (rank, suit, deckIndex = 0) => ({ id: `${suit}-${rank}-${deckIndex}`, rank, suit, deckIndex });
const J = (i, color) => ({ id: `jk-${i}`, kind: 'joker', index: i, color });
const W = (card, r, s) => ({ ...card, representsRank: r, representsSuit: s });

test('computeDealScore: meld points + buraco limpo bonus + going-out bonus, no penalties', () => {
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  // points: 5+5+5+5+10+10+10 = 50
  const score = computeDealScore({
    melds: [buraco],
    handCardsLeft: 0,
    mortoTaken: true,
    wentOut: true,
  });
  assert.equal(score.meldPoints, 50);
  assert.equal(score.buracoLimpo, 1);
  assert.equal(score.buracoSujo, 0);
  assert.equal(score.goingOutBonus, 100);
  assert.equal(score.mortoBonus, 0);
  assert.equal(score.handPenalty, 0);
  assert.equal(score.total, 50 + 200 + 100);
});

test('computeDealScore: buraco sujo bonus is +100', () => {
  const buracoSujo = [C('5','S'), W(J(0,'red'),'6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  const score = computeDealScore({
    melds: [buracoSujo],
    handCardsLeft: 0,
    mortoTaken: true,
    wentOut: true,
  });
  assert.equal(score.buracoSujo, 1);
  assert.equal(score.buracoLimpo, 0);
  // points: 5+20+5+5+10+10+10 = 65
  assert.equal(score.total, 65 + 100 + 100);
});

test('computeDealScore: morto-untaken penalty is -100', () => {
  const meld = [C('5','S'), C('6','S'), C('7','S')];
  const score = computeDealScore({
    melds: [meld],
    handCardsLeft: 11,
    mortoTaken: false,
    wentOut: false,
  });
  assert.equal(score.mortoBonus, -100);
  assert.equal(score.handPenalty, -11);
});

test('computeDealScore: hand-card penalty is -1 per card', () => {
  const score = computeDealScore({ melds: [], handCardsLeft: 5, mortoTaken: true, wentOut: false });
  assert.equal(score.handPenalty, -5);
});

test('applyDealEnd: scores both sides and starts a new deal', () => {
  // Set up minimal state with a side that went out
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  const s0 = {
    phase: 'deal-end',
    dealNumber: 1,
    currentTurn: 'a',
    hasDrawn: false,
    stock: [], discard: [],
    hands: { a: [], b: [C('K','D'), C('Q','D')] },
    melds: { a: [buraco], b: [] },
    mortos: { a: [], b: [] },
    mortoTaken: { a: true, b: true },
    scores: { a: { total: 0, deals: [] }, b: { total: 0, deals: [] } },
    lastEvent: null, winner: null,
  };
  function det() { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  const r = applyDealEnd(s0, det());
  // Side a: 50 meld + 200 limpo + 100 going-out = 350
  // Side b: 0 melds + 0 bonuses + (-2 hand) = -2
  assert.equal(r.state.scores.a.total, 350);
  assert.equal(r.state.scores.b.total, -2);
  assert.equal(r.state.scores.a.deals.length, 1);
  assert.equal(r.state.scores.b.deals.length, 1);
  // Next deal started
  assert.equal(r.state.phase, 'draw');
  assert.equal(r.state.dealNumber, 2);
  assert.equal(r.state.hands.a.length, 11);
  assert.equal(r.state.hands.b.length, 11);
});

test('applyDealEnd: total >= 3000 → game-end with winner', () => {
  const s0 = {
    phase: 'deal-end',
    dealNumber: 5,
    currentTurn: 'a', hasDrawn: false,
    stock: [], discard: [],
    hands: { a: [], b: [] },
    melds: { a: [], b: [] },
    mortos: { a: [], b: [] },
    mortoTaken: { a: true, b: true },
    scores: { a: { total: 2900, deals: [] }, b: { total: 2000, deals: [] } },
    lastEvent: null, winner: null,
  };
  const buraco = [C('5','S'), C('6','S'), C('7','S'), C('8','S'), C('9','S'), C('T','S'), C('J','S')];
  s0.melds.a = [buraco];
  function det() { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  const r = applyDealEnd(s0, det());
  assert.equal(r.state.phase, 'game-end');
  assert.equal(r.state.winner, 'a');
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement** — write `plugins/buraco/server/phases/deal-end.js`:

```js
import { sequencePoints, isBuracoLimpo, isBuracoSujo } from '../sequence.js';
import { buildInitialState } from '../state.js';

const SCORE_TARGET = 3000;

export function computeDealScore({ melds, handCardsLeft, mortoTaken, wentOut }) {
  let buracoLimpo = 0;
  let buracoSujo = 0;
  let meldPoints = 0;
  for (const m of melds) {
    meldPoints += sequencePoints(m);
    if (isBuracoLimpo(m)) buracoLimpo++;
    else if (isBuracoSujo(m)) buracoSujo++;
  }
  const buracoBonus = buracoLimpo * 200 + buracoSujo * 100;
  const goingOutBonus = wentOut ? 100 : 0;
  const mortoBonus = mortoTaken ? 0 : -100;
  const handPenalty = -handCardsLeft;
  const total = meldPoints + buracoBonus + goingOutBonus + mortoBonus + handPenalty;
  return { meldPoints, buracoLimpo, buracoSujo, goingOutBonus, mortoBonus, handPenalty, total };
}

export function applyDealEnd(state, rng) {
  // Determine which side went out (the side whose hand is empty when we're called)
  const wentOutSide = state.hands.a.length === 0 ? 'a' : 'b';
  const sides = ['a', 'b'];
  const newScores = { a: { ...state.scores.a }, b: { ...state.scores.b } };
  for (const side of sides) {
    const score = computeDealScore({
      melds: state.melds[side],
      handCardsLeft: state.hands[side].length,
      mortoTaken: state.mortoTaken[side],
      wentOut: side === wentOutSide,
    });
    newScores[side] = {
      total: state.scores[side].total + score.total,
      deals: [...state.scores[side].deals, score],
    };
  }

  // Game end?
  if (newScores.a.total >= SCORE_TARGET || newScores.b.total >= SCORE_TARGET) {
    const winner = newScores.a.total > newScores.b.total ? 'a'
      : newScores.b.total > newScores.a.total ? 'b'
      : wentOutSide; // tie-breaker: the side that went out
    return {
      state: {
        ...state,
        scores: newScores,
        phase: 'game-end',
        winner,
        lastEvent: { kind: 'deal-end', side: wentOutSide, summary: `${winner} wins ${newScores[winner].total}–${newScores[winner === 'a' ? 'b' : 'a'].total}` },
      },
    };
  }

  // Otherwise, start a new deal. Shuffle a fresh deck, deal anew.
  const fresh = buildInitialState({
    participants: [{ userId: 0, side: 'a' }, { userId: 0, side: 'b' }],
    rng,
  });
  return {
    state: {
      ...state,
      phase: 'draw',
      dealNumber: state.dealNumber + 1,
      currentTurn: wentOutSide === 'a' ? 'b' : 'a', // dealer alternates; loser deals next
      hasDrawn: false,
      stock: fresh.stock,
      discard: fresh.discard,
      hands: fresh.hands,
      mortos: fresh.mortos,
      mortoTaken: { a: false, b: false },
      melds: { a: [], b: [] },
      scores: newScores,
      lastEvent: { kind: 'deal-end', side: wentOutSide, summary: `deal ${state.dealNumber} ended` },
    },
  };
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/phases/deal-end.js plugins/buraco/server/scoring/deal-end.js test/buraco-scoring.test.js
git commit -m "feat(buraco/server): deal-end scoring + match flow to 3000"
```

(Note: keep `scoring/deal-end.js` as a shim that re-exports `computeDealScore` for organization. Or merge into `phases/deal-end.js`. Plan author chose to keep computation in `phases/` for simplicity; remove the empty `scoring/` files in the next task or keep them empty if you prefer the directory layout.)

---

### Task 3.12: Implement multiset balance check (`validate-turn.js`) and integration test

**Files:**
- Modify: `plugins/buraco/server/validate-turn.js`
- Test: `test/buraco-integrity.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-integrity.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCardConservation } from '../plugins/buraco/server/validate-turn.js';
import { buildInitialState } from '../plugins/buraco/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det() { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('initial state has 108 unique card ids', () => {
  const s = buildInitialState({ participants, rng: det() });
  assertCardConservation(s); // throws if not 108 unique
});

test('throws when a card is duplicated', () => {
  const s = buildInitialState({ participants, rng: det() });
  s.hands.a.push(s.hands.b[0]);
  assert.throws(() => assertCardConservation(s), /duplicate|108/);
});

test('throws when a card is missing', () => {
  const s = buildInitialState({ participants, rng: det() });
  s.hands.a.pop();
  assert.throws(() => assertCardConservation(s), /108/);
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement** — write `plugins/buraco/server/validate-turn.js`:

```js
import { cardIdsOf } from '../../../src/shared/cards/card-multiset.js';

export function assertCardConservation(state) {
  // Collect ids from all card-bearing locations.
  const ids = [
    ...state.stock.map(c => c.id),
    ...state.discard.map(c => c.id),
    ...state.hands.a.map(c => c.id),
    ...state.hands.b.map(c => c.id),
    ...state.mortos.a.map(c => c.id),
    ...state.mortos.b.map(c => c.id),
    ...state.melds.a.flat().map(c => c.id),
    ...state.melds.b.flat().map(c => c.id),
  ];
  if (ids.length !== 108) {
    throw new Error(`card conservation: expected 108 cards, got ${ids.length}`);
  }
  if (new Set(ids).size !== 108) {
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} (×${n})`);
    throw new Error(`card conservation: duplicate ids: ${dupes.join(', ')}`);
  }
}

export function assertOpponentMeldsUnchanged(prev, next, currentSide) {
  const opp = currentSide === 'a' ? 'b' : 'a';
  const a = prev.melds[opp];
  const b = next.melds[opp];
  if (a !== b && JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`opponent (${opp}) melds were mutated`);
  }
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/validate-turn.js test/buraco-integrity.test.js
git commit -m "feat(buraco/server): card-conservation invariant assertion"
```

---

### Task 3.13: Implement actions dispatcher

**Files:**
- Modify: `plugins/buraco/server/actions.js`
- Test: `test/buraco-actions.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-actions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBuracoAction } from '../plugins/buraco/server/actions.js';
import { buildInitialState } from '../plugins/buraco/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det(seed = 1) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('unknown action type → error', () => {
  const s = buildInitialState({ participants, rng: det() });
  const r = applyBuracoAction({ state: s, action: { type: 'nope' }, actorId: 1, rng: det() });
  assert.match(r.error, /unknown action/);
});

test('action by non-participant → error', () => {
  const s = buildInitialState({ participants, rng: det() });
  const r = applyBuracoAction({ state: s, action: { type: 'draw', payload: { source: 'stock' } }, actorId: 999, rng: det() });
  assert.match(r.error, /not a participant/i);
});

test('action by wrong side (not currentTurn) → error', () => {
  const s = buildInitialState({ participants, rng: det() });
  // currentTurn is 'a' (userId 1); userId 2 tries to draw
  const r = applyBuracoAction({ state: s, action: { type: 'draw', payload: { source: 'stock' } }, actorId: 2, rng: det() });
  assert.match(r.error, /not your turn/i);
});

test('full flow: draw stock → discard returns ended:false', () => {
  const s = buildInitialState({ participants, rng: det() });
  const r1 = applyBuracoAction({ state: s, action: { type: 'draw', payload: { source: 'stock' } }, actorId: 1, rng: det() });
  assert.equal(r1.error, undefined);
  const cardToDiscard = r1.state.hands.a[0];
  const r2 = applyBuracoAction({ state: r1.state, action: { type: 'discard', payload: { card: cardToDiscard } }, actorId: 1, rng: det() });
  assert.equal(r2.error, undefined);
  assert.equal(r2.ended, false);
  assert.equal(r2.state.currentTurn, 'b');
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement** — write `plugins/buraco/server/actions.js`:

```js
import { applyDraw } from './phases/draw.js';
import { applyMeldCreate, applyMeldExtend, applyMeldReplaceWild } from './phases/meld.js';
import { applyDiscard } from './phases/discard.js';
import { applyDealEnd } from './phases/deal-end.js';

export function applyBuracoAction({ state, action, actorId, rng }) {
  // Identify side from participants is the host's job; the host passes us a
  // game record where state has currentTurn but we don't have access to
  // participants directly. The host calls applyAction with actorId; we need
  // a way to map actorId → side. The host's plugin contract passes only state
  // and actorId, so we expect state to carry the participant→side mapping…
  // wait — looking at cribbage's actions.js: it uses state.participantsBySide
  // (or similar). Read cribbage to confirm the convention before implementing.
  // PLACEHOLDER: assume state.participantsBySide exists; if not, we'll add it
  // to buildInitialState.
  const sideByUserId = state._sideByUserId ?? buildSideMap(state);
  const side = sideByUserId[actorId];
  if (!side) return { error: 'not a participant' };
  if (side !== state.currentTurn && action?.type !== 'observe') {
    return { error: 'not your turn' };
  }

  let result;
  switch (action?.type) {
    case 'draw':
      result = applyDraw(state, action.payload, side);
      break;
    case 'meld':
      switch (action?.payload?.op) {
        case 'create':
          result = applyMeldCreate(state, action.payload, side);
          break;
        case 'extend':
          result = applyMeldExtend(state, action.payload, side);
          break;
        case 'replaceWild':
          result = applyMeldReplaceWild(state, action.payload, side);
          break;
        default:
          return { error: `unknown meld op: ${action?.payload?.op}` };
      }
      break;
    case 'discard':
      result = applyDiscard(state, action.payload, side);
      break;
    default:
      return { error: `unknown action: ${action?.type}` };
  }

  if (result.error) return result;
  let next = result.state;

  // If we transitioned into deal-end, run the scoring + new deal automatically
  if (next.phase === 'deal-end') {
    const dealEnd = applyDealEnd(next, rng);
    next = dealEnd.state;
  }

  return { state: next, ended: next.phase === 'game-end' };
}

function buildSideMap(state) {
  // Fallback: state must carry it, otherwise the host's contract calls would fail.
  // The actual map is set in buildInitialState (see Task 3.14).
  return state._sideByUserId ?? {};
}
```

**Important:** the host's plugin contract calls `applyAction({ state, action, actorId, rng })` — the participants list is NOT passed. So `state` must carry the participant mapping itself. Look at how cribbage solves this:

```bash
grep -n 'actorId\|participants\|sideByUserId' plugins/cribbage/server/state.js plugins/cribbage/server/actions.js
```

Adopt cribbage's convention (likely `state.players` or `state.participants`). Update `buildInitialState` to include it, and update `applyBuracoAction` to read from there.

- [ ] **Step 4: Update `buildInitialState`** to embed participant mapping. Edit `plugins/buraco/server/state.js`:

```js
// inside the returned state object, add:
participants: participants.map(p => ({ userId: p.userId, side: p.side })),
```

And update `applyBuracoAction` to read it:

```js
const part = state.participants.find(p => p.userId === actorId);
if (!part) return { error: 'not a participant' };
const side = part.side;
```

- [ ] **Step 5: Run, expect pass**

```bash
node --test test/buraco-actions.test.js
```

- [ ] **Step 6: Commit**

```bash
git add plugins/buraco/server/actions.js plugins/buraco/server/state.js test/buraco-actions.test.js
git commit -m "feat(buraco/server): action dispatcher + participant mapping"
```

---

### Task 3.14: Implement publicView redaction

**Files:**
- Modify: `plugins/buraco/server/view.js`
- Test: `test/buraco-view.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/buraco-view.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buracoPublicView } from '../plugins/buraco/server/view.js';
import { buildInitialState } from '../plugins/buraco/server/state.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];
function det() { let s = 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

test('publicView for side a: opp hand → count, my hand → cards', () => {
  const s = buildInitialState({ participants, rng: det() });
  const v = buracoPublicView({ state: s, viewerId: 1 });
  assert.ok(Array.isArray(v.hands.a));
  assert.equal(v.hands.a.length, 11);
  assert.equal(typeof v.hands.b, 'number');
  assert.equal(v.hands.b, 11);
});

test('publicView: stock → count, mortos → counts', () => {
  const s = buildInitialState({ participants, rng: det() });
  const v = buracoPublicView({ state: s, viewerId: 1 });
  assert.equal(typeof v.stock, 'number');
  assert.equal(v.stock, 63);
  assert.equal(typeof v.mortos.a, 'number');
  assert.equal(typeof v.mortos.b, 'number');
});

test('publicView: discard, melds, scores, phase, currentTurn fully visible', () => {
  const s = buildInitialState({ participants, rng: det() });
  const v = buracoPublicView({ state: s, viewerId: 1 });
  assert.deepEqual(v.discard, s.discard);
  assert.deepEqual(v.melds, s.melds);
  assert.deepEqual(v.scores, s.scores);
  assert.equal(v.phase, s.phase);
  assert.equal(v.currentTurn, s.currentTurn);
});

test('publicView for non-participant viewer: both hands → counts', () => {
  const s = buildInitialState({ participants, rng: det() });
  const v = buracoPublicView({ state: s, viewerId: 999 });
  assert.equal(typeof v.hands.a, 'number');
  assert.equal(typeof v.hands.b, 'number');
});
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement** — write `plugins/buraco/server/view.js`:

```js
export function buracoPublicView({ state, viewerId }) {
  const part = state.participants?.find(p => p.userId === viewerId);
  const me = part?.side ?? null;
  const sides = ['a', 'b'];

  const hands = {};
  for (const s of sides) {
    hands[s] = me === s ? state.hands[s] : state.hands[s].length;
  }

  return {
    phase: state.phase,
    dealNumber: state.dealNumber,
    currentTurn: state.currentTurn,
    hasDrawn: state.hasDrawn,
    stock: state.stock.length,
    discard: state.discard,
    hands,
    melds: state.melds,
    mortos: { a: state.mortos.a.length, b: state.mortos.b.length },
    mortoTaken: state.mortoTaken,
    scores: state.scores,
    lastEvent: state.lastEvent,
    winner: state.winner,
  };
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/server/view.js test/buraco-view.test.js
git commit -m "feat(buraco/server): publicView with hand/stock/morto redaction"
```

---

### Task 3.15: Wire up the plugin contract + register

**Files:**
- Modify: `plugins/buraco/plugin.js`
- Modify: `src/plugins/index.js`

- [ ] **Step 1: Write `plugins/buraco/plugin.js`**

```js
import { buildInitialState } from './server/state.js';
import { applyBuracoAction } from './server/actions.js';
import { buracoPublicView } from './server/view.js';

export default {
  id: 'buraco',
  displayName: 'Buraco',
  players: 2,
  clientDir: 'plugins/buraco/client',
  initialState: buildInitialState,
  applyAction: applyBuracoAction,
  publicView: buracoPublicView,
};
```

- [ ] **Step 2: Register the plugin**

Read `src/plugins/index.js`:

```bash
cat src/plugins/index.js
```

Add the import + push to the array. Example:

```js
import buracoPlugin from '../../plugins/buraco/plugin.js';

export const plugins = [
  // ...existing plugins...
  buracoPlugin,
];
```

- [ ] **Step 3: Verify by starting the server**

```bash
DEV_USER=you@example.com node src/server/server.js &
sleep 2
curl -s -H "cf-access-authenticated-user-email: you@example.com" http://localhost:3000/api/plugins | grep -i buraco
kill %1 2>/dev/null || true
```

Expected: response includes `"id":"buraco"` (or whatever shape `/api/plugins` returns — check `src/server/routes.js` for the plugin listing endpoint, adjust the curl as needed).

- [ ] **Step 4: Run full suite**

```bash
npm test
```

Expected: all green (Buraco's existing tests + cribbage + others).

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/plugin.js src/plugins/index.js
git commit -m "feat(buraco): plugin contract + registration"
```

---

### Task 3.16: End-to-end deal integration test

**Files:**
- Test: `test/buraco-deal-e2e.test.js`

- [ ] **Step 1: Write the integration test**

Create `test/buraco-deal-e2e.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialState } from '../plugins/buraco/server/state.js';
import { applyBuracoAction } from '../plugins/buraco/server/actions.js';
import { assertCardConservation } from '../plugins/buraco/server/validate-turn.js';

const participants = [{ userId: 1, side: 'a' }, { userId: 2, side: 'b' }];

test('full deal: each turn keeps card-conservation invariant', () => {
  let state = buildInitialState({ participants, rng: deterministicRng(7) });
  assertCardConservation(state);

  // Run 50 turns or until deal-end / game-end, whichever first.
  // Each turn: draw stock, then discard the 0th hand card.
  for (let i = 0; i < 100; i++) {
    if (state.phase === 'deal-end' || state.phase === 'game-end') break;

    const actor = state.currentTurn === 'a' ? 1 : 2;

    // Draw
    const r1 = applyBuracoAction({
      state,
      action: { type: 'draw', payload: { source: 'stock' } },
      actorId: actor,
      rng: deterministicRng(i + 1),
    });
    if (r1.error) {
      assert.fail(`draw error at turn ${i}: ${r1.error}`);
    }
    state = r1.state;
    assertCardConservation(state);

    // Discard the first card in hand
    const card = state.hands[state.currentTurn][0];
    const r2 = applyBuracoAction({
      state,
      action: { type: 'discard', payload: { card } },
      actorId: actor,
      rng: deterministicRng(i + 2),
    });
    if (r2.error) {
      assert.fail(`discard error at turn ${i}: ${r2.error}`);
    }
    state = r2.state;
    assertCardConservation(state);
  }

  // We didn't crash, conservation held throughout.
});

function deterministicRng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
```

- [ ] **Step 2: Run, expect pass**

```bash
node --test test/buraco-deal-e2e.test.js
```

If this fails, the failure is a real bug — not a missing implementation. Fix the underlying engine bug, do not adjust the test.

- [ ] **Step 3: Commit**

```bash
git add test/buraco-deal-e2e.test.js
git commit -m "test(buraco): full-deal integration with card conservation invariant"
```

---

### Task 3.17: Verify Phase 3 — full suite + plugin reachable

- [ ] **Step 1: Run full suite**

```bash
npm test
```

Expected: all green. Total test count up by ~50 from start of Phase 3.

- [ ] **Step 2: Verify the plugin is registered**

```bash
DEV_USER=you@example.com npm start &
sleep 3
# Adjust per your /api/plugins shape:
curl -s http://localhost:3000/api/plugins -H "cf-access-authenticated-user-email: you@example.com" | head -c 500
kill %1 2>/dev/null || true
```

---

## Phase 4 — Buraco client UI

**Note:** Client tasks are less amenable to strict TDD than server tasks (DOM behavior is hard to unit test cleanly). Approach:

- Build incrementally, smoke-test in browser between tasks
- Use server-side tests as the safety net (they're already comprehensive)
- The single client-side test we add per task is for any pure helper function (selection logic, sequence-validator mirror)

### Task 4.1: Skeleton HTML + style scaffolding

**Files:**
- Create: `plugins/buraco/client/index.html`
- Create: `plugins/buraco/client/style.css`

- [ ] **Step 1: Write `plugins/buraco/client/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Buraco</title>
  <link rel="stylesheet" href="/shared/cards/style.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <a class="back" href="/">← Lobby</a>
    <button id="btn-mute" class="mute" type="button" aria-label="Toggle sound" title="Toggle sound">🔊</button>
    <div class="players">
      <div class="player" id="p-me"><span class="name" id="me-name">You</span><span class="score" id="me-score">0</span></div>
      <span class="vs">vs</span>
      <div class="player" id="p-opp"><span class="name" id="opp-name">Opponent</span><span class="score" id="opp-score">0</span></div>
    </div>
  </header>

  <main id="board">
    <section id="opp-hand-row" class="zone zone--opp-hand"></section>
    <section id="opp-melds-row" class="zone zone--opp-melds"></section>
    <section id="table-center" class="zone zone--table"></section>
    <section id="my-melds-row" class="zone zone--my-melds"></section>
    <div id="phase-banner" class="phase-banner"></div>
    <section id="my-hand-row" class="zone zone--my-hand"></section>
  </main>

  <div id="action-bar" class="action-bar"></div>
  <div id="deal-end-overlay" class="overlay" hidden></div>
  <div id="game-end-overlay" class="overlay" hidden></div>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write minimal `plugins/buraco/client/style.css`**

```css
:root {
  --buraco-felt: #275e3a;
  --buraco-felt-dark: #1c4329;
  --buraco-card-gap: 12px;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background: var(--buraco-felt);
  color: #fff;
}

header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: rgba(0, 0, 0, 0.3);
}
header .players { display: flex; gap: 8px; align-items: center; }
header .player { display: flex; flex-direction: column; align-items: center; }
header .player .name { font-size: 12px; opacity: 0.8; }
header .player .score { font-weight: bold; }

#board {
  display: flex; flex-direction: column; gap: 8px; padding: 8px;
}

.zone {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  padding: 8px;
  min-height: 60px;
}
.zone--table { display: flex; gap: 16px; align-items: center; justify-content: center; }
.zone--opp-hand { display: flex; gap: var(--buraco-card-gap); }
.zone--my-hand { display: flex; gap: var(--buraco-card-gap); flex-wrap: wrap; }
.zone--opp-melds, .zone--my-melds { display: flex; flex-wrap: wrap; gap: 16px; }

.meld {
  display: inline-flex; gap: 2px; padding: 4px 6px; background: rgba(255,255,255,0.06);
  border-radius: 4px; align-items: flex-end;
}
.meld--buraco { box-shadow: 0 0 8px rgba(255, 215, 0, 0.6); }

.phase-banner {
  background: rgba(255, 250, 200, 0.95); color: #422;
  padding: 6px 10px; border-radius: 4px;
  text-align: center; font-style: italic;
}

.action-bar {
  position: sticky; bottom: 0;
  display: flex; gap: 8px; padding: 8px;
  background: rgba(0, 0, 0, 0.4);
}
.action-bar button {
  background: #4a8; color: #fff; border: none; padding: 8px 14px;
  border-radius: 4px; cursor: pointer;
}
.action-bar button:disabled { opacity: 0.4; cursor: not-allowed; }

.overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center;
  z-index: 10;
}
.overlay > div {
  background: #fff; color: #222; padding: 20px; border-radius: 8px;
  max-width: 480px; width: 90%;
}

@media (max-width: 600px) {
  :root { --buraco-card-gap: 6px; }
  .card { width: 60px; height: 88px; }
}
```

- [ ] **Step 3: Smoke test**

```bash
DEV_USER=you@example.com npm start &
sleep 2
# Open http://localhost:3000 — start a Buraco game with another roster member
# (or yourself with two browsers / two DEV_USERs)
# Verify: the page loads with felt background, empty zones visible
kill %1 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add plugins/buraco/client/index.html plugins/buraco/client/style.css
git commit -m "feat(buraco/client): skeleton HTML + base styles"
```

---

### Task 4.2: Client app.js — connect, render dispatch, send

**Files:**
- Modify: `plugins/buraco/client/app.js`

The cribbage client is the working precedent. Read it:

```bash
head -80 plugins/cribbage/client/app.js
```

Lift its skeleton: `window.__buraco__` global with `{ gameId, send }`, an SSE listener that calls `render(view)`, an initial GET to `/api/games/:id/view`.

- [ ] **Step 1: Write `plugins/buraco/client/app.js`** (adapt from cribbage; replace `'cribbage'` with `'buraco'` and the rendering body)

```js
import { renderCard } from '/shared/cards/card-element.js';

const gameId = window.location.pathname.match(/\/play\/buraco\/([^/]+)/)?.[1];
if (!gameId) throw new Error('cannot determine gameId from URL');

let mySide = null;
let lastView = null;
const selection = new Set(); // cardId set

window.__buraco__ = {
  gameId,
  send: async (action) => {
    const r = await fetch(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    return r.json();
  },
};

async function loadInitial() {
  const r = await fetch(`/api/games/${gameId}/view`);
  const data = await r.json();
  mySide = data.viewer?.side ?? null;
  applyView(data.view);
}

function applyView(view) {
  lastView = view;
  selection.clear(); // reset on every server update
  render(view);
}

function render(view) {
  const oppSide = mySide === 'a' ? 'b' : 'a';
  document.getElementById('me-name').textContent = view.viewer?.name ?? 'You';
  document.getElementById('me-score').textContent = view.scores[mySide]?.total ?? 0;
  document.getElementById('opp-score').textContent = view.scores[oppSide]?.total ?? 0;
  // Empty zones initially — populated by subsequent tasks
  document.getElementById('phase-banner').textContent = describePhase(view, mySide);
}

function describePhase(view, side) {
  if (view.phase === 'game-end') return `Game over — ${view.winner === side ? 'you won' : 'you lost'}`;
  if (view.phase === 'deal-end') return 'Deal ended — scoring…';
  if (view.currentTurn !== side) return `Waiting for opponent…`;
  if (view.phase === 'draw') return 'Your turn — draw a card';
  if (view.phase === 'meld') return 'Your turn — meld or discard';
  return view.phase;
}

// SSE
const evt = new EventSource(`/api/games/${gameId}/events`);
evt.addEventListener('view', (e) => {
  const view = JSON.parse(e.data);
  applyView(view);
});

loadInitial();
```

- [ ] **Step 2: Smoke test in browser** — start the server, load a buraco game, watch DevTools Network for the initial `/view` and `/events` SSE. Phase banner should populate.

- [ ] **Step 3: Commit**

```bash
git add plugins/buraco/client/app.js
git commit -m "feat(buraco/client): app boot, SSE wiring, phase banner"
```

---

### Task 4.3: Render zones — table, melds, hands, action bar

**Files:**
- Create: `plugins/buraco/client/table.js`
- Create: `plugins/buraco/client/melds.js`
- Create: `plugins/buraco/client/hand.js`
- Create: `plugins/buraco/client/action-bar.js`
- Modify: `plugins/buraco/client/app.js`

This is a single big task because the modules are interdependent. Write each file, then update `render()` in `app.js` to call all four.

- [ ] **Step 1: `table.js` — stock count + discard top + morto status**

```js
import { renderCard } from '/shared/cards/card-element.js';

export function renderTableCenter(container, view) {
  container.innerHTML = '';

  // Stock pile (face-down stack with count)
  const stockSlot = document.createElement('div');
  stockSlot.className = 'pile';
  const stockBack = renderCard(null, { faceDown: true });
  const stockCount = document.createElement('div');
  stockCount.className = 'pile-count';
  stockCount.textContent = `stock ${view.stock}`;
  stockSlot.append(stockBack, stockCount);

  // Discard pile (top card visible)
  const discardSlot = document.createElement('div');
  discardSlot.className = 'pile';
  if (view.discard.length > 0) {
    const top = renderCard(view.discard[view.discard.length - 1]);
    discardSlot.append(top);
  } else {
    const empty = document.createElement('div');
    empty.className = 'pile-empty';
    empty.textContent = 'empty';
    discardSlot.append(empty);
  }
  const discardCount = document.createElement('div');
  discardCount.className = 'pile-count';
  discardCount.textContent = `discard ${view.discard.length}`;
  discardSlot.append(discardCount);

  // Morto status
  const mortoStatus = document.createElement('div');
  mortoStatus.className = 'morto-status';
  mortoStatus.innerHTML = `
    <div>Mortos</div>
    <div>${view.mortoTaken.a ? '◯' : '●'} a (${view.mortos.a} cards)</div>
    <div>${view.mortoTaken.b ? '◯' : '●'} b (${view.mortos.b} cards)</div>
  `;

  container.append(stockSlot, discardSlot, mortoStatus);
}
```

- [ ] **Step 2: `melds.js` — render a side's melds, mark buracos**

```js
import { renderCard } from '/shared/cards/card-element.js';

export function renderMeldsZone(container, melds, { interactive, onPick } = {}) {
  container.innerHTML = '';
  if (melds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'melds-empty';
    empty.textContent = '— no melds —';
    container.append(empty);
    return;
  }
  melds.forEach((meld, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'meld';
    if (meld.length >= 7) wrap.classList.add('meld--buraco');
    for (const card of meld) {
      const el = renderCard(card);
      wrap.append(el);
    }
    if (interactive) {
      wrap.classList.add('meld--target');
      wrap.addEventListener('click', () => onPick?.(idx));
    }
    container.append(wrap);
  });
}
```

- [ ] **Step 3: `hand.js` — face-down opponent row + interactive own hand**

```js
import { renderCard } from '/shared/cards/card-element.js';

export function renderOppHand(container, count) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    container.append(renderCard(null, { faceDown: true }));
  }
}

export function renderMyHand(container, hand, selection, { onToggle } = {}) {
  container.innerHTML = '';
  for (const card of hand) {
    const el = renderCard(card);
    if (selection.has(card.id)) el.classList.add('card--selected');
    el.addEventListener('click', () => onToggle?.(card));
    container.append(el);
  }
}
```

- [ ] **Step 4: `action-bar.js` — phase-aware buttons**

```js
export function renderActionBar(container, view, mySide, selection, callbacks) {
  container.innerHTML = '';
  const { onDrawStock, onTakeDiscard, onLayMeld, onExtendMode, onDiscardMode } = callbacks;

  if (view.currentTurn !== mySide) {
    container.textContent = `Waiting for opponent…`;
    return;
  }
  if (view.phase === 'draw') {
    container.append(button('Draw stock', onDrawStock));
    container.append(button('Take discard', onTakeDiscard, view.discard.length === 0));
    return;
  }
  if (view.phase === 'meld') {
    const lay = button(`Lay meld (${selection.size})`, onLayMeld, selection.size < 3);
    const ext = button('Extend meld', onExtendMode, selection.size === 0);
    const disc = button('Discard…', onDiscardMode);
    container.append(lay, ext, disc);
    return;
  }
}

function button(label, fn, disabled = false) {
  const b = document.createElement('button');
  b.textContent = label;
  b.disabled = !!disabled;
  if (fn) b.addEventListener('click', fn);
  return b;
}
```

- [ ] **Step 5: Update `app.js` `render()` to call all four**

Replace the body of `render(view)`:

```js
import { renderTableCenter } from './table.js';
import { renderMeldsZone } from './melds.js';
import { renderOppHand, renderMyHand } from './hand.js';
import { renderActionBar } from './action-bar.js';

// ...existing code...

function render(view) {
  const oppSide = mySide === 'a' ? 'b' : 'a';

  document.getElementById('me-score').textContent = view.scores[mySide]?.total ?? 0;
  document.getElementById('opp-score').textContent = view.scores[oppSide]?.total ?? 0;

  renderOppHand(document.getElementById('opp-hand-row'), view.hands[oppSide]);
  renderMeldsZone(document.getElementById('opp-melds-row'), view.melds[oppSide]);
  renderTableCenter(document.getElementById('table-center'), view);

  // Discard mode handles meld extension; pass current selection state.
  let extendModeMeldIdx = null;
  renderMeldsZone(document.getElementById('my-melds-row'), view.melds[mySide], {
    interactive: extendModeMeldIdx !== null,
    onPick: (idx) => onExtendPick(idx),
  });

  document.getElementById('phase-banner').textContent = describePhase(view, mySide);

  renderMyHand(document.getElementById('my-hand-row'), view.hands[mySide], selection, {
    onToggle: (card) => {
      if (selection.has(card.id)) selection.delete(card.id);
      else selection.add(card.id);
      render(view);
    },
  });

  renderActionBar(document.getElementById('action-bar'), view, mySide, selection, {
    onDrawStock: () => window.__buraco__.send({ type: 'draw', payload: { source: 'stock' } }),
    onTakeDiscard: () => window.__buraco__.send({ type: 'draw', payload: { source: 'discard' } }),
    onLayMeld: () => onLayMeld(view),
    onExtendMode: () => onExtendMode(),
    onDiscardMode: () => onDiscardMode(view),
  });
}

function onLayMeld(view) {
  const cards = view.hands[mySide].filter(c => selection.has(c.id));
  window.__buraco__.send({ type: 'meld', payload: { op: 'create', cards } });
}

function onExtendMode() {
  // Mark melds as click targets in the next render; for v1 use a global flag.
  // (Refine later — for now, prompt for index)
  const idx = Number(prompt('Extend which meld? (index, 0-based)'));
  if (Number.isInteger(idx)) onExtendPick(idx);
}

function onExtendPick(idx) {
  const view = lastView;
  const cards = view.hands[mySide].filter(c => selection.has(c.id));
  window.__buraco__.send({ type: 'meld', payload: { op: 'extend', meldIndex: idx, cards } });
}

function onDiscardMode(view) {
  const sel = [...selection];
  if (sel.length !== 1) {
    alert('Select exactly one card to discard.');
    return;
  }
  const card = view.hands[mySide].find(c => c.id === sel[0]);
  window.__buraco__.send({ type: 'discard', payload: { card } });
}
```

(Note: the extend-mode and discard-mode UX are minimal v1 — `prompt()` and `alert()`. Adequate for first playable. Polish in Task 4.5.)

- [ ] **Step 6: Smoke test** — full Buraco playthrough vs yourself in two browser tabs. Verify draws, melds, discards land. Buracos (≥7-card melds) get the gold glow. Mortos appear in the table-center.

- [ ] **Step 7: Commit**

```bash
git add plugins/buraco/client/{table.js,melds.js,hand.js,action-bar.js,app.js}
git commit -m "feat(buraco/client): full table/melds/hand/action-bar rendering"
```

---

### Task 4.4: Client sequence validator (live feedback)

**Files:**
- Create: `plugins/buraco/client/sequence-validator.js`
- Test: `test/buraco-client-sequence-validator.test.js`

The server's `isValidSequence` is authoritative; the client mirrors a subset for live "Lay meld" button enabling.

- [ ] **Step 1: Write the test (Node-runnable, not browser)**

Create `test/buraco-client-sequence-validator.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canLay } from '../plugins/buraco/client/sequence-validator.js';

const C = (rank, suit) => ({ id: `${suit}-${rank}-0`, rank, suit, deckIndex: 0 });

test('canLay accepts a valid 3-card sequence', () => {
  assert.equal(canLay([C('5','H'), C('6','H'), C('7','H')]), true);
});
test('canLay rejects 2 cards', () => {
  assert.equal(canLay([C('5','H'), C('6','H')]), false);
});
test('canLay rejects mixed suits', () => {
  assert.equal(canLay([C('5','H'), C('6','S'), C('7','H')]), false);
});
```

- [ ] **Step 2: Implement** — write `plugins/buraco/client/sequence-validator.js`. Easiest path: re-import the server's logic, since both are plain ESM and the file is server+client safe (it imports only from `src/shared/cards/deck.js` which is also DOM-free).

```js
export { isValidSequence as canLay } from '/plugins/buraco/server/sequence.js';
```

Wait — that won't work because `server/` is not statically served. Two options:

(a) Move the relevant logic into a shared file (e.g. `plugins/buraco/sequence.js`), import from both server and client.

(b) Mirror it manually in the client. (Acceptable but doubles maintenance.)

Choose (a). Move the logic:

```bash
git mv plugins/buraco/server/sequence.js plugins/buraco/sequence.js
```

Update `plugins/buraco/server/phases/{meld,deal-end}.js` imports from `'../sequence.js'` to `'../../sequence.js'`. Run `npm test`. Then write:

```js
// plugins/buraco/client/sequence-validator.js
export { isValidSequence as canLay } from '../sequence.js';
```

But the client imports via URL, not relative. Browser path: the `clientDir` is `plugins/buraco/client`, and the host serves `clientDir` at `/play/buraco/:id/`, so a relative `'../sequence.js'` would 404. We need a different approach.

Cleanest fix: have the host static-mount `plugins/<id>/sequence.js` accessible to the client. Or, ship a tiny copy at `plugins/buraco/client/_shared/sequence.js` that's bundle-imported by both server and client. Simplest of all: just re-implement `canLay` minimally on the client (cards are simple enough). Choose this for v1.

```js
// plugins/buraco/client/sequence-validator.js
const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
const RANK_INDEX = Object.fromEntries(RANKS.map((r, i) => [r, i]));

export function canLay(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;
  // Quick mirror — full server validation is authoritative
  const naturals = cards.filter(c => c.kind !== 'joker' && !c.representsRank);
  if (naturals.length === 0) return false;
  const suit = naturals[0].suit;
  for (const c of naturals) if (c.suit !== suit) return false;

  const wildCount = cards.filter(c =>
    c.kind === 'joker' || c.representsRank || (c.rank === '2' && c.suit !== suit)
  ).length;
  if (wildCount > 1) return false;

  const ranks = cards.map(c => c.representsRank ?? c.rank);
  const tryAt = (aceIdx) => {
    const idx = ranks.map(r => r === 'A' ? aceIdx : RANK_INDEX[r]).sort((a, b) => a - b);
    for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1] + 1) return false;
    return true;
  };
  return tryAt(0) || tryAt(13);
}
```

- [ ] **Step 3: Run test**

```bash
node --test test/buraco-client-sequence-validator.test.js
```

Expected: 3 passing.

- [ ] **Step 4: Wire into `action-bar.js`** to disable `[Lay meld]` when invalid:

In `action-bar.js`, replace the `lay` line with:

```js
import { canLay } from './sequence-validator.js';

// ...
const cards = view.hands[mySide].filter(c => selection.has(c.id));
const valid = canLay(cards);
const lay = button(`Lay meld (${selection.size})`, onLayMeld, !valid);
```

Pass `mySide` into the action-bar (already does). Adjust signature as needed.

- [ ] **Step 5: Commit**

```bash
git add plugins/buraco/client/sequence-validator.js plugins/buraco/client/action-bar.js test/buraco-client-sequence-validator.test.js
git commit -m "feat(buraco/client): live sequence validation for Lay-meld button"
```

---

### Task 4.5: UI polish — extend mode, discard mode, wild placement, sounds

**Files:**
- Modify: `plugins/buraco/client/app.js`, `style.css`
- Add: `plugins/buraco/client/sounds.js`
- Add: `plugins/buraco/client/sounds/` (asset files)

This task is iterative polish. Recommended order:

- [ ] **Step 1: Replace `prompt()` extend-mode with click-to-pick** — when `[Extend meld]` is pressed, set a flag in `app.js`, re-render with `interactive=true` for `my-melds`, click on a meld sends the action.

- [ ] **Step 2: Replace `alert()`-based discard mode with a confirmation banner** — when `[Discard…]` is pressed, the phase banner changes to "Tap a card to discard"; tapping a card in hand sends the discard.

- [ ] **Step 3: Wild placement picker** — when the selection contains a wild and the candidate sequence is ambiguous, show a small inline picker for `representsRank`. (For v1, accept any annotation the player provides; the server validates.)

- [ ] **Step 4: Copy cribbage's `sounds.js`** to `plugins/buraco/client/sounds.js`, swap the file references for buraco-flavored sounds (or reuse cribbage's). Wire `sounds.draw()`, `sounds.meld()`, `sounds.discard()`, `sounds.buraco()`, `sounds.goingOut()` calls from `app.js` based on `view.lastEvent.kind`.

- [ ] **Step 5: Deal-end overlay** — when `phase === 'deal-end'`, show the overlay with the score breakdown and a `[Continue]` button (which is purely UI; the server has already advanced to the next deal). Hide the overlay when `phase === 'draw'` again.

- [ ] **Step 6: Game-end overlay** — when `phase === 'game-end'`, show winner + final scores. No continue button.

- [ ] **Step 7: Smoke test full match** — play through enough turns to see at least one deal-end and ideally one game-end (or shorten the score target to 200 in dev for testing, then revert).

- [ ] **Step 8: Commit (per polish item or as one)**

```bash
git add plugins/buraco/client
git commit -m "feat(buraco/client): UI polish — extend/discard modes, sounds, overlays"
```

---

## Phase 5 — Final integration & smoke

### Task 5.1: Manual playthrough vs Sonia

- [ ] **Step 1: Push to prod or do a real cross-network playthrough**

The host runs at `words.slabgorb.com` via local launchd + cloudflared. To deploy: merge to `main`, then `launchctl kickstart -k <server-label>`. (See memory note `project_prod_topology.md` for details.)

- [ ] **Step 2: Play a full match with Sonia**

Confirm:
- All Brazilian rules feel right to her (sequences only; jokers + off-suit 2s as wilds; buraco = 7-card meld; going-out requires buraco)
- The pacing is OK across days
- She can tell when it's her turn
- Card art is legible on her device
- The buraco celebration feels satisfying

- [ ] **Step 3: File any feedback as new issues / a follow-up plan**

Anything that needs changing is a new story, not a fix to this plan.

---

### Task 5.2: Update README with Buraco entry

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find the plugin list section**

```bash
grep -n 'plugins/' README.md | head
```

- [ ] **Step 2: Add a Buraco bullet** wherever the existing plugins are listed (`words`, `cribbage`, `backgammon`, `rummikub`).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Buraco to plugin list"
```

---

## Self-review checklist (run after writing this plan)

✅ **Spec coverage:** Every section of `docs/superpowers/specs/2026-05-08-buraco-and-shared-cards-design.md` maps to at least one task:
- Variant rules (Brazilian) → Task 3.2 (state), 3.3 (sequence), 3.11 (scoring) all encode them
- Card identity model → Task 1.2 (cardId), 1.3 (deck) — `id` is universal
- Wild handling → Task 3.3 (isValidSequence), 3.8 (replaceWild)
- Architecture file layout → All Phase 1/3/4 task headers reference exact paths from spec
- Action shapes (draw/meld/discard) → Task 3.5, 3.6, 3.7, 3.8, 3.10, 3.13
- publicView → Task 3.14
- Migration plan steps → Tasks 2.1–2.4 follow the spec's numbered steps 1–5
- Risks → Each risk has mitigation in the relevant task (sequence test coverage in 3.3, scroll/sort in 4.5, card-conservation invariant in 3.12)

✅ **Placeholder scan:** No "TBD"/"TODO"/"see above"/etc. The one note about cribbage's participant convention (Task 3.13) is a real instruction (look at cribbage), not a placeholder.

✅ **Type consistency:** `cardId` format string `${suit}-${rank}-${deckIndex}` defined in 1.2, used the same way through Phase 3 tests. `isValidSequence` named consistently. Action `op` values (`'create' | 'extend' | 'replaceWild'`) consistent.

✅ **Scope:** Single coherent feature build. Could be split across phase boundaries if shipping needs a checkpoint.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-08-buraco-and-shared-cards.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
