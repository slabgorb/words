# Mobile Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Words client first-class on a phone — fix mobile bugs, replace HTML5 drag with a Pointer-Events drag manager that works on touch and desktop, surface validation, declutter the action toolbar, and finish the wood theme with a dark page background — preserving every existing interaction.

**Architecture:** A new `public/drag.js` module owns Pointer-Events drag mechanics (pickup threshold, ghost, target hinting, drop, cancel). `public/board.js` and `public/rack.js` register their elements as drag sources / drop targets through it instead of wiring HTML5 listeners themselves. CSS gets a battle-card topbar, two-row controls with a `⋯` overflow sheet, a promoted status banner, and a walnut palette for `body[data-theme="wood"]`.

**Tech Stack:** Vanilla ES modules, Pointer Events, `navigator.vibrate`, Node `node:test` (built-in), existing `picker.js` modal infrastructure.

**Spec:** `docs/superpowers/specs/2026-05-04-mobile-uplift-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `public/drag.js` | **Create** | Drag manager: pointer lifecycle, ghost element, hit-testing, target highlighting, haptics, reduced-motion |
| `public/style.css` | Modify | Walnut palette, battle-card topbar, status banner, two-row controls, drop-target hints, ghost styles, overflow guard |
| `public/index.html` | Modify | Topbar markup (3-col grid + pill), bag/rack subline, promoted status banner, two-row controls, ⋯ button |
| `public/app.js` | Modify | Register drag callbacks, mount/unmount status banner, wire ⋯ menu via picker, render battle-card scores |
| `public/board.js` | Modify | Replace HTML5 drag listeners with `dragManager.registerSource` / `registerTarget` |
| `public/rack.js` | Modify | Same: replace HTML5 listeners + recall + reorder via drag manager |
| `public/picker.js` | Modify | Add `pickMoreActions()` returning `'pass' \| 'swap' \| 'resign' \| null` |
| `test/drag.test.js` | **Create** | Unit tests for `drag.js` pure helpers (distance, target resolution with stubbed `elementFromPoint`) |
| `docs/superpowers/specs/2026-05-04-mobile-uplift-checklist.md` | **Create** | Manual cross-device QA checklist |

`themes.js`, `state.js`, `validator.js`, `sounds.js`, `callout.js` — **unchanged**.

---

## Task 1: Walnut wood-theme page background

**Files:**
- Modify: `public/style.css` (the `body[data-theme="wood"]` block)

This task is CSS-only. No unit test; verification is a browser check.

- [ ] **Step 1: Replace the wood theme palette block**

In `public/style.css`, find the existing `body[data-theme="wood"]` block (around lines 464–476) and replace it with:

```css
body[data-theme="wood"] {
  --board-hi: #2d5a3c;
  --board-mid: #244832;
  --board-lo:  #1c3826;
  --frame-hi:  #9a774f;
  --frame-lo:  #5a3f24;
  --grid-line: rgba(0,0,0,0.30);

  /* dark walnut page bg + cream ink */
  --page-bg:    #2b1d12;
  --page-ink:   #efe6d3;
  --page-muted: rgba(239, 230, 211, 0.55);

  --tw: #e87053;
  --dw: #e8a263;
  --tl: #6dadc4;
  --dl: #98c4d8;
}

/* Wood-theme page wears a horizontal grain like the frame/rack */
body[data-theme="wood"] {
  background-image:
    repeating-linear-gradient(88deg,
      rgba(0,0,0,0.30) 0 2px, transparent 2px 9px,
      rgba(255,255,255,0.04) 9px 10px, transparent 10px 18px);
  background-attachment: fixed;
}

/* The topbar's bottom border vanishes on dark — flip to cream */
body[data-theme="wood"] #topbar {
  border-bottom-color: rgba(239, 230, 211, 0.18);
}
```

- [ ] **Step 2: Verify in browser**

Run `npm start` and open `http://localhost:3000`. In the browser console:

```js
document.body.dataset.theme = 'wood';
```

Expected: page background is dark walnut with subtle horizontal grain; cream text remains readable; the green board "pops" against the dark page; rack and frame still look right.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style(themes): walnut page background for wood theme"
```

---

## Task 2: Page horizontal-overflow guard

**Files:**
- Modify: `public/style.css` (the `body` and `main` rules)

Pure CSS guard against the phantom-column overflow seen on iOS.

- [ ] **Step 1: Update `html, body` and `main` rules**

In `public/style.css`, find the existing `html, body` block and the `main` rule (around lines 47–57) and replace with:

```css
html, body {
  margin: 0;
  background: var(--page-bg);
  color: var(--page-ink);
  font-family: var(--type-sans);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;        /* belt: no horizontal scroll, ever */
}

body { display: flex; justify-content: center; }

main {
  width: 100%;
  max-width: 720px;
  padding: 16px 12px 32px;
}
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:3000` on a phone-width viewport (DevTools → 390 × 844 iPhone). Expected: no horizontal scroll bar; the wood frame ends cleanly at the right edge with no phantom cells past it.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style(layout): clamp main width and forbid horizontal scroll"
```

---

## Task 3: Battle-card topbar (markup + CSS + render)

**Files:**
- Modify: `public/index.html` (`#topbar` markup)
- Modify: `public/style.css` (`#topbar` rules)
- Modify: `public/app.js` (`refresh()` topbar updates)

- [ ] **Step 1: Restructure the `#topbar` markup**

In `public/index.html`, replace the existing `<header id="topbar">…</header>` with:

```html
<header id="topbar">
  <div class="topbar-row">
    <div id="score-keith" class="score"></div>
    <div id="turn-pill" class="turn-pill"></div>
    <div id="score-sonia" class="score score-right"></div>
  </div>
  <div class="topbar-sub">
    <span id="bag-count"></span>
    <span id="rack-remaining"></span>
  </div>
</header>
```

- [ ] **Step 2: Replace the `#topbar` CSS block**

