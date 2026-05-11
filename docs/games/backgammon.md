# Backgammon

> Standard backgammon. Roll dice, race 15 checkers off the board, double the stakes when you're winning.

| | |
|---|---|
| Plugin id | `backgammon` |
| Players | 2 |
| Variant | Standard match play with doubling cube and Crawford rule |
| Default match | First to 3 points (configurable) |
| Plugin dir | `plugins/backgammon/` |

## Lineage

Implements the canonical Backgammon rules as published at [bkgm.com — Rules of Backgammon](https://www.bkgm.com/rules.html), with the **Crawford rule** for match play (see "Match play" below). The doubling cube is enabled and capped at 64.

## Components

- A 24-point board indexed `0..23`. Side **A** moves toward higher indices (home board: 18–23). Side **B** moves toward lower indices (home board: 0–5).
- 15 checkers per side.
- Two six-sided dice.
- One doubling cube (faces 2, 4, 8, 16, 32, 64).
- The **bar** (one per side) and the **off** (born-off pile per side).

## Starting position

| Point (A's frame) | Checkers |
|---|---|
| 24-point (idx 0) | 2 of A |
| 13-point (idx 11) | 5 of A |
| 8-point  (idx 16) | 3 of A |
| 6-point  (idx 18) | 5 of A |

B mirrors: indices 23, 12, 7, 5 with 2, 5, 3, 5 checkers respectively. Total 15 per side.

## Phase model

A leg cycles through these phases (`state.turn.phase`):

| Phase | Meaning |
|---|---|
| `initial-roll` | Each side rolls one die to determine who plays first and with what numbers. Re-roll on ties. |
| `pre-roll` | Active player has the turn but hasn't rolled yet. May offer a double here. |
| `moving` | Active player has rolled and is executing their moves. |
| `awaiting-double-response` | Offerer has doubled; opponent must accept or decline. |

## Turn structure

1. **Opening leg:** both sides roll-initial; the higher die wins, and the winner moves using both dice (their own and the opponent's).
2. **Subsequent legs:** the active player may offer a double in `pre-roll` (cube ownership permitting); otherwise rolls.
3. After rolling, both numbers must be played if any legal sequence exists. Doubles play four of the rolled number. If only one number can be played, the player must play that one.
4. A move from point `p` by `n` lands on `p ± n`. The destination must be **open** — not occupied by two or more opposing checkers.
5. **Hits:** landing on a single opposing checker (a *blot*) sends it to the bar.
6. **Bar re-entry:** while you have checkers on the bar, you must enter them in the opponent's home board before making any other move.
7. **Bear-off:** once all 15 of your checkers are in your home board, a roll matching point `p` bears the checker off. Higher rolls bear off from the highest occupied point when no exact match remains.

## Doubling cube

The cube starts at value 1, unowned. A player may offer a double only at the start of their own turn, before rolling, and only if:

- there is no pending offer,
- the cube has not yet reached 64,
- it is **not** the Crawford leg, and
- the cube is unowned **or** owned by the offerer.

The opponent either:

- **accepts** — cube doubles, opponent becomes owner; or
- **declines** — concedes the leg, paying the pre-double cube value.

The doubling cube caps at **64**. Beavers are not implemented.

### Crawford rule

Once either player first reaches `target − 1` points, the **next leg only** is a Crawford leg: doubling is forbidden. After Crawford, normal doubling resumes for the rest of the match (post-Crawford).

## Leg end and scoring

A leg ends when one side bears off all 15 checkers. Stake = `cubeValue × multiplier`:

| Outcome | Multiplier |
|---|---|
| Single | × 1 (loser bore off at least one checker) |
| Gammon | × 2 (loser bore off zero checkers, has none on bar or in winner's home) |
| Backgammon | × 3 (loser bore off zero **and** has a checker on the bar or in the winner's home board) |

After a leg, the board, cube, and turn reset; the match score, game number, and Crawford state advance.

## Match play

The match runs until either side's match score `≥ target`. Default target is **3** points; configurable via `options.matchLength` at game creation.

## Implementation

### Files

| File | Responsibility |
|---|---|
| `plugin.js` | Plugin contract. |
| `server/constants.js` | Board size, home indices, phases, cube cap, side helpers. |
| `server/state.js` | Initial state, participant validation, match config. |
| `server/board.js` | Starting position, point/bar/off mutators, hit detection. |
| `server/validate.js` | Move-legality enumeration, including must-play-both-dice. |
| `server/cube.js` | Offer/accept/decline transitions; Crawford and ownership gates. |
| `server/match.js` | Leg classification (single/gammon/backgammon), resolve-leg, Crawford transition, match-end check. |
| `server/actions.js` | Dispatches all turn actions; mirrors `activePlayer` to `activeUserId` for the host turn gate. |
| `server/view.js` | Public state redaction. |

### Action types

| Action | Phase | Effect |
|---|---|---|
| `roll-initial` | `initial-roll` | Each side rolls one die; ties re-roll. |
| `roll` | `pre-roll` | Roll two dice, transition to `moving`. |
| `move` | `moving` | Apply one die's worth of movement: point→point, bar entry, or bear-off. |
| `pass-turn` | `moving` | Confirm end-of-turn when no further legal move exists. |
| `offer-double` | `pre-roll` | Offer the cube. |
| `accept-double` | `awaiting-double-response` | Accept; cube doubles, ownership transfers. |
| `decline-double` | `awaiting-double-response` | Decline; concede the leg at the pre-double cube value. |
| `resign` | any | Concede the current leg. |

### State shape

| Key | Description |
|---|---|
| `sides` | `{ a, b }` — userId per side. |
| `match` | `{ target, scoreA, scoreB, gameNumber, crawford, crawfordPlayed }`. |
| `cube` | `{ value, owner, pendingOffer }`. |
| `board` | `{ points: [...24], barA, barB, bornOffA, bornOffB }`. |
| `turn` | `{ activePlayer, phase, dice }`. |
| `legHistory` | One entry per completed leg: `{ gameNumber, winner, points, type, cube }`. |
| `initialRoll` | Per-side opening die plus throw parameters (for fair-roll auditing). |

No aux routes.

## Alignment notes

- **Default match length is 3** — chosen for short sessions; canonical "match" length varies (5, 7, 9, …). Configurable.
- **Cube cap = 64** — the standard cube face limit.
- **Beavers / Raccoons** — not implemented.
- **Jacoby rule** — not implemented; gammons and backgammons always count, with or without the cube turned.
- **Move enumeration** — `validate.js` exhaustively enumerates legal full-turn move sequences to enforce the must-play-both-dice rule and the must-play-the-higher-die rule when only one die is usable.

## AI players

A Claude-CLI-driven bot opponent is available, using the shared AI
infrastructure under `src/server/ai/` and a per-game adapter at
`plugins/backgammon/server/ai/`.

### Adapter files

| File | Responsibility |
|---|---|
| `legal-moves.js` | Enumerate legal moves per phase. In the `moving` phase, returns one menu item per full-turn sequence; each item carries a `sequenceTail` of remaining move actions. |
| `prompts.js` | Render the board (ASCII, from the bot's perspective), pip counts, cube state; build the per-phase turn prompt; parse the LLM JSON response. |
| `backgammon-player.js` | `chooseAction({ llm, persona, sessionId, state, botPlayerIdx })` — returns `{ action, banter, sessionId, sequenceTail }`. |

### Auto-actions

The orchestrator auto-executes `initial-roll` without an LLM call (no
decision, no banter). All other phases call the LLM.

### Pending-sequence cache

A full-turn move sequence in backgammon is 2–4 `move` actions. The
adapter returns the first action plus a `sequenceTail`. The orchestrator
applies the first action, persists the tail in
`ai_sessions.pending_sequence` (JSON), and consumes one entry per
subsequent wake-up — no LLM call for the follow-up moves.

The cache is cleared on stall, on phase change away from `moving`, and
after the last move drains.

### Personas

Backgammon personas live in `data/ai-personas/` with a
`games: [backgammon]` scope. Initial roster:

| id | flavor |
|---|---|
| `colonel-pip` | Retired British army officer, conservative cube, tidy positions. |
| `aunt-irene` | Sun-porch grandmother, generous doubler, won't gloat. |
| `the-shark` | Brooklyn tournament veteran, aggressive cube, terse. |

The lobby's persona picker filters by game via
`GET /api/ai/personas?game=backgammon`.

### Limitations

- The bot reasons over a rendered board and a pip count, not an equity
  table. It is a flavor opponent, not a competitive engine.
- Move menus on doubles rolls can be large (50–100+ sequences). No
  pre-pruning is applied.
