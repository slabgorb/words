# Buraco plugin + shared cards library

**Date:** 2026-05-08
**Author:** Architect (Gollum/Smeagol) with Keith
**Status:** Approved for implementation planning

## Summary

Add a 2-player **Buraco Brasileiro** plugin to the Gamebox host, and extract the
card primitives currently embedded in the cribbage plugin into a shared
`src/shared/cards/` library so both plugins (and any future card plugin) reuse
the same deck-building, identity, rendering, and asset surface.

Built specifically for Sonia, who is Brazilian. Brazilian rules govern any
ambiguity.

## Scope

### In scope

- New plugin: `plugins/buraco/` implementing the host's plugin contract.
- New shared library: `src/shared/cards/` with server-safe primitives and a
  client renderer.
- Migration: cribbage moves from `plugins/cribbage/{server/cards.js,client/card.js,client/hand.js,client/assets/cards/}` to consume the shared library.
- Tests at three levels: shared-library unit tests, Buraco engine unit + integration tests, publicView redaction tests.

### Out of scope (deferred, explicitly not part of this design)

- 4-player partnership Buraco. The platform is 2P-only by design (async pacing makes 3P+ unworkable).
- AI opponent / single-player mode.
- Spectator mode, in-game chat, replay, undo.
- Tournament scoring, alternate variants (Italian, Argentinian).
- Animations beyond the hooks cribbage already has.

## Constraints / context