In `public/style.css`, find the existing `#topbar` block + child styles (around lines 90–118) and replace with:

```css
#topbar {
  padding: 10px 4px 14px;
  margin-bottom: 14px;
  font-family: var(--type-serif);
  border-bottom: 1px solid rgba(42,33,24,0.18);
}
.topbar-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
}
.score {
  font-size: 16px;
  font-weight: 500;
  color: var(--page-muted);
}
.score.score-right { text-align: right; }
.score.active { color: var(--page-ink); font-weight: 600; }
.turn-pill {
  font-style: italic;
  font-weight: 600;
  font-size: 13px;
  color: var(--tw);
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--tile-bg-mid);
  border: 1px solid var(--tile-edge);
  white-space: nowrap;
  box-shadow: 0 1px 2px var(--tile-shadow);
}
.turn-pill[data-state="ended"] {
  color: var(--page-muted);
  background: transparent;
  border-color: var(--page-muted);
  font-style: normal;
}
.topbar-sub {
  display: flex;
  justify-content: space-between;
  font-family: var(--type-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--page-muted);
  margin-top: 4px;
  padding: 0 4px;
}

/* Reserve room for the floating mute/theme circles at narrow widths */
@media (max-width: 480px) {
  #topbar { padding-right: 92px; }
}
```

- [ ] **Step 3: Update `refresh()` in `app.js`**

In `public/app.js`, find the topbar update lines inside `refresh()` (around lines 39–45):

```js
$('#score-keith').textContent = `Keith: ${ui.server.scores.keith}`;
$('#score-sonia').textContent = `Sonia: ${ui.server.scores.sonia}`;
$('#bag-count').textContent = `bag: ${ui.server.bag.length}`;
const myTurn = ui.server.currentTurn === ui.server.you;
const opponent = ui.server.currentTurn;
const opponentName = opponent ? opponent[0].toUpperCase() + opponent.slice(1) : '';
$('#turn-indicator').textContent = myTurn ? 'Your turn' : `${opponentName}'s turn`;
```

Replace with:

```js
const scores = ui.server.scores;
const current = ui.server.currentTurn;
const ended = ui.server.status === 'ended';

const keithEl = $('#score-keith');
const soniaEl = $('#score-sonia');
keithEl.textContent = `Keith ${scores.keith}`;
soniaEl.textContent = `Sonia ${scores.sonia}`;
keithEl.classList.toggle('active', !ended && current === 'keith');
soniaEl.classList.toggle('active', !ended && current === 'sonia');

const pill = $('#turn-pill');
if (ended) {
  pill.textContent = 'Game over';
  pill.dataset.state = 'ended';
} else {
  const me = ui.server.you;
  const myTurn = current === me;
  pill.textContent = myTurn
    ? 'Your turn'
    : `${current[0].toUpperCase() + current.slice(1)}’s turn`;
  pill.dataset.state = 'active';
}
pill.setAttribute('role', 'status');
pill.setAttribute('aria-live', 'polite');

$('#bag-count').textContent = `bag ${ui.server.bag.length}`;
const rackLeft = ui.server.racks?.[ui.server.you]?.length ?? 0;
$('#rack-remaining').textContent = `${rackLeft} in rack`;
```

(Note: the old `#turn-indicator` element no longer exists; we now use `#turn-pill`. Search the file for any other reference to `#turn-indicator` and remove if found.)

- [ ] **Step 4: Verify in browser**

Reload the app. Expected: scores read "Keith 232" / "Sonia 5"; the active player's name is full ink, the inactive player is muted; a centered pill reads "Sonia's turn" or "Your turn"; sub-line below reads "bag 15" left and "5 in rack" right; on a 390 px viewport the floating mute/theme circles do not overlap the right score.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat(topbar): battle-card header with active-turn pill and bag/rack subline"
```

---

## Task 4: Promoted status banner

**Files:**
- Modify: `public/index.html` (`#status` placement)
- Modify: `public/style.css` (`#status` styling + states)
- Modify: `public/app.js` (`refresh()` status state class)

- [ ] **Step 1: Move `#status` between `#rack` and `#controls`**

In `public/index.html`, the current `<div id="status"></div>` lives at the bottom (after `#controls`). Move it so the body of `<main>` reads:

```html
<main id="game" hidden>
  <header id="topbar">…</header>
  <section id="board"></section>
  <section id="rack"></section>
  <div id="status" role="status" aria-live="polite"></div>
  <section id="controls">…</section>
</main>
```

(Leave `<div id="identity-picker">` etc. unchanged.)

- [ ] **Step 2: Replace `#status` CSS**

In `public/style.css`, find the existing `#status` block (around lines 762–769) and replace with:

```css
#status {
  margin: 12px 0 0;
  padding: 8px 12px;
  font-family: var(--type-serif);
  font-size: 14px;
  font-style: italic;
  color: var(--page-muted);
  background: rgba(196, 122, 74, 0.10);
  border-left: 3px solid var(--gold);
  border-radius: 0 4px 4px 0;
  display: none;
  transition: opacity 120ms ease;
}
#status.show { display: block; }
#status.valid {
  color: var(--page-ink);
  background: rgba(47, 122, 74, 0.10);
  border-left-color: var(--valid);
  font-style: normal;
  font-weight: 500;
}
#status.invalid {
  color: var(--page-ink);
  background: rgba(179, 56, 42, 0.10);
  border-left-color: var(--invalid);
  font-style: normal;
}

body[data-theme="wood"] #status {
  background: rgba(232, 162, 99, 0.18);
  color: var(--page-ink);
}
body[data-theme="wood"] #status.valid { background: rgba(120, 200, 140, 0.18); }
body[data-theme="wood"] #status.invalid { background: rgba(232, 80, 60, 0.22); }
```

- [ ] **Step 3: Update `refresh()` to drive status states**

In `public/app.js`, find the status-text block inside `refresh()` (around lines 47–58) and replace with:

