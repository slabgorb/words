# Cribbage plugin (single-deal sandbox)

**Status:** Design (pending implementation plan)
**Date:** 2026-05-07
**Decision driver:** Cribbage is a family favorite. First card-using plugin in Gamebox. Two new challenges: a card primitive (none exist yet) and a multi-phase pace that breaks the "one big move per turn" pattern of existing plugins.

---

## 1. Goals & non-goals

### Goals
- Add a Cribbage plugin that plays **one full deal end-to-end**: deal → discard-to-crib → cut → pegging → show.
- Follow the existing plugin contract (`initialState`, `applyAction`, `publicView`, optional `legalActions`).
- Introduce a card model **inside the plugin** (no shared `src/shared/cards/` module yet — YAGNI until a second card game).
- Preserve cribbage vernacular in the show breakdown ("Fifteen-two, fifteen-four, and a pair makes six…").
- All standard scoring rules: 15s, pairs/trips/quads, runs, flushes (4-only in hand, 5-only in crib), nobs, nibs/heels, pegging 15/31/pairs/runs/last-card.
- Deterministic deals under a seeded RNG for tests.

### Non-goals (v1)
- First-to-121 / cross-deal scoring (deferred — this slice ends after one deal)
- Match play / multiple legs
- Muggins (manual scoring claims with steal-on-miss)
- Manual hand-counting UI ("count your own hand")
- Bot opponent
- 3- or 4-player cribbage variants (host enforces `players: 2`)
- Cribbage board (peg track) UI — without a cross-deal race, the iconography doesn't earn its keep yet
- Shotgun / Lowball / other variants

---

## 2. Plugin manifest

```js
// plugins/cribbage/plugin.js
export default {
  id: 'cribbage',
  displayName: 'Cribbage',
  players: 2,
  clientDir: 'plugins/cribbage/client',
  initialState: buildInitialState,
  applyAction: applyCribbageAction,
  publicView: cribbagePublicView,
  legalActions, // optional, computed from phase
};
```

---

## 3. Module layout

```
plugins/cribbage/
  plugin.js                 # manifest + lifecycle wiring
  server/
    cards.js                # rank/suit constants, deck, shuffle, pip-value, sort, format
    state.js                # buildInitialState — shuffle, deal, set phase='discard'
    actions.js              # applyAction — switch on (phase, action.type)
    phases/
      discard.js            # apply discard, gate on both-submitted, build crib
      cut.js                # apply cut, score nibs, init pegging state
      pegging.js            # apply play, auto-go, scoring, run reset, end-of-pegging
      show.js               # tally non-dealer hand, dealer hand, crib; produce breakdown
    scoring/
      pegging.js            # score one play (15, 31, pair/trip/quad, run-tail, last-card)
      hand.js               # score (4 cards + starter, isCrib?) → { items, total }
    view.js                 # publicView — hide opponent hand, hide crib pre-show, redact deck
  client/
    index.html, style.css
    app.js                  # mount, action dispatch, SSE
    card.js                 # SVG/CSS card component (rank+suit)
    hand.js                 # 6-or-4 card hand with select-to-discard
    table.js                # crib slot, starter slot, pegging strip
    pegging.js              # running total, last-played strip, "Go" indicator
    show.js                 # per-hand breakdown card with cribbage vernacular
    phase-banner.js         # "Discard 2 to the crib", "Cut the deck", etc.
```

Each phase reducer stays under ~150 lines and is independently testable. Scoring is split from phase logic so `scoreHand` is reused for non-dealer's hand, dealer's hand, and the crib (with a flag for the crib-flush rule).

---

## 4. Card model

```js
// cards.js
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
// Card = { rank: Rank, suit: Suit }

pipValue(card)   // A=1, 2..9 face, T/J/Q/K=10
runValue(card)   // A=1, 2..9 face, T=10, J=11, Q=12, K=13  (for run detection)
buildDeck()      // 52 cards
shuffle(deck, rng) // Fisher-Yates with injected RNG
```

`pipValue` is the count toward 15/31. `runValue` is rank ordering for run detection (Aces always low — standard cribbage). Two distinct functions because conflating them is the most common cribbage scoring bug.

---

## 5. State shape