- **Plugin contract** is unchanged: `id`, `displayName`, `players: 2`, `clientDir`, `initialState`, `applyAction`, `publicView`, optional `auxRoutes`. See `README.md`.
- **Game state** is a single JSON column in SQLite, written synchronously per better-sqlite3. No optimistic concurrency.
- **publicView** redacts opponent's hand, stock, and mortos to counts.
- **Existing precedent for shared libs:** `src/shared/dice/` builds via Vite to `public/shared/dice.js` (it's a 3D Three.js component — the build is necessary). For cards, plain ESM is sufficient and matches the rest of the plugin client code. No bundler.

## Variant: Buraco Brasileiro (2P)

| Aspect | Value |
|---|---|
| Decks | 2 standard 52-card decks |
| Jokers | 4 (2 red, 2 black) |
| Total cards | 108 |
| Hand size at deal | 11 each |
| Mortos | 2, one per player, 11 cards each |
| Stock | remaining (~75) |
| Discard | top of stock flipped to start |
| Melds allowed | sequences only (no groups) |
| Wilds | jokers + 2s (off-suit only — see "Wilds" below) |
| Sequence size | 3+ cards, ≤1 wild, same suit |
| Buraco | meld of ≥7 cards |
| Buraco limpo | ≥7 cards, no wild → +200 bonus |
| Buraco sujo | ≥7 cards, with wild → +100 bonus |
| Going-out | hand empty AND morto already taken AND ≥1 buraco on table |
| Going-out bonus | +100 |
| Morto-untaken penalty | –100 at deal end |
| Hand-card penalty | –1 per card left in hand at deal end |
| Game target | 3000 points (configurable, see Risks) |
| Aces | A-low (A-2-3) or A-high (Q-K-A); not wraparound |

### Wilds

A meld may contain at most one wild. Wilds are:

- **Any joker** — always wild.
- **A 2 of any suit other than the meld's suit** — wild when laid in another suit's sequence. The 2 of the meld's own suit is the natural "two" and is not wild within that sequence.

A wild laid in a meld carries `representsRank` and `representsSuit` annotations indicating the slot it fills. The annotation is set explicitly when laid (or inferred via `withInferredWilds` when context is unambiguous; see Validation).

A wild can be **replaced** mid-turn by an explicit `meld{op:'replaceWild'}` action: the player provides the natural card from their hand and the slot within an existing meld holding the wild. After the swap, the natural occupies the slot and the wild returns to the player's hand, free to be played elsewhere this turn or held.

## Architecture

```
src/shared/cards/                  ← NEW shared library
  deck.js                          server+client safe (no DOM imports)
                                   exports: RANKS, SUITS, buildDeck({decks, jokers}),
                                            shuffle(arr, rng), cardId, parseCardId,
                                            sameCard, isJoker, isNaturalTwo,
                                            withInferredWilds (generic shape)
  card-multiset.js                 multiset balance helpers (parallels rummikub's)
  card-element.js                  client only (DOM)
                                   exports: renderCard(card, opts), <playing-card>,
                                            cardImageUrl, backImageUrl
  style.css                        .card, .card--back, .card--joker, .card--wild,
                                   .card--selected
  assets/                          source-of-truth card art
    spades-A.jpg ... clubs-K.jpg   (52 face images — moved from cribbage)
    joker-red.jpg, joker-black.jpg (2 joker images — NEW)
    back_1.png ... back_4.png      (4 backs — moved from cribbage)
  __tests__/

public/shared/cards/               ← served to browser; copy of assets/
                                   (host already static-mounts /shared/*)

plugins/cribbage/                  ← MIGRATED to use shared lib
  client/card.js, client/hand.js   removed; usages re-import from shared lib
  client/assets/cards/             removed (now served from /shared/cards/)
  server/cards.js                  removed; usages re-import from shared deck.js
  (cribbage-specific: pipValue, runValue stay in plugin — not shared concepts)

plugins/buraco/                    ← NEW plugin
  plugin.js                        contract: id, displayName, players:2, ...
  server/
    state.js                       initial state (108-card stock, 11-card hands,
                                   two mortos, top of stock to discard)
    actions.js                     dispatcher
    phases/
      draw.js                      draw stock or take whole discard pile
      meld.js                      lay-down new meld / extend existing
      discard.js                   end-turn discard
      deal-end.js                  scoring when a hand goes empty (with morto check)
    scoring/
      meld-value.js                card-point sums per Brazilian Buraco values
      deal-end.js                  buraco bonuses, going-out, morto, hand penalty
    sequence.js                    isValidSequence, sequencePoints, isBuracoLimpo,
                                   isBuracoSujo, withInferredWilds (Buraco-flavored)
    validate-turn.js               full-turn diff validation (multiset balance,
                                   opp untouched, existing melds extended only)
    view.js                        publicView redaction
  client/
    app.js                         phase-aware top-level renderer + SSE listener
    hand.js                        renderMyHand with multi-select (Set<cardId>)
    melds.js                       renderMeldsZone(side, opts); extend-target picker
    table.js                       renderStockAndDiscard; draw/discard animations
    phase-banner.js                renderPhaseBanner — single source of "what now"
    action-bar.js                  phase-aware buttons; click → app.send()
    sequence-validator.js          client mirror of isValidSequence (live feedback;
                                   server is authoritative)
    style.css                      Buraco-specific zones, action bar, meld badges
    sounds/                        draw, meld, discard, buraco, going-out
    assets/                        Buraco-specific decoration
    index.html                     skeleton DOM
  __tests__/
    sequence.test.js               valid/invalid sequences, wild placement, A high/low
    inferred-wilds.test.js         single wild inferred; ambiguous returns input
    deal-end-scoring.test.js       all bonus + penalty combinations
    validate-turn.test.js          multiset balance, opp untouched, etc.
    integration.test.js            full deal end-to-end with seeded RNG
    match.test.js                  multi-deal match to 3000 with seeded RNG
    public-view.test.js            redaction for each phase from each side

src/plugins/index.js               adds buraco to the plugin registry
```

## Data shapes

### Card

```js
// Non-joker
{ id: 'S-A-0', rank: 'A', suit: 'S' }                  // unique by id alone

// Joker
{ id: 'jk-1', kind: 'joker', color: 'red' }

// Either, when laid as a wild in a meld:
{ id: 'jk-1', kind: 'joker', representsRank: '6', representsSuit: 'H' }
{ id: 'C-2-0', rank: '2', suit: 'C', representsRank: '6', representsSuit: 'H' }
```

`id` is opaque, stable, unique. Format `${suit}-${rank}-${deckIndex}` for naturals; `jk-${0..3}` for jokers. The deckIndex is encoded in the id and never used directly; equality is `a.id === b.id`.

Cribbage migrates trivially: every existing card gets an `id` of `${suit}-${rank}-0`.

### Meld (a sequence)

A meld is just `Card[]`, ordered low-to-high by the rank each card represents (with wilds taking on `representsRank`). No wrapper object, no slot bookkeeping. Same shape as Rummikub's set.

### Game state

```js
{
  phase: 'draw' | 'meld' | 'discard' | 'deal-end' | 'game-end',
  dealNumber: 1,                    // 1-indexed
  currentTurn: 'a' | 'b',
  hasDrawn: false,                  // current turn's draw step done?

  stock: Card[],                    // private (counts only in publicView)
  discard: Card[],                  // public; top is most recently discarded

  hands: { a: Card[], b: Card[] },  // private
  melds: { a: Card[][], b: Card[][] },  // public (each side's array of melds)

  mortos: { a: Card[], b: Card[] },          // private (counts only)
  mortoTaken: { a: false, b: false },         // public

  scores: {
    a: { total: 0, deals: [] },
    b: { total: 0, deals: [] },
  },

  lastEvent: null | {
    kind: 'draw'|'meld'|'extend'|'discard'|'takeMorto'|'deal-end',
    side: 'a'|'b',
    summary: string,
  },

  winner: null | 'a' | 'b',
}
```

### DealScore (entry in `scores[side].deals`)

```js
{
  buracoLimpo: number,    // count
  buracoSujo: number,     // count
  meldPoints: number,     // sum of card point values laid down this deal
  goingOutBonus: number,  // 100 if went out, else 0
  mortoBonus: number,     // -100 if morto not yet taken at deal end, else 0
  handPenalty: number,    // -1 × cards left in hand
  total: number,
}
```

### Action shapes

```js
// Draw — start of turn
{ type: 'draw', payload: { source: 'stock' | 'discard' } }

// Lay new meld
{ type: 'meld', payload: {
    op: 'create',
    cards: Card[],         // ≥3 cards forming a valid sequence
}}

// Extend an existing meld
{ type: 'meld', payload: {
    op: 'extend',
    meldIndex: number,     // index in melds[side]
    cards: Card[],         // appended at low or high end (engine decides which)
}}

// Replace a wild in one of your existing melds with the natural card from hand
{ type: 'meld', payload: {
    op: 'replaceWild',
    meldIndex: number,     // index in melds[side]
    slotIndex: number,     // index within that meld holding the wild
    withCard: Card,        // the natural card from hand to swap in
}}

// Discard — end of turn
{ type: 'discard', payload: { card: Card } }
```

`replaceWild` is an explicit action because the sequential per-action model has
no other action whose validation handles a mid-meld swap. After it runs: the
natural occupies the slot and the wild moves to the player's hand, where it can
be played elsewhere this turn or held. The end-of-turn multiset balance still
validates that no cards were invented or vanished.

Mortos are picked up automatically when a player's hand becomes empty. Going-out
is also automatic — if hand empty AND morto taken AND ≥1 buraco, the deal ends.

## Action flow / phase machine

```
deal-start → draw → meld* → discard → (opp turn) → ... → deal-end → next deal | game-end
```

| Current | Action | Result |
|---|---|---|
| `draw`, hasDrawn=false | `draw{stock}` | one card → hand, phase=`meld`, hasDrawn=true |
| `draw`, hasDrawn=false | `draw{discard}` | all discard cards → hand, phase=`meld`, hasDrawn=true |
| `meld` | `meld{create, cards}` | validate sequence, remove from hand, append to `melds[side]` |
| `meld` | `meld{extend, meldIndex, cards}` | validate extension, remove from hand, mutate meld |
| `meld` | `meld{replaceWild, meldIndex, slotIndex, withCard}` | swap natural in, return wild to hand |
| `meld` | `discard{card}` | remove from hand → top of `discard`, phase=`draw`, swap turn |
| `meld` | hand becomes empty mid-turn | auto morto pickup OR going-out |
| `discard` | hand empties on discard | auto going-out check |
| `deal-end` | (auto) | score, then `phase=draw, dealNumber++` for next deal, OR `phase=game-end` if any total ≥ 3000 |

### Validation per action

**Draw from discard:** discard non-empty; `hasDrawn=false`.

**Meld create:** ≥3 cards; all in hand; all same suit (wilds excepted); consecutive ranks; ≤1 wild; A-low or A-high not wraparound; wild's `representsRank`/`representsSuit` consistent with the slot it fills.

**Meld extend:** target meld exists at `meldIndex`; cards extend at low or high end; suit matches; ranks contiguous; ≤1 wild total in resulting meld.

**Meld replaceWild:** target meld at `meldIndex` exists; slot at `slotIndex` holds a wild; `withCard` is in hand; `withCard.rank` and `withCard.suit` match the slot's `representsRank` and `representsSuit`; resulting meld remains a valid sequence (it must, since rank+suit identity is preserved).

**Discard:** card in hand. Going-out check after removal: hand empty triggers either morto pickup (if `mortoTaken=false`) or going-out validation (requires ≥1 buraco). If neither holds, discard is rejected with an error.

### End-of-turn diff validation

After each action, in addition to the per-action checks, the engine runs a multiset balance assertion:

```
allCardIds(prev_state) === allCardIds(next_state)
```

across `stock + discard + hands + mortos + melds`. This is the integrity backstop: if a bug ever lets a card duplicate or vanish, the assertion fails immediately and loudly rather than corrupting game state silently. The check is cheap (108 ids, hash-set comparison).

A second assertion proves opponent's melds are bytewise unchanged after each action by the current player.

## UI / client structure

Vertical-stack layout, top-to-bottom:

```
header
opp hand (face-down row + count)
opp melds (horizontal block)
table center (stock pile · discard pile · morto status)
my melds (horizontal block, with limpo/sujo badges)
phase banner ("Your turn — draw a card")
my hand (sortable, multi-selectable)
action bar (phase-aware buttons)
```

Action bar contents by phase:

- `draw` (your turn): `[Draw stock] [Take discard]`
- `meld` (your turn): `[Lay meld] [Extend meld] [Discard…] [Done]` — Lay/Extend enabled only when selection is valid
- `meld` (opp's turn): "Waiting for {opp}…"
- `deal-end`: overlay with score breakdown + `[Continue]`
- `game-end`: overlay with final score + winner

### Selection model

Selection is a `Set<cardId>` in the client. Cleared on phase change.

- Idle: nothing selected
- Building: ≥1 card selected; live validation of candidate sequence; `[Lay meld]` enabled iff valid + ≥3 cards
- Wild placement: when a wild is selected and placement is ambiguous, an inline picker prompts for `representsRank`
- Extending: after `[Extend meld]`, your existing melds become click targets
- Discarding: `[Discard…]` enters single-tap-to-confirm mode

### Animations

Inherit cribbage's hooks: card-from-stock arc, card-flying-to-meld, discard-pile-pull (for taking the whole pile, ~600ms staggered). Add a "buraco" celebration (gold glow + sound) when a meld first reaches 7 cards.

### Mobile

Vertical stack already mobile-friendly. Adjustments:

- Card scale 30×44 px under 600px viewport (vs 36×52 desktop)
- Long melds wrap within their meld block; cards overlap by `-12px`
- Hand uses horizontal scroll; "sort by suit/rank" toggle for the hand row
- Action bar sticky to viewport bottom

## Testing strategy

### Shared cards library (`src/shared/cards/__tests__/`)

- `buildDeck({decks:1, jokers:0})` → 52 unique-id cards, full RANKS×SUITS coverage
- `buildDeck({decks:2, jokers:4})` → 108 unique ids, two of each non-joker, four jokers (2 red + 2 black)
- `cardId` round-trip via `parseCardId`
- `shuffle(deck, seededRng)` deterministic for same seed
- `withInferredWilds` (generic shape, parameterized by what "consecutive" means — Buraco passes "ranks")

### Buraco unit tests (`plugins/buraco/__tests__/`)

- `isValidSequence` — valid runs, mixed-suit reject, gap reject, wraparound A reject, single-wild ok, double-wild reject, A-low and A-high cases
- `withInferredWilds` for cards — single wild inferred, ambiguous returns input, annotated wild preserved
- `sequencePoints`, `isBuracoLimpo`, `isBuracoSujo`
- `validateTurn` — multiset balance, opp melds untouched, existing melds extended only, discard delta correct, stock delta correct
- `dealEndScoring` — every combination of (buraco-or-not, went-out-or-not, morto-taken-or-not, hand-cards-remaining)

### Integration tests

- `integration.test.js` — full deal end-to-end with seeded RNG; assert card-conservation invariant at every step; assert phase transitions exact; assert deal-end scores match expected breakdown
- `match.test.js` — multi-deal match with seeded RNG until a side passes 3000; exercises deal-rollover

### publicView redaction tests

For each phase, snapshot `publicView(state, 'a')` and `publicView(state, 'b')`:

- Opponent hand → count
- Stock → count
- Mortos → count (regardless of taken status)
- Melds, scores, top-of-discard, phase, currentTurn → present and identical to authoritative state

## Migration plan

1. **Stand up `src/shared/cards/`** with `deck.js`, `card-element.js`, `card-multiset.js`, `style.css`, and `__tests__/`. Tests pass standalone.
2. **Move card art** from `plugins/cribbage/client/assets/cards/` to `src/shared/cards/assets/` and copy to `public/shared/cards/`. (Add joker images.)
3. **Refactor cribbage to consume shared lib.** Delete `plugins/cribbage/server/cards.js` and `plugins/cribbage/client/{card.js,hand.js}`. Update imports in cribbage's remaining files. Add `id` to every card produced by cribbage's deck builder (now `buildDeck({decks:1, jokers:0})`).
4. **Verify cribbage's existing tests still pass** with no test-file changes. If a test breaks due to the `id` field addition, that's the right kind of breakage — fix it before merging.
5. **Add Buraco plugin** on top of the shared lib. Build engine + tests bottom-up: shapes → predicates → phase handlers → integration → client.

Each step is one or more commits. Each step builds. Each step's tests pass before the next begins.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Wild-card edge cases (off-suit-2 vs joker, ambiguous placement) ship broken | High | Test-first with a long table of cases lifted from rummikub's `withInferredJokers` patterns. Cover off-suit-2 specifically. |
| Cribbage migration silently changes a card-identity check | Medium | Add an assertion to cribbage's existing integration test that every dealt card has an `id`. Run before/after migration, diff results. |
| Hand UI for 14+ cards (post-morto) unreadable on mobile | Medium | Horizontal scroll in hand row + "sort by suit/rank" toggle in v1. |
| "Take whole discard pile" surprises player by collapsing 8 cards into hand | Low | Stagger animation: cards arc into hand one-at-a-time over ~600ms. |
| Score-to-3000 takes too long for async play → defeats Sonia's enjoyment | Medium | Hard-code 3000 in v1 (matches Brazilian convention). If real play shows it's too long, a follow-up story plumbs a `scoreTarget` through `initialState` (host contract change) so games can be created with 1500 or single-deal. Not building that infrastructure speculatively. |
| Diff-based turn validation rejects a legitimate move because of unexpected mutation order | Medium | Per-action validation catches most things up front. End-of-turn diff is the integrity backstop, not the primary feedback path. Errors include the specific delta that failed. |
| Shared lib gets coupled to cribbage's specific assumptions | Low | Shared lib has its own tests, independent of any plugin. Cribbage and Buraco both import; neither is privileged. |

## Decisions deferred

These were considered and explicitly punted:

- **Generalized hand component in the shared lib** — sample size 1 (cribbage). Wait until two real implementations (Buraco + cribbage) exist, then evaluate.
- **Single "submit end-state diff" action shape** (rummikub-style mega-action vs sequential draw/meld/discard) — went with sequential because Buraco's flow is naturally sequential and the SSE-driven UI benefits from per-step state updates. The diff validation is a backstop, not the action protocol.
- **Card asset theming per game** — using one shared deck of art for all card games. If Buraco wants Brazilian-flavored card backs later, that's an additive change (back\_5.png, etc.).
- **Vite-built shared lib** — plain ESM for now. If a future shared component needs a build step, add Vite at that time.

## References

- Cribbage plugin (precedent): `plugins/cribbage/`
- Rummikub plugin (precedent for melds): `plugins/rummikub/server/{sets.js,validate.js,multiset.js,tiles.js}`
- Existing shared lib (precedent): `src/shared/dice/` — uses Vite (because Three.js); cards will not
- Plugin contract: `README.md` "Plugin contract" section