```js
const statusEl = $('#status');
statusEl.classList.remove('show', 'valid', 'invalid');
let statusText = '';
let statusClass = null;
if (lastValidation) {
  if (lastValidation.valid) {
    statusText = `Words: ${lastValidation.words.map(w => w.word).join(', ')} — +${lastValidation.score}`;
    statusClass = 'valid';
  } else if (lastValidation.reason) {
    statusText = `Invalid: ${lastValidation.reason}`;
    statusClass = 'invalid';
  } else {
    const bad = lastValidation.words.filter(w => !w.ok).map(w => w.word).join(', ');
    statusText = `Not in dictionary: ${bad}`;
    statusClass = 'invalid';
  }
} else if (ui.tentative.length) {
  statusText = '…';
}
statusEl.textContent = statusText;
if (statusText) {
  statusEl.classList.add('show');
  if (statusClass) statusEl.classList.add(statusClass);
}
```

(Inside the same function, server-error and pass-failed status messages elsewhere in the file already write `statusEl.textContent` directly — those will still appear; they just won't get a class, so they show in neutral copper. That's the desired behavior.)

- [ ] **Step 4: Verify in browser**

Reload, place tiles to form a valid word. Expected: a copper-tinted banner with "…" appears immediately, then turns green with "Words: …" once validation finishes. Forming an invalid word turns it red. Recalling all tentative tiles makes it disappear (collapse, no reserved 22 px gap).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat(status): promote validation status to colour-coded banner above controls"
```

---

## Task 5: Two-row controls + ⋯ overflow sheet

**Files:**
- Modify: `public/index.html` (`#controls` markup)
- Modify: `public/style.css` (`#controls` + ⋯ button)
- Modify: `public/picker.js` (add `pickMoreActions`)
- Modify: `public/app.js` (wire ⋯ to picker)

- [ ] **Step 1: Restructure controls markup**

In `public/index.html`, replace the `<section id="controls">…</section>` block with:

```html
<section id="controls">
  <button id="btn-submit" disabled>Submit move</button>
  <div class="controls-row">
    <button id="btn-recall">Recall tiles</button>
    <button id="btn-shuffle">Shuffle rack</button>
    <button id="btn-more" aria-label="More actions" aria-haspopup="dialog" aria-expanded="false">⋯</button>
  </div>
  <div class="controls-desk">
    <button id="btn-pass">Pass</button>
    <button id="btn-swap">Swap…</button>
    <button id="btn-resign">Resign</button>
  </div>
</section>
```

- [ ] **Step 2: Replace `#controls` CSS**

In `public/style.css`, find the existing `#controls` block (around lines 388–425) and replace with:

```css
#controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}
#controls #btn-submit {
  font-family: var(--type-serif);
  font-size: 14px;
  width: 100%;
  padding: 10px 14px;
  background: #2a2118;
  color: var(--tile-bg-mid);
  border: 1px solid #2a2118;
  border-radius: 4px;
  cursor: pointer;
  box-shadow: 0 1px 0 #1a140c, inset 0 1px 0 rgba(255,255,255,0.10);
  transition: transform 80ms ease, background 120ms ease;
}
#controls #btn-submit:hover:not(:disabled) { background: #3a2a1c; transform: translateY(-1px); }
#controls #btn-submit:disabled { opacity: 0.4; cursor: not-allowed; }

#controls .controls-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
#controls .controls-row button {
  font-family: var(--type-serif);
  font-size: 14px;
  flex: 1;
  background: var(--tile-bg-mid);
  color: var(--tile-ink);
  border: 1px solid var(--tile-edge);
  padding: 8px 14px;
  border-radius: 4px;
  cursor: pointer;
  box-shadow: 0 1px 0 var(--tile-edge), inset 0 1px 0 rgba(255,255,255,0.7);
  transition: transform 80ms ease, background 120ms ease;
}
#controls .controls-row button:hover:not(:disabled) {
  background: var(--tile-bg-hi);
  transform: translateY(-1px);
}
#controls #btn-more {
  flex: 0 0 44px;
  min-width: 44px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.10em;
  padding: 8px 0;
}

/* Mobile: hide the desktop row, show only ⋯ */
#controls .controls-desk { display: none; }

/* Desktop: hide ⋯, show all six buttons in flat layout */
@media (min-width: 600px) {
  #controls #btn-more { display: none; }
  #controls .controls-desk {
    display: flex;
    gap: 8px;
  }
  #controls .controls-desk button {
    font-family: var(--type-serif);
    font-size: 14px;
    flex: 1;
    background: var(--tile-bg-mid);
    color: var(--tile-ink);
    border: 1px solid var(--tile-edge);
    padding: 8px 14px;
    border-radius: 4px;
    cursor: pointer;
    box-shadow: 0 1px 0 var(--tile-edge), inset 0 1px 0 rgba(255,255,255,0.7);
    transition: transform 80ms ease, background 120ms ease;
  }
  #controls .controls-desk button:hover:not(:disabled) {
    background: var(--tile-bg-hi);
    transform: translateY(-1px);
  }
}
```

- [ ] **Step 3: Add `pickMoreActions` to `picker.js`**

In `public/picker.js`, add this export at the bottom of the file (alongside the other `pick…` exports):

```js
/**
 * Show the mobile "more actions" sheet.
 * Resolves to 'pass' | 'swap' | 'resign' | null (cancelled).
 */
export function pickMoreActions() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'picker-backdrop';
    const panel = document.createElement('div');
    panel.className = 'picker-panel confirm-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'picker-title';
    title.textContent = 'More actions';
    panel.appendChild(title);

    const actions = [
      { id: 'pass', label: 'Pass turn' },
      { id: 'swap', label: 'Swap tiles…' },
      { id: 'resign', label: 'Resign', danger: true },
    ];
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    list.style.margin = '8px 0 12px';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'picker-confirm' + (a.danger ? ' picker-danger' : '');
      btn.style.width = '100%';
      btn.textContent = a.label;
      btn.addEventListener('click', () => { close(a.id); });
      list.appendChild(btn);
    }
    panel.appendChild(list);

    const cancel = document.createElement('button');
    cancel.className = 'picker-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close(null));
    panel.appendChild(cancel);

    backdrop.appendChild(panel);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.body.appendChild(backdrop);

    function close(result) {
      backdrop.remove();
      resolve(result);
    }
  });
}
```