```js
state = {
  phase: 'discard' | 'cut' | 'pegging' | 'show' | 'done',
  rngSeed: string,                  // for deterministic shuffle/cut
  dealer: 0 | 1,                    // index into players
  deck: Card[],                     // remaining undealt cards (for the cut)
  hands: [Card[], Card[]],          // 6 each during discard, 4 each after
  pendingDiscards: [Card[] | null, Card[] | null],
  crib: Card[],                     // populated when discard phase advances; hidden pre-show
  starter: Card | null,             // revealed at end of cut phase
  pegging: {
    running: number,                // current count toward 31
    history: Card[],                // cards played since last run-reset
    pile:    [Card[], Card[]],      // each player's cards played so far this deal
    next:    0 | 1,
    lastPlayer: 0 | 1 | null,
    saidGo: [boolean, boolean],     // resets at each new run
  } | null,
  scores: [number, number],         // running deal score
  showBreakdown: {
    nonDealer: { items: ScoreItem[], total: number },
    dealer:    { items: ScoreItem[], total: number },
    crib:      { items: ScoreItem[], total: number },
  } | null,
  acknowledged: [boolean, boolean],
};

// ScoreItem = {
//   kind: 'fifteen' | 'pair' | 'pair-pegging' | 'run' | 'flush' | 'nobs'
//       | 'nibs' | 'thirty-one' | 'last-card' | 'go',
//   points: number,
//   cards: Card[],
//   say: string,           // vernacular phrase, e.g. "Fifteen-two"
// }
```

`dealer` is fixed for the deal. **v1 chooses `dealer = 0`** (the host enforces consistent player ordering; rotation is a non-goal for the single-deal slice). Non-dealer = `1 - dealer`.

---

## 6. Action set

| Action | Allowed phase | Validation | Effect |
|---|---|---|---|
| `discard({ cards: [Card, Card] })` | `discard` | both cards in `hands[player]`, distinct, `pendingDiscards[player]` not yet set | sets `pendingDiscards[player]`. If both filled: move both pairs to `crib`, hands shrink to 4, advance to `cut`. |
| `cut()` | `cut` | actor is non-dealer | pop random card from remaining deck → `starter`. If J → `scores[dealer] += 2` (nibs/heels), record ScoreItem. Init `pegging` state. Advance to `pegging`. |
| `play({ card })` | `pegging` | actor is `pegging.next`, card in actor's remaining hand, `pipValue(card) + running ≤ 31` | append to history/pile, score the play (§7), then transition (§7). |
| `next()` | `show` | always | `acknowledged[player] = true`. When both true, advance to `done`. |

**Errors** (thrown, never silently dropped):
- `E_PHASE` — action not allowed in current phase
- `E_NOT_YOUR_TURN` — pegging player isn't `pegging.next`
- `E_BAD_CARD` — card not in actor's hand or already played
- `E_OVER_31` — proposed play would exceed 31 (and a legal play exists)
- `E_ALREADY_DISCARDED` — discard called twice by same player
- `E_BAD_DISCARD` — wrong number of cards or duplicates

The reducer is pure: `(state, action, actorIndex) -> nextState`. Inputs are not mutated.

---

## 7. Pegging mechanics

After a successful `play(card)`:

1. **Update bookkeeping:** append card to `pegging.history` and `pegging.pile[player]`; `running += pipValue(card)`; `lastPlayer = player`.
2. **Score the play** via `scoring/pegging.js`:
   - `running === 15` → +2 (`fifteen`)
   - `running === 31` → +2 (`thirty-one`)
   - Tail of `history` is N matching ranks (N=2,3,4) → +2 / +6 / +12 (`pair-pegging`)
   - Tail of `history` is a contiguous run of N ≥ 3 (any tail order) → +N (`run`)
3. **Transition:**
   - If `running === 31`: end this run. Reset `running = 0`, clear `history`, reset `saidGo = [false, false]`, set `next = 1 - lastPlayer`. (`saidGo` always resets at every run reset, whether triggered by 31 or by both-go.)
   - Else: `next = 1 - player`.
4. **Auto-go check** (loops until a playable hand exists or pegging ends):
   - If `next` has any remaining card with `pipValue ≤ 31 - running`: stop, await their action.
   - Else: mark `saidGo[next] = true`; if other player also can't play **or** has no cards left: end the run with +1 last-card to `lastPlayer` (ScoreItem `last-card`), reset run state. Otherwise pass turn to the other player.
   - If both players have empty hands and we just ended a run: advance to `show`.

