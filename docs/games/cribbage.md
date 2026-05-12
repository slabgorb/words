# Cribbage

> Two-player 6-card cribbage. Peg toward 121 across a sequence of deals: discard to the crib, count fifteens and pairs in the pegging, then count the hands in the show.

| | |
|---|---|
| Plugin id | `cribbage` |
| Players | 2 |
| Variant | Standard 6-card, 121-point match |
| Win condition | First to 121 points |
| Plugin dir | `plugins/cribbage/` |

## Lineage

Standard two-player cribbage as described by [pagat.com — Six-Card Cribbage](https://www.pagat.com/adders/crib6.html), with the 121-point match length (twice around a traditional British board).

## Components

- Single standard 52-card deck.
- Score board with two pegs per player (the *front peg* is the current score; the *rear peg* is the previous score, preserving the slide on each scoring event).

## Setup

1. Shuffle a 52-card deck.
2. Coin flip selects the opening dealer (digital substitute for "low card cuts").
3. Deal 6 cards to each player. The remaining 40 cards form the stock.

## Phase sequence

A deal proceeds through four phases. The state machine names them in `state.phase`:

| Phase | What happens |
|---|---|
| `discard` | Each player selects 2 cards face-down for the dealer's crib. |
| `cut` | Non-dealer cuts the stock; the top card of the lower portion is turned face-up as the **starter**. If the starter is a Jack, the dealer pegs **2 for his heels**. |
| `pegging` | Alternating play of cards, running total capped at 31. (See below.) |
| `show` | Hands are counted: non-dealer's hand → dealer's hand → dealer's crib. Then the next deal begins (dealer rotates). |

## Card values

- **Pip value** (for fifteens and the pegging running total): A = 1; 2–10 = face value; J, Q, K = 10.
- **Run value** (for runs): A = 1, …, J = 11, Q = 12, K = 13. Ace is always low; there is no wrap.

## Pegging

Non-dealer leads. Players alternate playing one card at a time, announcing the running total. The total may not exceed 31.

| Event | Points |
|---|---|
| Running total = 15 | 2 |
| Running total = 31 | 2 |
| Pair (matching the previous card's rank) | 2 |
| Pair royal (three in a row, same rank) | 6 |
| Double pair royal (four in a row, same rank) | 12 |
| Run of N consecutive ranks (any order, no duplicates, length ≥ 3) | N |
| Last card (no one can play, running total < 31) | 1 (the *go*) |

Runs during pegging count by the **longest tail** of distinct, consecutive ranks ending in the just-played card.

## The show

After pegging, both players retrieve their original 4-card hands and count them with the starter card. **The starter is part of every hand and the crib.** Order: non-dealer, then dealer, then crib.

| Category | Points | Notes |
|---|---|---|
| Fifteen | 2 | For every distinct combination of cards summing to 15 (pip values). |
| Pair | 2 | Two of the same rank. |
| Pair royal | 6 | Three of the same rank. |
| Double pair royal | 12 | Four of the same rank. |
| Run | length | Three or more consecutive ranks. Multiplicity multiplies (e.g. `6-7-7-8` = two runs of 3, scoring 6). |
| Flush (hand) | 4 | All four hand cards same suit. |
| Flush (hand, 5 cards) | 5 | All four hand cards plus the starter same suit. |
| Flush (crib) | 5 | All five cards (4 crib + starter) same suit. **A 4-card crib flush does not score.** |
| His nobs | 1 | A Jack in hand of the same suit as the starter. |

## Match end

- Scores are capped at the match target (121); a player can never overshoot.
- If a player reaches the target during pegging or during the show, **counting halts immediately** — later categories don't apply once someone has pegged out.
- His heels (cut a Jack as starter for 2) can end the match even before pegging begins.

The next deal rotates the dealer.

## Implementation

### Files

| File | Responsibility |
|---|---|
| `plugin.js` | Plugin contract. |
| `server/state.js` | Initial state, deal/redeal, score mutation, match-win check, dealer rotation. |
| `server/values.js` | Pip and run value tables. |
| `server/phases/discard.js` | Phase: choose 2 cards for crib. |
| `server/phases/cut.js` | Phase: cut starter, pay his-heels. |
| `server/phases/pegging.js` | Phase: 31-limited play, go, score on each play. |
| `server/phases/show.js` | Phase: count hands and crib in tournament order. |
| `server/scoring/pegging.js` | Score a single pegging play (15, 31, pair group, run tail). |
| `server/scoring/hand.js` | Score a complete hand or crib (fifteens, pairs, runs with multiplicity, flush, nobs). |
| `server/actions.js` | Dispatches actions per phase. |
| `server/view.js` | Per-viewer state redaction (hide opponent hand, hide crib until show). |
| `server/ai/` | AI player for solo / bot opponents. |

### Action types

Action types are phase-gated; the dispatcher routes by `state.phase`.

| Action | Phase | Effect |
|---|---|---|
| `discard` | `discard` | Send selected cards to the crib. |
| `cut` | `cut` | Cut the stock to reveal the starter. |
| `play` | `pegging` | Play one card; running total + pegging score updated. |
| `pass-go` | `pegging` | Declare "go" when no legal card is available. |
| `acknowledge` | `show` | Confirm the show breakdown; transitions to next deal. |
| `resign` | any | Current player concedes. |

### State shape

| Key | Description |
|---|---|
| `matchTarget` | 121 by default. |
| `dealNumber` | Increments each new deal. |
| `phase` | `'discard' \| 'cut' \| 'pegging' \| 'show' \| 'match-end'`. |
| `dealer` | `0` or `1` — player index. |
| `deck` | Stock after deal. |
| `hands` | `[ [...], [...] ]` — each player's hand (4 cards after discard). |
| `pendingDiscards` | Holds discards during the `discard` phase. |
| `crib` | 4 cards (revealed in show). |
| `starter` | Starter card (after cut). |
| `pegging` | Per-play state: pile, running total, next-to-play, etc. |
| `scores` | `[a, b]`. |
| `prevScores` | Pre-event scores — drives the back-peg position in the UI. |
| `showBreakdown` | Tallied items per scoring event during the show. |
| `acknowledged` | `[a, b]` — both players ack the show before the next deal. |
| `sides`, `activeUserId` | Side-to-userId map + whose turn. |
| `endedReason`, `winnerSide` | Set when the match ends. |

No aux routes.

## Alignment notes

- **Opener selection** — coin flip rather than "low card cuts." Same effect.
- **Score cap** — scores cap at `matchTarget`; pegs cannot overshoot, matching the "peg out" tradition.
- **Halt on win** — show points stop accumulating the moment a player reaches the target, faithful to the tournament order.
- **Skunks** — not implemented as a game-end multiplier; the match is win/loss.