- [ ] **Step 4: Wire ⋯ button in `app.js`**

In `public/app.js`, add the import at the top:

```js
import { pickBlankLetter, pickSwapTiles, confirmAction, pickMoreActions } from './picker.js';
```

Then in `init()`, alongside the other `addEventListener` calls (after `$('#btn-resign').addEventListener('click', resign);`), add:

```js
$('#btn-more').addEventListener('click', async () => {
  const btn = $('#btn-more');
  btn.setAttribute('aria-expanded', 'true');
  const choice = await pickMoreActions();
  btn.setAttribute('aria-expanded', 'false');
  if (choice === 'pass') passTurn();
  else if (choice === 'swap') swapTiles();
  else if (choice === 'resign') resign();
});
```

- [ ] **Step 5: Verify in browser**

At desktop width (>=600 px) all six buttons appear in their two rows (Submit on top, then Recall/Shuffle plus the desktop row Pass/Swap/Resign). At phone width (<600 px) you see Submit, then Recall/Shuffle/⋯. Tapping ⋯ opens a sheet; tapping Pass triggers the existing Pass confirm dialog; tapping Swap opens the existing swap picker; tapping Resign triggers the existing Resign confirm.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/style.css public/picker.js public/app.js
git commit -m "feat(controls): two-row mobile layout with ⋯ overflow sheet for pass/swap/resign"
```

---

## Task 6: drag.js — distance threshold (TDD)

**Files:**
- Create: `public/drag.js`
- Create: `test/drag.test.js`

We bootstrap `drag.js` with a single pure helper, test-first. This keeps the module testable without DOM stubbing.

- [ ] **Step 1: Write the failing test**

Create `test/drag.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --test-name-pattern='drag'
```

Expected: FAIL with `Cannot find module '../public/drag.js'` or `exceedsThreshold is not defined`.

- [ ] **Step 3: Create `public/drag.js` with the minimum to pass**

```js
// public/drag.js — Pointer-Events drag manager
// Replaces HTML5 dragstart/drop. Works on mouse, touch, pen.

export const DRAG_THRESHOLD_PX = 6;