On phase entry to `show`: compute `showBreakdown` (non-dealer first, then dealer, then crib — that's the canonical count order), apply totals to `scores`.

---

## 8. Hand & crib scoring

`scoreHand(fourCards, starter, { isCrib }) -> { items: ScoreItem[], total: number }` — pure function over the 5-card set.

- **Fifteens** — every subset of the 5 whose `pipValue` sums to 15: one ScoreItem per fifteen, +2 each. `say` is the cumulative count: "Fifteen-two", "fifteen-four", …
- **Pairs** — emit one ScoreItem per matching-rank group, not per pair: a pair → +2 (`say: "a pair makes …"`), trips → +6 (`say: "pair royal, …"`), quads → +12 (`say: "double pair royal, …"`). Combinatorics produce the totals; the merged item keeps the chant readable.
- **Runs** — emit one ScoreItem per distinct run found. A simple run-of-N is +N. A double run is two runs sharing a paired rank (emitted as two `run` items + one `pair` item already covered above). The scorer enumerates max-length runs first and never double-counts shorter sub-runs.
- **Flush** — non-crib: 4 hand cards same suit → +4; +5 if starter matches. Crib: requires all 5 to share suit (no 4-only flush in crib).
- **Nobs** — J in hand whose suit matches `starter.suit` → +1 (also applies to crib)

**Items are emitted in cribbage-count order** — fifteens first, then pairs, then runs, then flush, then nobs — so the `say` phrases concatenate to the canonical chant: *"Fifteen-two, fifteen-four, and a pair makes six, run for nine, his nobs is ten."*

---

## 9. Public view (information hiding)

`publicView(state, viewerIndex)`:

| Field | What viewer sees |
|---|---|
| `hands[viewerIndex]` | full cards |
| `hands[1-viewerIndex]` | `{ count: N }` (and by `show` phase the array is empty anyway — every card has been played to `pegging.pile`, which is already public) |
| `crib` | `{ count: N }` until `phase === 'show' \|\| phase === 'done'`, then full cards |
| `deck` | `{ count: N }` always (never reveal contents) |
| `pendingDiscards[viewerIndex]` | full cards (viewer confirms own selection) |
| `pendingDiscards[1-viewerIndex]` | `boolean` (submitted yes/no) |
| `pegging.pile` | full both sides (already played) |
| `starter`, `pegging.{running,history,next,lastPlayer,saidGo}`, `scores`, `showBreakdown`, `phase` | always public |
| `rngSeed` | redacted |

---

## 10. Error handling & determinism

- All validation paths throw typed errors with stable codes; route handler maps to `{ code, message }` HTTP responses (existing pattern).
- Reducer is pure; structured-cloning happens at the host boundary (existing convention) so no defensive clones inside phase reducers.
- `state.rngSeed` is set at `buildInitialState` (production: `crypto.randomUUID()`; tests: caller-supplied). Shuffle and cut both pull from a seeded PRNG derived from `rngSeed`. Same seed → same deal → same cut.

---

## 11. Client UX

- **Phase banner** at the top: clear instruction for the current phase ("Discard 2 to the crib", "Cut the deck", "Your play — running 12", "Hand counts").
- **Hand component**: 6 cards during discard with click-to-toggle selection (max 2); `Send to crib` button enabled when 2 selected. Shrinks to 4 cards after discard.
- **Table area**: crib slot (face-down stack with count badge until show), starter slot (empty until cut, then face-up), pegging strip (each player's played cards laid in front of them, current run total displayed prominently).
- **Pegging UX**: when it's your turn, only legal cards (`pipValue + running ≤ 31`) are clickable; auto-`go` is shown as a momentary "Go!" badge over the player who can't play.
- **Show overlay**: takes over center stage. Three breakdown cards in count order (non-dealer / dealer / crib). Each line of `items` rendered with its `say` phrase plus a tiny rendering of the contributing cards. Running deal-score at the bottom. Both players click `Continue` to leave; banner shows "waiting for opponent" when one has clicked.
- **No cribbage peg-board** in v1 (no race to track in single-deal scope).

---

## 12. Testing strategy

- **Unit — `cards.js`**: deck has 52 unique cards; shuffle preserves multiset; `pipValue` and `runValue` exhaustive.
- **Unit — `scoring/hand.js`**: golden corpus from cribbage textbooks:
  - 29-hand (J-5-5-5 + 5 of J's suit) = 29
  - 28-hand (5-5-5-J + 5, J off-suit) = 28
  - Perfect crib (5-5-5-5 + J, J's suit in crib) = 29
  - Double run of 3 (e.g. 4-4-5-6 + 7) = 16 (run-of-4 ×2 + pair + 15 from 4-5-6 etc.)
  - Crib flush rule: 4-suit hand + off-suit starter in crib = no flush
  - Nobs: J in hand matching starter suit = +1
- **Unit — `scoring/pegging.js`**: each event in isolation — 15-2, 31-2, pair, trip, quad, run-3, run-4, run when last 3 are out-of-order, no-event play.
- **Phase reducers**: table-driven `(state, action) → expected nextState | error` for each phase; covers all error codes and happy-path transitions.
- **Full-deal integration**: scripted `rngSeed` → fixed deal → walk through every action → assert end-of-deal `scores` and `showBreakdown`. Canonical scenarios: nibs deal, both-go run, 31-reset, last-card point, no-pegging-events deal.
- **View**: opponent's hand hidden during pegging-by-count (only `count` visible), crib hidden pre-show, deck always count-only, seed redacted.

---

## 13. Open questions / deferred

- **Dealer rotation & first-to-121** — out of scope for v1; revisit when designing the long-arc layer. The state is already shaped to extend (running deal score → match score, dealer flips between deals).
- **Cribbage board UI** — deferred until cross-deal racing exists.
- **Manual hand counting / muggins** — deferred; auto-tally chosen for v1.
- **Bot opponent** — deferred; no plugin has one yet.
- **Variants** (Shotgun, Lowball, 3-player) — out of scope.

---

## 14. Implementation plan

To be authored next via the `superpowers:writing-plans` skill.
