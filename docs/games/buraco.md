# Buraco

> Buraco Brasileiro — Brazilian-rules rummy. Build sequences (no sets), build a *buraco* (≥7 cards), pick up the *morto* (extra hand) before going out. Match to 3000.

| | |
|---|---|
| Plugin id | `buraco` |
| Players | 2 |
| Variant | Buraco Brasileiro (Brazilian rules), 2-player |
| Match target | 3000 points |
| Plugin dir | `plugins/buraco/` |

## Lineage

Two-player Brazilian-rules Buraco, derived from the partnership game described at [pagat.com — Buraco](https://www.pagat.com/rummy/buraco.html). Two-player conventions: each player owns their own morto pile (rather than each team).

## Components

- **108-card deck** — 2 standard 52-card packs (104) + 4 jokers.
- 2 hands of 11 cards.
- 2 *mortos*, one per player, of 11 cards each.
- A discard pile (face-up) and a stock pile (face-down).

## Setup

1. Shuffle the full 108-card deck.
2. Deal 11 cards to each player's hand.
3. Deal 2 separate piles of 11 cards as the **mortos** (one per side).
4. Flip the next card to start the discard pile.
5. Remaining cards form the stock.

Side `a` opens.

## Card values

| Cards | Points |
|---|---|
| Joker | 20 |
| 2 (any suit) | 20 |
| Ace | 15 |
| 8, 9, 10, J, Q, K | 10 |
| 3, 4, 5, 6, 7 | 5 |

## Wild cards

- **Jokers** are always wild.
- A **2** is wild *unless* it is the natural 2 of the sequence's suit — i.e. the off-suit 2s are wild; the in-suit 2 is natural.
- A sequence may contain **at most one** wild card.
- At least one natural card is required for the suit to be determined.

## Sequences

A meld is a **sequence** (no sets of equal rank):

- 3 or more cards of the **same suit** in consecutive rank order.
- Ace plays low (`A-2-3`) or high (`Q-K-A`); the engine tries both.
- Maximum length 14 (A-2-3-…-K-A).

### Buraco

A sequence of **7 or more** cards is a *buraco*:

| Kind | Meaning |
|---|---|
| **Limpo** (clean) | No wild cards. |
| **Sujo** (dirty) | Contains a wild card. |

## Turn structure

A turn is **draw → meld → discard**, gated by `state.phase`:

| Phase | What happens |
|---|---|
| `draw` | Take the top of the stock, **or** take the entire discard pile. |
| `meld` | Optionally: create new sequences, extend existing ones, or replace a wild card with the natural card it represents (and replay the wild elsewhere). |
| `discard` | Place one card face-up onto the discard pile; turn passes. |
| `deal-end` | Triggered automatically; scores this deal and either starts the next deal or ends the match. |

### Taking the morto

When a player plays the last card from their hand:

- If their morto has **not** been taken, they pick up their morto and continue the turn (or end it, depending on how they emptied).
- If their morto **has** been taken, going out is checked (see below).

### Stock exhaustion

If the stock empties on a draw, the deal ends immediately and is scored.

## Going out

A player ends the deal by emptying their hand **after** taking their morto. The deal's scoring is then settled and either the next deal begins or the match ends.

## Scoring a deal

Per side:

| Item | Value |
|---|---|
| Card points in melds | sum of point values |
| Each *buraco limpo* | + 200 |
| Each *buraco sujo* | + 100 |
| Going out | + 100 |
| Morto not taken | − 100 |
| Cards left in hand | − 1 each (penalty count) |

The deal totals are added to each side's running match score; deals are recorded in `scores[side].deals` for review.

## Match end

The match ends when either side's running total reaches or exceeds **3000**. The side with the higher total wins; on a tie the side that went out in the final deal wins.

Otherwise a new deal begins: dealer and starter rotate, hands and mortos are re-dealt, and play resumes.

## Implementation

### Files

| File | Responsibility |
|---|---|
| `plugin.js` | Plugin contract. |
| `server/state.js` | Initial state, deal, morto setup. |
| `server/sequence.js` | Sequence validity, point computation, *limpo*/*sujo* classification, wild rules. |
| `server/validate-turn.js` | Turn-end and meld-shape validation. |
| `server/phases/draw.js` | Draw from stock or take the discard pile. |
| `server/phases/meld.js` | Create / extend / replace-wild operations. |
| `server/phases/discard.js` | Place a card on the discard pile, advance turn. |
| `server/phases/deal-end.js` | Score the deal; start next deal or end match. |
| `server/scoring/deal-end.js` | Per-deal point computation (see scoring table). |
| `server/scoring/meld-value.js` | Per-meld point math. |
| `server/actions.js` | Dispatches `draw`, `meld`, `discard` by phase + sub-op. |
| `server/view.js` | Per-viewer state redaction. |

Card primitives (deck construction, joker predicate, rank table) are shared with cribbage via `src/shared/cards/`.

### Action types

| Action | Payload | Effect |
|---|---|---|
| `draw` | `{ source: 'stock' \| 'discard' }` | Draw one from stock, or take the whole discard pile. |
| `meld` | `{ op: 'create' \| 'extend' \| 'replaceWild', ... }` | Lay down or modify a sequence. |
| `discard` | `{ card }` | Place a card on the discard pile; turn ends. |

### State shape

| Key | Description |
|---|---|
| `phase` | `'draw' \| 'meld' \| 'discard' \| 'deal-end' \| 'game-end'`. |
| `dealNumber` | Increments per deal. |
| `currentTurn` | `'a'` or `'b'`. |
| `hasDrawn` | True between `draw` and `discard`. |
| `stock`, `discard` | The two piles. |
| `hands` | `{ a, b }` — current hands. |
| `melds` | `{ a, b }` — each side's tabled sequences. |
| `mortos`, `mortoTaken` | The two mortos + flags. |
| `scores` | `{ a: { total, deals[] }, b: { total, deals[] } }`. |
| `sides`, `lastEvent`, `winner` | Side map, event for UI, match winner. |

No aux routes.

## Alignment notes

- **Two-player adaptation** — the canonical game is 4-player partnership. Two-player rules give each side its own morto rather than splitting one between teammates. The 11-card hand, 11-card morto, and 3000-point match target are preserved.
- **Discard pile pickup** — Brazilian rules: take **the entire** discard pile. Some Italian variants pick up only one card; this engine implements the Brazilian convention.
- **One wild per sequence** — the engine enforces a maximum of one wild card in any sequence.
- **Stock exhaustion** — ends the deal (Brazilian rule).