/** True iff the Euclidean distance between (x0,y0) and (x1,y1) exceeds the threshold. */
export function exceedsThreshold(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return (dx * dx + dy * dy) > (DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --test-name-pattern='drag'
```

Expected: PASS, all 6 drag-threshold tests green.

- [ ] **Step 5: Commit**

```bash
git add public/drag.js test/drag.test.js
git commit -m "feat(drag): add drag.js skeleton with movement-threshold helper (tdd)"
```

---

## Task 7: drag.js — target resolution helper (TDD)

**Files:**
- Modify: `public/drag.js`
- Modify: `test/drag.test.js`

The drag manager finds the topmost drop target under the pointer. We isolate that resolution as a pure function that takes an `elementFromPoint` callback so it's testable without a real DOM.

- [ ] **Step 1: Add failing tests**

Append to `test/drag.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- --test-name-pattern='resolveTarget'
```

Expected: FAIL with `resolveTarget is not exported`.

- [ ] **Step 3: Add `resolveTarget` to `drag.js`**

Append to `public/drag.js`:

```js
/**
 * Resolve the drop-target element under (x, y), if any.
 * @param {number} x – clientX
 * @param {number} y – clientY
 * @param {(x:number,y:number) => Element|null} elementFromPoint – usually `document.elementFromPoint`
 * @returns {Element|null} The nearest ancestor (inclusive) carrying `data-drop-target`, or null.
 */
export function resolveTarget(x, y, elementFromPoint) {
  const hit = elementFromPoint(x, y);
  if (!hit) return null;
  return hit.closest ? hit.closest('[data-drop-target]') : null;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --test-name-pattern='resolveTarget'
```

Expected: PASS, 4 new tests green.

- [ ] **Step 5: Commit**

```bash
git add public/drag.js test/drag.test.js
git commit -m "feat(drag): add resolveTarget helper with tests"
```

---

## Task 8: drag.js — full pointer lifecycle

**Files:**
- Modify: `public/drag.js`

Now we add the runtime piece: registration API, ghost element, pointer listeners, drop dispatch, cancel handling, haptics. This is mostly DOM glue; verification is browser-side (covered in Tasks 9–10 when we wire it up).

- [ ] **Step 1: Append the runtime to `drag.js`**

Append to `public/drag.js`:

```js
const sources = new WeakMap(); // element → { payload(), onTap?, onDragStart?, onDragEnd? }
const targets = new WeakMap(); // element → { accepts?, onDrop }

const REDUCED_MOTION = matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export const dragManager = {
  registerSource(el, opts) {
    sources.set(el, opts);
    el.dataset.dragSource = '1';
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', onPointerDown);
  },

  registerTarget(el, opts) {
    targets.set(el, opts);
    el.dataset.dropTarget = opts.kind ?? '1';
  },
};

let active = null; // { el, payload, startX, startY, dragging, ghost, hoverTarget, pointerId }

function onPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return; // ignore right/middle
  const el = e.currentTarget;
  const opts = sources.get(el);
  if (!opts) return;
  active = {
    el,
    opts,
    payload: opts.payload(),
    startX: e.clientX,
    startY: e.clientY,
    dragging: false,
    ghost: null,
    hoverTarget: null,
    pointerId: e.pointerId,
  };
  // Capture so we keep getting events even if pointer leaves el.
  try { el.setPointerCapture(e.pointerId); } catch { /* unsupported on some browsers */ }
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('keydown', onKeyDown);
}

function onPointerMove(e) {
  if (!active || e.pointerId !== active.pointerId) return;
  if (!active.dragging) {
    if (!exceedsThreshold(active.startX, active.startY, e.clientX, e.clientY)) return;
    beginDrag();
  }
  positionGhost(e.clientX, e.clientY);
  updateHoverTarget(e.clientX, e.clientY);
}

function onPointerUp(e) {
  if (!active || e.pointerId !== active.pointerId) return;
  if (!active.dragging) {
    // Tap — no movement.
    teardown();
    if (active.opts.onTap) active.opts.onTap();
    active = null;
    return;
  }
  const targetEl = resolveTarget(e.clientX, e.clientY, document.elementFromPoint.bind(document));
  const targetOpts = targetEl ? targets.get(targetEl) : null;
  const accepts = targetOpts && (targetOpts.accepts ? targetOpts.accepts(active.payload) : true);
  if (accepts) {
    tick(12);
    snapToTarget(targetEl, () => {
      teardown();
      targetOpts.onDrop(active.payload);
      active = null;
    });
  } else {
    snapBackHome(() => {
      teardown();
      active = null;
    });
  }
}

function onPointerCancel() {
  if (!active) return;
  if (active.dragging) snapBackHome(() => { teardown(); active = null; });
  else { teardown(); active = null; }
}

function onKeyDown(e) {
  if (!active || e.key !== 'Escape') return;
  if (active.dragging) snapBackHome(() => { teardown(); active = null; });
  else { teardown(); active = null; }
}

function beginDrag() {
  active.dragging = true;
  document.body.classList.add('dragging');
  active.el.classList.add('dragging');
  active.ghost = makeGhost(active.el);
  document.body.appendChild(active.ghost);
  if (active.opts.onDragStart) active.opts.onDragStart(active.payload);
  highlightAllTargets(true);
  tick(8);
}

function makeGhost(src) {
  const rect = src.getBoundingClientRect();
  const g = src.cloneNode(true);
  g.removeAttribute('data-drag-source');
  g.classList.add('drag-ghost');
  g.style.position = 'fixed';
  g.style.left = '0';
  g.style.top = '0';
  g.style.width = rect.width + 'px';
  g.style.height = rect.height + 'px';
  g.style.pointerEvents = 'none';
  g.style.zIndex = '9999';
  g.style.willChange = 'transform';
  g.dataset.ghostX = rect.left;
  g.dataset.ghostY = rect.top;
  return g;
}

function positionGhost(x, y) {
  const g = active.ghost;
  if (!g) return;
  const rect = g.getBoundingClientRect();
  const w = parseFloat(g.style.width);
  const h = parseFloat(g.style.height);
  const nx = x - w / 2;
  const ny = y - h - 24;       // 24 px above the finger; ghost is scaled so visual top is ~32 px
  const scale = REDUCED_MOTION ? 1 : 1.15;
  g.style.transform = `translate(${nx}px, ${ny}px) scale(${scale})`;
}

function updateHoverTarget(x, y) {
  const targetEl = resolveTarget(x, y, document.elementFromPoint.bind(document));
  if (active.hoverTarget === targetEl) return;
  if (active.hoverTarget) active.hoverTarget.classList.remove('drop-target');
  active.hoverTarget = targetEl;
  if (targetEl) {
    const opts = targets.get(targetEl);
    if (opts && (!opts.accepts || opts.accepts(active.payload))) {
      targetEl.classList.add('drop-target');
    } else {
      active.hoverTarget = null;
    }
  }
}

function highlightAllTargets(on) {
  // Hint *all* legal empty cells (used for board cells).
  document.body.classList.toggle('drag-hint', on);
}

function snapToTarget(targetEl, done) {
  const ghost = active.ghost;
  if (!ghost || !targetEl || REDUCED_MOTION) { done(); return; }
  const r = targetEl.getBoundingClientRect();
  ghost.style.transition = 'transform 120ms ease';
  ghost.style.transform = `translate(${r.left}px, ${r.top}px) scale(1)`;
  setTimeout(done, 130);
}

function snapBackHome(done) {
  const ghost = active.ghost;
  if (!ghost || REDUCED_MOTION) { done(); return; }
  const x = parseFloat(ghost.dataset.ghostX);
  const y = parseFloat(ghost.dataset.ghostY);
  ghost.style.transition = 'transform 160ms ease';
  ghost.style.transform = `translate(${x}px, ${y}px) scale(1)`;
  setTimeout(done, 170);
}

function teardown() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
  document.removeEventListener('keydown', onKeyDown);
  if (active?.el) active.el.classList.remove('dragging');
  if (active?.hoverTarget) active.hoverTarget.classList.remove('drop-target');
  if (active?.ghost) active.ghost.remove();
  document.body.classList.remove('dragging', 'drag-hint');
  if (active?.opts?.onDragEnd) active.opts.onDragEnd();
}

function tick(ms) {
  if (!navigator.vibrate) return;
  try { navigator.vibrate(ms); } catch { /* ignore */ }
}
```

- [ ] **Step 2: Add ghost + drag-hint CSS**

In `public/style.css`, append:

```css
/* Drag manager: ghost element + hint state */
.drag-ghost {
  border-radius: 3px;
  transform-origin: 50% 50%;
  filter: drop-shadow(0 8px 18px rgba(34, 22, 8, 0.55));
}

/* While dragging, cells with data-drop-target get a faint copper ring */
body.dragging.drag-hint .cell[data-drop-target] {
  box-shadow:
    inset 0 0 0 1px var(--grid-line),
    inset 0 0 0 2px rgba(196, 122, 74, 0.30);
}

/* Strong copper ring on the active hover target (overrides the hint) */
body.dragging.drag-hint .cell.drop-target,
body.dragging .cell.drop-target {
  box-shadow:
    inset 0 0 0 1px var(--grid-line),
    inset 0 0 0 2px var(--drop);
}

/* Disable transitions on the ghost during follow-the-pointer */
.drag-ghost { transition: none; }

@media (prefers-reduced-motion: reduce) {
  .drag-ghost { transition: none !important; }
}
```

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npm test
```

Expected: all server tests + drag.js tests pass.

- [ ] **Step 4: Commit**

```bash
git add public/drag.js public/style.css
git commit -m "feat(drag): pointer-events lifecycle, ghost element, target hinting, haptics"
```

---

## Task 9: Wire `board.js` to drag manager

**Files:**
- Modify: `public/board.js`

Replace the HTML5 drag listeners on cells with `dragManager.registerSource` / `registerTarget`. Keep the `click` handler for tap-on-empty-cell-after-select.

- [ ] **Step 1: Update imports and the cell-render block**

In `public/board.js`, add at the top with the other imports:

```js
import { dragManager } from './drag.js';
```

Find the `renderBoard` function. Replace the entire `if (placed) { … } else if (tentative) { … }` block plus the trailing drop-target-listener block (lines 64–126) with this:

```js
if (placed) {
  cell.appendChild(makeTile(placed.letter, placed.blank, `b:${r},${c},${placed.letter}`));
} else if (tentative) {
  cell.classList.add('placed');
  const tile = makeTile(tentative.letter, tentative.blank, `t:${tentative.fromRackIdx},${tentative.letter}`);
  cell.appendChild(tile);
  if (validation) {
    if (validation.invalidPositions?.has(k)) cell.classList.add('invalid');
    else if (validation.validPositions?.has(k)) cell.classList.add('valid');
  }
  // Tentative tile is a drag source. Tap recalls (handled via cell click).
  dragManager.registerSource(tile, {
    payload: () => ({ kind: 'cell', r, c }),
    onTap: () => {
      if (onCellClick) onCellClick(r, c);
    },
  });
} else if (kind === 'star') {
  const s = document.createElement('div');
  s.className = 'premium-star';
  s.innerHTML = '<svg viewBox="0 0 24 24" width="62%" height="62%"><path d="M12 3l1.8 5.7H19.6l-4.7 3.5 1.8 5.7L12 14.4l-4.7 3.5 1.8-5.7L4.4 8.7h5.8z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  cell.appendChild(s);
} else if (PREMIUMS[kind]) {
  const rule = document.createElement('div');
  rule.className = 'premium-rule';
  cell.appendChild(rule);
  const wrap = document.createElement('div');
  wrap.className = 'premium';
  const sym = document.createElement('div');
  sym.className = 'premium-sym';
  sym.textContent = PREMIUMS[kind].sym;
  wrap.appendChild(sym);
  const lbl = document.createElement('div');
  lbl.className = 'premium-kind';
  lbl.textContent = PREMIUMS[kind].kind;
  wrap.appendChild(lbl);
  cell.appendChild(wrap);
}

if (onCellClick) cell.addEventListener('click', () => onCellClick(r, c));

// Empty, server-vacant cells are drop targets.
const isEmpty = !placed && !tentative;
if (isEmpty && onCellDrop) {
  dragManager.registerTarget(cell, {
    kind: 'cell',
    onDrop: (payload) => {
      // Re-shape payload into the legacy 'rack:idx' / 'cell:r:c' string the existing
      // app handler expects — minimises blast radius in app.js.
      let s;
      if (payload.kind === 'rack') s = `rack:${payload.idx}`;
      else if (payload.kind === 'cell') s = `cell:${payload.r}:${payload.c}`;
      else return;
      onCellDrop(r, c, s);
    },
  });
}
```

(The `renderBoard` function signature `({ onCellClick, onCellDrop, onTentativeDragStart, validation })` keeps the `onTentativeDragStart` parameter — it's no longer used here, but keeping it preserves the public shape; no changes needed in `app.js`.)

- [ ] **Step 2: Verify in browser**

Open the app at `http://localhost:3000` on desktop and confirm:
1. Drag a rack tile onto an empty cell — it places.
2. Drag a tentative tile to a different empty cell — it moves.
3. Click a tentative tile — it recalls back to the rack.
4. While dragging, every empty cell shows a faint copper ring; the cell under the pointer goes solid copper.

Then open DevTools → Toggle device toolbar → iPhone 12 Pro and repeat #1–#4 with mouse-as-touch.

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: all green (server tests + drag tests).

- [ ] **Step 4: Commit**

```bash
git add public/board.js
git commit -m "feat(board): use pointer-events drag manager instead of HTML5 dragstart/drop"
```

---

## Task 10: Wire `rack.js` to drag manager

**Files:**
- Modify: `public/rack.js`

Replace the rack-side HTML5 drag listeners. Preserve: drag-rack-tile-to-cell, recall-via-drop, drag-rack-to-rack-reorder, tap-to-select.

- [ ] **Step 1: Replace `renderRack` body**

In `public/rack.js`, replace the entire `renderRack` function body (lines 6–88) with:

```js
import { dragManager } from './drag.js';

export function renderRack(root, { onSlotClick, onDragStart, onRecallDrop, onRackReorder } = {}) {
  root.innerHTML = '';
  const inUse = new Set();
  for (const t of ui.tentative) inUse.add(t.fromRackIdx);

  ui.rackOrder.forEach((letter, idx) => {
    const slot = document.createElement('div');
    slot.className = 'rack-slot';
    slot.dataset.idx = idx;
    if (!inUse.has(idx)) {
      slot.classList.add('tile');
      const blank = letter === '_';
      const lt = document.createElement('span');
      lt.className = 'tile-letter';
      lt.textContent = blank ? '·' : letter;
      slot.appendChild(lt);
      if (!blank) {
        const pt = document.createElement('span');
        pt.className = 'tile-points';
        pt.textContent = POINTS[letter] ?? '';
        slot.appendChild(pt);
      }
      applyTileTexture(slot, `r:${idx}:${letter}`);

      // Source: drag = pick up; tap = select.
      dragManager.registerSource(slot, {
        payload: () => ({ kind: 'rack', idx }),
        onTap: () => { if (onSlotClick) onSlotClick(idx, letter); },
        onDragStart: () => { if (onDragStart) onDragStart({ kind: 'rack', idx }); },
      });

      // Target: drop = swap rack order.
      if (onRackReorder) {
        dragManager.registerTarget(slot, {
          kind: 'rack-slot',
          accepts: (payload) => payload.kind === 'rack' && payload.idx !== idx,
          onDrop: (payload) => onRackReorder(payload.idx, idx),
        });
      }
    }
    root.appendChild(slot);
  });

  // Recall: dropping a board-tentative tile onto the rack frame recalls it.
  if (onRecallDrop) {
    dragManager.registerTarget(root, {
      kind: 'rack',
      accepts: (payload) => payload.kind === 'cell',
      onDrop: (payload) => onRecallDrop(payload.r, payload.c),
    });
  }
}
```

(Note: rack-slot drop targets must take precedence over the rack-frame drop target when a `cell:`-payload is dropped near a slot. In practice `resolveTarget` walks up from the hit element via `closest`; the slot is more specific than the rack root, so a drop on a slot reaches the slot's `accepts` first. Slot rejects `cell` payloads via `accepts`, so `updateHoverTarget` won't highlight it for that payload — but if the user releases over a slot with a `cell` payload, the slot's `onDrop` won't fire because `accepts` returned false. We need the rack root to still catch it. The fix: we call `resolveTarget` and check `accepts` at drop time; if it rejects, walk further up.)

- [ ] **Step 2: Add target-walk-up logic in `drag.js`**

The above plan needs `drag.js` to fall through to the next ancestor if `accepts` rejects. Open `public/drag.js`, find `resolveTarget`, and replace its body with:

```js
export function resolveTarget(x, y, elementFromPoint, accepts = () => true) {
  let hit = elementFromPoint(x, y);
  if (!hit) return null;
  while (hit) {
    const candidate = hit.closest ? hit.closest('[data-drop-target]') : null;
    if (!candidate) return null;
    if (accepts(candidate)) return candidate;
    // Reject — try the candidate's parent.
    hit = candidate.parentElement;
  }
  return null;
}
```

Update the existing `resolveTarget` callers in `drag.js` to pass an accepts predicate:

In `onPointerUp`, replace:
```js
const targetEl = resolveTarget(e.clientX, e.clientY, document.elementFromPoint.bind(document));
const targetOpts = targetEl ? targets.get(targetEl) : null;
const accepts = targetOpts && (targetOpts.accepts ? targetOpts.accepts(active.payload) : true);
if (accepts) {
```
with:
```js
const targetEl = resolveTarget(
  e.clientX, e.clientY,
  document.elementFromPoint.bind(document),
  (el) => {
    const o = targets.get(el);
    return o && (!o.accepts || o.accepts(active.payload));
  },
);
const targetOpts = targetEl ? targets.get(targetEl) : null;
if (targetOpts) {
```

In `updateHoverTarget`, replace the body with:
```js
function updateHoverTarget(x, y) {
  const targetEl = resolveTarget(
    x, y,
    document.elementFromPoint.bind(document),
    (el) => {
      const o = targets.get(el);
      return o && (!o.accepts || o.accepts(active.payload));
    },
  );
  if (active.hoverTarget === targetEl) return;
  if (active.hoverTarget) active.hoverTarget.classList.remove('drop-target');
  active.hoverTarget = targetEl;
  if (targetEl) targetEl.classList.add('drop-target');
}
```

- [ ] **Step 3: Update `resolveTarget` tests**

In `test/drag.test.js`, the existing `resolveTarget` tests still work because `accepts` defaults to a function that always returns true. Add one new test for the walk-up:

```js
test('resolveTarget walks up the parent chain when accepts rejects', () => {
  const outer = makeElement({ id: 'outer', dropTarget: 'rack' });
  const inner = makeElement({ id: 'inner', dropTarget: 'rack-slot', parent: outer });
  // Make .closest find inner first, then need to walk up to outer.
  const child = makeElement({ id: 'child', parent: inner });
  // accepts: only outer is acceptable.
  const result = resolveTarget(
    0, 0,
    () => child,
    (el) => el.id === 'outer',
  );
  assert.equal(result.id, 'outer');
});
```

Also add a `parentElement` polyfill in `makeElement` so the walk-up works in the stub. Update the `makeElement` helper:

```js
function makeElement({ id, dropTarget = null, parent = null }) {
  const el = {
    id,
    dataset: dropTarget ? { dropTarget } : {},
    parent,
    parentElement: parent,
  };
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
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --test-name-pattern='resolveTarget|drag'
```

Expected: PASS, all drag-related tests green including the new walk-up test.

- [ ] **Step 5: Verify in browser**

Reload `http://localhost:3000`. Confirm:
1. Drag rack tile A onto rack tile B — they swap order.
2. Drag a tentative board tile onto an open rack-slot area — recall (because rack-slot rejects, falls through to rack root which accepts cells).
3. Drag rack tile onto an in-use rack slot — no swap (it's not registered as a target while in-use).
4. Tap a rack tile — selects it; tap an empty cell — places it.

- [ ] **Step 6: Commit**

```bash
git add public/rack.js public/drag.js test/drag.test.js
git commit -m "feat(rack): use pointer-events drag manager; manager walks up on accept-reject"
```

---

## Task 11: Reduced-motion polish + tile `.dragging` styling

**Files:**
- Modify: `public/style.css`

The drag manager already toggles `.dragging` on the source element and `body.dragging`. The existing `.tile.dragging` rule (around line 251) makes the source semi-transparent — good. But `.rack-slot.tile.dragging` is also already covered. This task confirms reduced-motion behavior and trims any leftover HTML5-drag CSS.

- [ ] **Step 1: Audit & remove obsolete drag CSS**

In `public/style.css`, find the `Drag-and-drop affordances` block (around lines 241–260):

```css
/* Drag-and-drop affordances */
.cell.drop-target {
  box-shadow:
    inset 0 0 0 1px var(--grid-line),
    inset 0 0 0 2px var(--drop);
}
#rack.drop-target {
  outline: 2px dashed var(--drop);
  outline-offset: -6px;
}
.tile.dragging,
.rack-slot.tile.dragging {
  opacity: 0.45;
}
.cell.placed .tile {
  cursor: grab;
}
.cell.placed .tile:active {
  cursor: grabbing;
}
```

The `.cell.drop-target` and `#rack.drop-target` rules now overlap with the new ones in Task 8. Replace the whole block with:

```css
/* Drag-and-drop affordances (pointer-events drag manager) */
.tile.dragging,
.rack-slot.tile.dragging {
  opacity: 0.45;
}
.cell.placed .tile { cursor: grab; }
.cell.placed .tile:active { cursor: grabbing; }
#rack.drop-target {
  outline: 2px dashed var(--drop);
  outline-offset: -6px;
}
/* .cell.drop-target moved to the body.dragging.drag-hint section in Task 8 */
```

- [ ] **Step 2: Add reduced-motion no-op for tile lifts**

Append to `public/style.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .rack-slot.tile:hover { transform: none; }
  #controls button:hover:not(:disabled) { transform: none; }
}
```

- [ ] **Step 3: Verify in browser**

In DevTools, toggle "Emulate CSS prefers-reduced-motion: reduce". Drag a tile — the ghost no longer scales up; snap-back is instant; hover lifts are absent.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "style(drag): trim obsolete drag-target CSS, honor reduced-motion preferences"
```

---

## Task 12: Manual mobile QA checklist

**Files:**
- Create: `docs/superpowers/specs/2026-05-04-mobile-uplift-checklist.md`

This is the verification artifact for the implementer.

- [ ] **Step 1: Write the checklist**

```markdown
# Mobile Uplift — Manual QA Checklist

Run on **iPhone Safari**, **Android Chrome**, and **desktop Chrome / Firefox / Safari**. The checklist is identical on all platforms unless noted.

## Touch interaction (iPhone Safari + Android Chrome)

- [ ] Tap a rack tile — it shows a "selected" highlight (gold ring).
- [ ] Tap an empty cell after selecting a rack tile — tile places.
- [ ] Tap a tentative tile on the board — it recalls to the rack.
- [ ] Drag a rack tile to an empty cell — places. Ghost floats above the finger; legal cells show faint copper ring; hovered cell goes full copper; haptic tick on pickup; haptic tick on drop.
- [ ] Drag a tentative tile to a different empty cell — moves.
- [ ] Drag a tentative tile onto the rack frame — recalls (no haptic, swoosh sound).
- [ ] Drag rack tile A onto rack tile B — they swap positions.
- [ ] Lift a finger off-screen mid-drag — tile snaps back, no placement.
- [ ] Press Escape (Bluetooth keyboard) mid-drag — tile snaps back.
- [ ] Vertical scroll outside a tile still works — only tile-on-tile blocks scroll.

## Mouse interaction (desktop)

- [ ] All of the above, with mouse: drag a rack tile to a cell, drag a tentative tile, swap rack order, recall via drop.
- [ ] Click a rack tile — selects. Click cell — places.
- [ ] Click a tentative tile — recalls.

## Topbar

- [ ] At 390 px viewport, "Sonia 5" is fully visible — no overlap with mute / theme circles.
- [ ] Active player's name is full ink; inactive is muted.
- [ ] Turn pill reads "Your turn" / "Sonia’s turn" with brick-red italic text.
- [ ] Sub-line reads "bag NN" left and "N in rack" right.
- [ ] When the game ends, pill reads "Game over" in muted text with no italic.
- [ ] VoiceOver / TalkBack announces turn changes (pill has `aria-live="polite"`).

## Status banner

- [ ] When no tentative tiles, banner is collapsed (no reserved space).
- [ ] After placing tiles, banner shows "…" while validating.
- [ ] Valid move: green left border, full-ink "Words: …  +24".
- [ ] Invalid move: red left border, "Invalid: …" or "Not in dictionary: …".
- [ ] Recalling all tentative tiles collapses the banner again.

## Action toolbar

- [ ] At desktop width (≥600 px), six buttons in flat layout: Submit / Recall / Shuffle / Pass / Swap / Resign.
- [ ] At phone width (<600 px), Submit on top + Recall / Shuffle / ⋯ on row 2.
- [ ] Tapping ⋯ opens "More actions" sheet with Pass turn / Swap tiles… / Resign / Cancel.
- [ ] Pass triggers the existing Pass confirm modal.
- [ ] Swap triggers the existing swap-tile picker.
- [ ] Resign triggers the existing Resign confirm modal (red button).
- [ ] Tapping the sheet's backdrop closes it without action.

## Wood theme

- [ ] Cycle theme to "wood" via the W button. Page background is dark walnut with horizontal grain. Cream text remains legible. Status banner backgrounds are still readable on dark.
- [ ] Cycle through other themes — none have regressed.
- [ ] Mute / theme floating circles are visible on dark bg.

## Cross-cutting

- [ ] No horizontal scroll on any page width.
- [ ] Opponent move callout still slides in from the right.
- [ ] "Your turn" chime plays when SSE flips the turn.
- [ ] Identity picker (first visit) still works.
- [ ] Reduced-motion preference: drag ghost has no scale, snap-back is instant.

## Regressions to watch for

- [ ] Page does not lock vertical scroll while a tile is held.
- [ ] Long-press on a tile does not trigger iOS "callout" (image-save) menu.
- [ ] Re-render after a server-pushed move correctly re-registers drag sources/targets (drag a fresh placed tile after the opponent moves).
```

- [ ] **Step 2: Run final test sweep**

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-04-mobile-uplift-checklist.md
git commit -m "docs(qa): manual mobile uplift checklist"
```
