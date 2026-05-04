# Mobile Uplift Design

**Date:** 2026-05-04
**Author:** Pippin (UX Designer)
**Status:** Approved scope, awaiting plan
**Targets:** `public/index.html`, `public/style.css`, `public/app.js`, `public/board.js`, `public/rack.js`, `public/themes.js`

---

## Goal

Make the Words client first-class on a phone. Specifically: fix visible mobile bugs, replace HTML5 drag-and-drop (which doesn't fire reliably on iOS Safari) with Pointer Events that work on touch and desktop, surface validation feedback, declutter the action toolbar, and finish the wood theme by giving it a dark page background.

Every existing interaction must continue to work: tap-to-select, click-to-recall, drag-to-reorder rack, drag-tentative-to-rack to recall, blank-tile picker, swap picker, confirm-action picker, sound + theme toggles, opponent callouts.

## Non-goals

- No changes to server protocol, scoring, dictionary, or game rules.
- No new game features (chat, history, hints, etc.).
- No design system rewrite — we extend the existing "Library" L&F.
- No new themes — we change the wood theme's page background only.

## Scope summary

| # | Issue | Fix |
|---|---|---|
| 1 | Topbar collision: floating mute/theme circles overlap "Sonia: 5" at phone widths; turn indicator is small italic | Battle-card header: single-line scores with active-turn pill between names; bag count moves into a sub-line; floating circles get out of the topbar's column at narrow widths |
| 2 | Page horizontal overflow: phantom column past the wood frame on iOS | Constrain root width and remove the `96vw` + 14 px padding combination that pushes the grid past the viewport |
| 3 | Drag/drop broken on touch | Replace HTML5 `dragstart`/`dragover`/`drop` with a Pointer-Events-based drag manager. Movement-threshold pickup. Scaled ghost offset above finger. Legal-target hinting on drag. Tap fallback preserved. |
| 4 | Six-button action sprawl | Two-row controls: full-width Submit on top, then `[Recall][Shuffle][⋯]`. ⋯ opens a sheet with Pass / Swap / Resign. Desktop keeps existing flat row but uses the same component. |
| 5 | Validation status buried | Promote `#status` to a copper-accented banner immediately below the rack, full-width, only visible while there is something to say |
| 6 | No haptics | `navigator.vibrate(8)` on pickup, `vibrate(12)` on legal drop. No-op where unsupported. |
| 7 | Wood theme: cream page bg looks unfinished | New `--page-bg: #2b1d12` (walnut) for `body[data-theme="wood"]`, with cream `--page-ink` and a subtle horizontal grain repeat |

---

## Architecture

### Module boundaries (mostly preserved)

```
index.html  — DOM scaffolding (small)
style.css   — design tokens + components
themes.js   — runtime theme cycling, tile texture
app.js      — orchestrator: state, SSE, controls
board.js    — board render + cell event wiring
rack.js     — rack render + slot event wiring
picker.js   — modal pickers (blank / swap / confirm)
state.js, validator.js, sounds.js, callout.js — unchanged
```

**New module:** `public/drag.js`. A small drag-manager that owns the pointer-event lifecycle, the ghost element, hit-testing, and target highlighting. `board.js` and `rack.js` delegate "this element is a drag source" / "this element is a drop target" to it instead of wiring their own listeners.

This is the file boundary that pays off most: today, drag logic is split across `board.js` (cell side) and `rack.js` (rack side) plus `app.js` (orchestration), so any change has to land in three places. Pulling drag mechanics into one module makes the pointer-events rewrite a single replacement.

---

## Components & layout

### Topbar (battle card)

```
┌──────────────────────────────────────────────────────────────┐
│  Keith 232          ┌──────────────┐          Sonia 5        │
│                     │ Sonia's turn │                         │
│                     └──────────────┘                         │
│  bag 15 · 5 in rack                                          │
└──────────────────────────────────────────────────────────────┘
```

- Grid: 3 columns at narrow widths (`1fr auto 1fr`). Each player's name + score is a single token; the active-turn pill sits in the middle column.
- Turn pill uses `--tw` (brick red) on a `rgba(255,255,255,0.06)` plate when wood theme, otherwise on `--tile-bg-mid`.
- Bag count + rack-remaining live in a subline below scores in 11 px mono uppercase, `--page-muted`.
- The `#btn-mute` and `#btn-theme` floating circles get a CSS `padding-right` reservation on the topbar (`@media (max-width: 480px)`) so they no longer occlude the right score.
- Active player gets a subtle text-color shift (full `--page-ink`); inactive player drops to `--page-muted`. The pill is the primary cue, the dimming is secondary.

### Board

- The 15 × 15 grid is unchanged in structure. The page-overflow bug gets fixed by:
  - `body { overflow-x: hidden }` belt — also cheap, blocks future regressions.
  - `main { width: 100%; max-width: 720px; padding-inline: 12px }` (replaces `width: min(720px, 96vw)` which combined with internal padding pushes content past the viewport when the device pixel ratio interacts with `aspect-ratio`).
- Drop-target hinting is per-cell: while a drag is active, every empty cell gets a faint `inset 0 0 0 2px var(--drop)` ring at 30% opacity. The hovered cell goes to 100% (existing `.drop-target` class).

### Rack

- Same 7-column grid. The recall drop target stays the whole `#rack` element.
- Each rack slot gets `touch-action: none` so vertical page swipes don't scroll the page mid-pickup.

### Status banner

```
┌──────────────────────────────────────────────────────────────┐
│ ◇ Words: PIPPIN — +24                                        │  ← valid (green left border)
└──────────────────────────────────────────────────────────────┘
```

- Sits between rack and actions. `min-height: 0` and `display: none` when text is empty so it collapses (vs today's reserved 22 px gap).
- States:
  - **Valid:** copper background tint + `--valid` left border, lozenge glyph. Shows words + score.
  - **Invalid:** red tint + `--invalid` left border, "Invalid: <reason>" or "Not in dictionary: <words>".
  - **Server error / pass-failed / etc.:** neutral tint, italic.
- Copy unchanged from today.

### Actions

```
┌──────────────────────────────────────────────────────────────┐
│ [          Submit move (full width)          ]               │
│ [ Recall ]   [ Shuffle ]                       [ ⋯ ]         │
└──────────────────────────────────────────────────────────────┘
```

- Submit full-width on top, dark (existing `#btn-submit` style preserved).
- Row 2: Recall, Shuffle, then a right-aligned ⋯ icon button.
- ⋯ opens a sheet styled like the existing picker panel (re-uses `picker-backdrop` + `picker-panel`) with three options: **Pass turn**, **Swap tiles…**, **Resign**. Each entry maps to the existing `passTurn` / `swapTiles` / `resign` functions in `app.js`.
- Desktop (`@media (min-width: 600px)`) keeps the existing flat 6-button layout — no regression for desk play.

---

## Drag manager (`drag.js`)

### Public API

```js
import { dragManager } from './drag.js';

// Mark a node as a drag source.
dragManager.registerSource(el, {
  payload: () => ({ kind: 'rack', idx: 3 }),  // or { kind: 'cell', r, c }
  onTap: () => { /* tap-without-drag */ },
  onDragStart: (payload) => { /* refresh target hints */ },
  onDragEnd: () => { /* tear down hints */ },
});

// Mark a node as a drop target.
dragManager.registerTarget(el, {
  accepts: (payload) => true,
  onDrop: (payload) => { /* place / recall / reorder */ },
  highlightClass: 'drop-target',  // applied while pointer is over
});
```

`board.js` and `rack.js` call `registerSource` / `registerTarget` on each render and the manager handles everything below.

### Lifecycle

1. **`pointerdown` on a source.** Capture the pointer (`setPointerCapture`) on a hidden anchor element. Record start position and time. **Do not pick up yet.**
2. **`pointermove`.** If the pointer has moved &gt; 6 px from start, transition to "dragging":
   - Build a ghost: a clone of the source element styled `position: fixed; pointer-events: none; transform: translate(...) scale(1.15);` with z-index 9999.
   - Translate so the ghost is centered horizontally on the pointer and **offset −32 px on Y** (above the finger).
   - Add `body.dragging` class + emit `onDragStart`.
   - Add `.drag-source` to the original element (existing `.dragging` styling — opacity 0.45).
   - Use `document.elementFromPoint(e.clientX, e.clientY)` each move to find the topmost target; toggle `highlightClass` on the right element.
3. **`pointerup`.**
   - If we never transitioned to dragging: emit `onTap` (preserves tap-to-select / tap-to-recall).
   - If dragging: pick the target under the release point. If `accepts(payload)` returns true, call `onDrop(payload)`. Otherwise snap-back: animate ghost back to source position and dispose. Emit `onDragEnd`.
4. **`pointercancel`** (system gesture, incoming call, `Esc` keypress while dragging). Snap-back, dispose, no drop.

### Hit-testing

- `elementFromPoint` returns the visually-topmost element under the cursor. We walk up from there with `closest('[data-drop-target]')` to find the registered target.
- Targets carry a `data-drop-target` attribute set by `registerTarget` — easy to query, no internal registry lookup needed.

### Scroll-vs-drag

- All registered sources get `touch-action: none` (set in CSS via `.tile-source`, `.rack-slot.tile`, `.cell.placed .tile`).
- This disables native scroll/zoom while the pointer is on a tile. The rest of the page keeps default touch-action so the user can still scroll the page when not on a tile.

### Ghost offset & sizing

- **Scale:** `1.15`. Big enough to look "lifted," small enough not to obscure neighbors.
- **Y-offset:** `-32px` from the finger. On desktop with a mouse, this offset is invisible-ish (cursor sits below the tile, which is fine). We could compute "`pointerType === 'touch'` → −32, else 0" but the tile feels lifted on mouse too — keep one rule.
- **Drop animation:** on legal drop, the ghost translates/scales to the target cell over 120 ms then disposes; the real placed tile renders after. On illegal/cancel, ghost translates back to source over 160 ms.

### Pointer Events ⇒ existing functionality matrix

| Existing path | New impl |
|---|---|
| Rack tile → empty cell (HTML5 drag) | source on rack-slot, target on cell |
| Tentative tile → another empty cell | source on `.cell.placed .tile`, target on cell |
| Tentative tile → rack (recall) | source on `.cell.placed .tile`, target on `#rack` |
| Rack tile → other rack slot (reorder) | source on rack-slot, target on rack-slot |
| Tap rack tile (select) | `onTap` on rack-slot |
| Tap tentative tile (recall) | `onTap` on `.cell.placed .tile` (calls `handleBoardClick`) |
| Tap empty cell after select | unchanged — `cell` `click` handler stays |
| Click `#btn-submit` etc. | unchanged |
| Mouse drag on desktop | works through Pointer Events same as touch |

### Haptics

- Single helper in `drag.js`: `tick(ms)` calls `navigator.vibrate?.(ms)` if available.
- Pickup: `tick(8)`.
- Legal drop: `tick(12)`.
- No vibrate on tap (would be jarring), recall (sound covers it), or cancel (silent failure is fine).

---

## Wood theme palette change

```css
body[data-theme="wood"] {
  /* keep board greens and frame browns from existing wood theme */
  --board-hi: #2d5a3c;
  --board-mid: #244832;
  --board-lo:  #1c3826;
  --frame-hi:  #9a774f;
  --frame-lo:  #5a3f24;
  --grid-line: rgba(0,0,0,0.30);

  /* CHANGED: dark walnut page bg + cream ink */
  --page-bg:    #2b1d12;
  --page-ink:   #efe6d3;
  --page-muted: rgba(239, 230, 211, 0.55);

  --tw: #e87053;
  --dw: #e8a263;
  --tl: #6dadc4;
  --dl: #98c4d8;
}

body[data-theme="wood"] {
  background-image:
    repeating-linear-gradient(88deg,
      rgba(0,0,0,0.30) 0 2px, transparent 2px 9px,
      rgba(255,255,255,0.04) 9px 10px, transparent 10px 18px);
}
```

Knock-on adjustments inside `body[data-theme="wood"]`:

- Topbar bottom border switches to `rgba(239,230,211,0.18)` (currently a dark brown `rgba(42,33,24,0.18)`, which would vanish on dark bg).
- Status banner background tints get a `mix(white, ...)` boost so they're still readable on dark.
- Existing `#identity-picker` text color works because we override `--page-ink`. No selector changes needed.
- `#btn-mute` and `#btn-theme` already use `--tile-bg-mid` for background — fine on dark.

---

## Data flow

Unchanged. The drag manager doesn't know about `ui` state; it just delivers a payload to the registered drop handler. `app.js` keeps the orchestration:

- `placeFromRack(r, c, idx)` — called on rack→cell drops AND on cell taps after a rack-slot tap.
- `handleCellDrop(r, c, payload)` — called for cell→cell moves and cell→rack recall (the rack-target version flips to `handleRackRecall`).
- `handleRackReorder(fromIdx, toIdx)` — rack→rack drops.
- `handleBoardClick(r, c)` — taps that aren't drags.

The render loop (`refresh`) re-runs after every state change and re-registers sources/targets on the new DOM, so there's no listener bookkeeping in the manager beyond a `WeakMap` for cleanup.

---

## States & interactions

### Tile (rack)

- Default: cream texture, points in corner.
- Hover (mouse): translateY(−1 px) + larger shadow (today's behavior).
- Tap-selected (no drag started): inset 2 px gold ring, very subtle translateY. New state, replaces today's invisible "selected" feedback.
- Dragging: opacity 0.45 (today's behavior).
- Reorder-target: existing `.drop-target` outline.

### Tile (tentative on board)

- Default: gold ring (existing `.placed`).
- Validating: same gold ring.
- Valid: green ring (existing `.valid`).
- Invalid: red ring (existing `.invalid`).
- Dragging: opacity 0.45 (existing).

### Cell

- Default: nothing.
- Drag active + empty: faint copper inset ring at 30% opacity.
- Drag-over: existing `.drop-target` (full-strength copper inset).
- Server-occupied: never a target; no change in appearance.

### Topbar pill

- Active state: brick-red text on `--tile-bg-mid` plate, italic, ~13 px.
- Game-ended state: pill text becomes "Game over" in `--page-muted`, plate becomes `--page-bg` with subtle border.

### Status banner

- Hidden when empty.
- Mounting: 120 ms fade-in (no slide; the layout shouldn't bounce).
- Dismounting: 80 ms fade.

### ⋯ menu

- Tap ⋯ → existing picker-backdrop fades in, picker-panel slides up 8 px.
- Inside: title "More actions", three buttons (Pass / Swap / Resign), Cancel button. Swap calls existing `swapTiles` (which already opens its own picker — yes, picker-on-picker; Pass and Resign call existing `confirmAction` modals).
- Tap backdrop or Cancel closes.

---

## Accessibility

- Every action button keeps its existing button semantics + `aria-label`.
- Active-turn pill gets `role="status" aria-live="polite"` so screen readers announce turn changes.
- Status banner gets `role="status" aria-live="polite"`.
- ⋯ button: `aria-label="More actions"`, `aria-haspopup="dialog"`, `aria-expanded` toggled.
- Drag manager respects `prefers-reduced-motion`: snap-back animation becomes instant; no scale on ghost.
- Color contrast: walnut `#2b1d12` against cream `#efe6d3` text → 11.7:1 (AAA). Pill brick-red on cream-tinted plate → 5.1:1 (AA). Status banner border colors are decorative, not load-bearing.
- Keyboard: drag isn't keyboard-operable, but tap-to-select + Enter on a cell already works for keyboard users; we preserve that path.

---

## Error handling

- **`pointercancel` mid-drag** → snap-back, no state change.
- **Drop on a no-longer-empty cell** (server state changed during drag, very rare) → snap-back; the existing `placeFromRack` early-return for occupied cells continues to guard.
- **Vibration API absent** → silent no-op.
- **`elementFromPoint` returns `null`** (drag ended outside the viewport) → treat as cancel, snap-back.
- **Blank picker mid-drag**: a tile dragged from a `_` rack slot opens the blank picker on drop. While the picker is open, the ghost is already gone; cancelling the picker leaves the rack slot in place (existing behavior).

---

## Testing

This codebase has no client-side test harness today. We add one alongside this work:

- **Unit:** small Jest/Vitest suite for `drag.js` only — pure functions: distance threshold detection, target-from-point resolution (with a stub `elementFromPoint`), payload payload-shape assertions. ~6 tests.
- **Manual checklist** (lives in `docs/superpowers/specs/2026-05-04-mobile-uplift-checklist.md` produced during implementation):
  - iPhone Safari: tap-tap, drag rack→cell, drag tentative→rack, drag cell→cell, rack reorder, swap, pass, resign, blank picker, theme cycle on wood, mute toggle, opponent move callout, "your turn" chime.
  - Android Chrome: same.
  - Desktop Chrome/Firefox/Safari: same — drag must still work via Pointer Events on mouse.
  - VoiceOver pass: turn announcement, status announcement, button labels.
- No new server tests — server is unchanged.

---

## Open decisions / deferred

- **Long-form tile font on small phones.** At 22 px cells, the letter is fine but the points sub-script can blur. We're not changing typography in this pass — track for a follow-up.
- **Blank tile picker on touch.** Already a modal, already works. Not in scope.
- **Landscape orientation.** Today the page squishes on landscape phone; out of scope, follow-up.
- **Settings panel** (currently no place for "show coordinates", "high contrast", etc.). Out of scope; the ⋯ menu sets the precedent for a future expansion.

---

## Risks

| Risk | Mitigation |
|---|---|
| iOS Safari quirks with `setPointerCapture` on cloned elements | Capture on a hidden anchor instead of the source/ghost — well-supported pattern |
| Ghost element flicker on first frame | Render ghost with `visibility: hidden`, request animation frame, position, then `visibility: visible` |
| Page accidentally scrolls when user swipes from the rack edge | `touch-action: none` on tile elements + `overflow-x: hidden` on body |
| Existing HTML5 drag wired in two files; rewrite touches both | New `drag.js` becomes the single source — old listeners deleted, not parallel-running |
| Walnut bg makes cream rack tiles "float" awkwardly | Add a subtle `box-shadow` deepening on the rack frame in wood theme — already present, may need a tweak |

---

## Implementation slices (sketch — full plan is the next skill's job)

1. CSS-only: walnut page bg + battle-card topbar + status banner promotion + responsive controls layout.
2. Markup: ⋯ button + sheet wiring (re-uses existing picker components).
3. New `drag.js` + delete old listeners in `board.js`/`rack.js`.
4. Haptics + reduced-motion handling.
5. Manual mobile pass + checklist.
