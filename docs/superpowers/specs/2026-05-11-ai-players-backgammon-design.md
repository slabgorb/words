# AI Players — Backgammon

Status: design approved 2026-05-11. Predecessor: `2026-05-10-ai-players-cribbage-design.md`.

## Goal

Add a Claude-CLI-driven bot opponent to the Backgammon plugin, matching the architecture established by the Cribbage AI. Bots are flavor opponents, not competitive engines. They make full-turn checker moves, handle the doubling cube, and banter in persona voice.

## Non-goals

- Strong play. No equity tables, no neural net, no gnubg integration. The LLM reasons over a rendered board and a pip count.
- New SSE events, new bot-user model, new stall semantics. All inherited from the cribbage adapter.
- Cross-game persona compatibility. Personas declare which games they belong to.

## Architecture

Mirror the cribbage adapter. Shared infrastructure under `src/server/ai/` stays as-is except for two small additions; everything backgammon-specific lives under `plugins/backgammon/server/ai/`.

```
plugins/backgammon/server/ai/
  backgammon-player.js   chooseAction({llm, persona, sessionId, state, botPlayerIdx})
  legal-moves.js         enumerateLegalMoves(state, botPlayerIdx)
  prompts.js             buildTurnPrompt(...) + parseLlmResponse(text)
```

The orchestrator dispatches on `game.game_type` to find the adapter. One adapter entry registered in `src/server/ai/index.js`.

## Legal-move enumeration by phase

Backgammon exposes four bot-visible phases. Each returns a list of `{id, action, summary}`.

### `initial-roll`
Single mechanical option. Bot will not call the LLM for this phase (see Auto-actions below).

```
[{ id: 'roll-initial', action: { type: 'roll-initial' }, summary: 'Roll opening die' }]
```

### `pre-roll`
Always includes `roll`. Includes `offer-double` iff cube rules allow it: cube unowned or owned by bot, value < 64, no pending offer, not Crawford leg.

```
[
  { id: 'roll',           action: { type: 'roll' },          summary: 'Roll the dice' },
  { id: 'offer-double:N', action: { type: 'offer-double' }, summary: 'Offer to double the cube from N/2 to N' }  // if allowed
]
```

### `moving`
Drive the existing `validate.js` enumeration to list every legal full-turn sequence. Each sequence becomes a single menu item; the orchestrator caches the chosen sequence and consumes one `move` action per wake-up (see Pending sequence cache).

```
[
  { id: 'seq:1', action: { type: 'move', payload: <first move> }, summary: 'Bar→20, 13/8 (hits)' },
  { id: 'seq:2', action: { type: 'move', payload: <first move> }, summary: 'Bar→20, 24/19' },
  ...
]
```

When no legal sequence exists, return:

```
[{ id: 'pass-turn', action: { type: 'pass-turn' }, summary: 'No legal moves — pass the turn' }]
```

**Summary format.** Standard backgammon notation: `from/to`, with `bar`/`off` as endpoints, an asterisk after a hit (`13/8*`), and space-separated moves within a sequence. Mirror the format `validate.js` already produces if it produces one; otherwise compute from the sequence.

**Practical cap.** Some rolls produce 100+ sequences. No truncation — the LLM gets the full list. If menu size becomes a real problem (cost or context), we can revisit with a cheap pre-pruner; not in scope.

### `awaiting-double-response`

```
[
  { id: 'accept-double',  action: { type: 'accept-double' },  summary: 'Accept; cube to N, you own it' },
  { id: 'decline-double', action: { type: 'decline-double' }, summary: 'Decline; concede leg at cube=N/2' }
]
```

## Prompt design

`buildTurnPrompt` assembles four blocks: header, board, phase-specific, legal-moves, response footer.

### Header (every phase)

```
You are playing side A (moving toward higher-indexed points).
Match: 1–2 (target 3). Cube: 2, owned by you. Crawford: not yet.

Pip count — you: 142, opponent: 167  (you lead by 25)
```

### Board

ASCII rendering, two rows of twelve points with a vertical bar dividing the home/outer boards. Empty points show as `·`. Bot's checkers shown as `O`, opponent's as `X`, with a count suffix. Bar and off counts shown outside the grid.

```
13 14 15 16 17 18 | 19 20 21 22 23 24
 ·  ·  ·  X3 ·  X5|  ·  ·  ·  ·  ·  O2     bar: you=0  opp=1
                  |
 O5 ·  ·  ·  X3 · | O5 ·  ·  ·  ·  X2     off: you=0  opp=0
12 11 10  9  8  7 |  6  5  4  3  2  1
```

The orientation is fixed: bot's home is bottom-right regardless of which side the bot plays. We flip indices in rendering when bot is side B, so the LLM always reasons in a consistent frame. Index labels reflect the bot's-perspective numbering (24-point being its furthest point).

### Phase-specific block

| Phase | Contents |
|---|---|
| `initial-roll` | (not used — auto-executed) |
| `pre-roll` | `Dice: not yet rolled.` Cube status: owner, value, can-offer flag, why-not if blocked. Repeats pip-count one-liner. |
| `moving` | `Dice: 5 and 3` (or `Dice: 4-4 (doubles, four moves)`); bar status if any of bot's checkers are on the bar; must-play-both notice if relevant. |
| `awaiting-double-response` | Who offered, current cube → new cube, "if you decline you pay N points." |

### Response footer

Identical contract to cribbage:

```
Respond with a single JSON object (and nothing else):
{"moveId": "<one of the legal move ids above>", "banter": "<short in-character line, may be empty>"}
```

### Parsing

`parseLlmResponse(text)` accepts a fenced JSON block (`” ```json ... ``` ”`) or a bare object. Throws on missing `moveId` or non-string `banter`. Same error classes as cribbage (`InvalidLlmResponse`, `InvalidLlmMove`).

## Persona scoping

Existing personas embed cribbage-specific flavor in their system prompts. Without filtering they would appear in the backgammon persona picker.

**Persona YAML gets an optional `games:` array.**

```yaml
id: hattie
displayName: Hattie
games: [cribbage]      # omit/empty = available to every game
systemPrompt: |
  ...
```

`persona-catalog.js` reads the field, defaults to `[]`. `/api/ai/personas` accepts an optional `?game=<id>` query param. Filter rule: `persona.games.length === 0 || persona.games.includes(game)`. The lobby's persona fetch passes `gameType` through.

Backfill existing personas: `hattie.yaml`, `mr-snake.yaml`, `professor-doofi.yaml` each get `games: [cribbage]`.

**Three new backgammon personas** under `data/ai-personas/`:

| id | flavor |
|---|---|
| `colonel-pip` | Retired British army officer, obsessed with pip counts, conservative on the cube. |
| `aunt-irene` | Seaside-resort grandmother, plays for fun, generous doubler, won't gloat. |
| `the-shark` | Tournament veteran from a Brooklyn club, aggressive cube, terse banter. |

Each system prompt includes the same secrecy clause cribbage personas have, adapted: "never reveal the roll you hope for next, never telegraph your cube plans, complain about the weather instead."

## Orchestrator changes

### Auto-actions

A small per-game map of `phase → action factory`. When the orchestrator finds the bot is active and the current phase has an auto-action, it applies the action directly (same DB+SSE path as the LLM branch, no `bot_thinking`/`banter` broadcast) and recurses.

```js
const autoActions = {
  backgammon: {
    'initial-roll': () => ({ type: 'roll-initial' }),
  },
};
```

This saves one Claude call per leg on a one-option menu. Banter resumes at `pre-roll`.

### Pending-sequence cache

A full-turn `moving` sequence is up to four `move` actions. The engine applies one move per action, so the bot needs to act multiple times in succession. Rather than recursing four-deep or re-prompting the LLM after each move, we cache the sequence on the AI session.

**Schema.** Add a nullable TEXT column to `ai_sessions`:

```sql
ALTER TABLE ai_sessions ADD COLUMN pending_sequence TEXT;
```

**Flow.**

1. In `moving`, the bot picks `seq:N`. The adapter returns `{ action: <first move>, banter, sequenceTail: [<second>, <third>, ...] }`.
2. Orchestrator applies the first move, then writes `JSON.stringify(sequenceTail)` to `pending_sequence`.
3. On the next bot wake-up: if `pending_sequence` is non-empty, pop the head, apply it, write the rest back. No LLM call, no `bot_thinking`/`banter` broadcasts.
4. Cleared on stall, on phase change away from `moving`, and after the last move.

`agent-session.js` gains two helpers (`setPendingSequence`, `clearPendingSequence`) and updates `rowToSession` to expose the column.

### Recursion depth

The recursion cap in `_runOnce` stays at one extra hop after the initial action (`depth < 2`). The pending-sequence cache means each follow-up `move` is its own wake-up, not a recursion — depth doesn't need to grow with sequence length.

## Spec-authority and edge cases

- **Bar entry forced first.** Already enforced by `validate.js`; the legal-moves block trusts that enumeration.
- **Must play the higher die when only one is usable.** Already enforced by `validate.js`.
- **Resign action.** Not exposed to the bot. If we ever want it, add it as a fifth phase-spanning menu item.
- **Match-end (`status === 'ended'`).** Orchestrator no-ops, same as cribbage.
- **Cube cap at 64.** Enforced by `legal-moves.js` not offering `offer-double:128`.

## Testing

Unit:

| File | Subject |
|---|---|
| `test/ai-backgammon-legal-moves.spec.js` | one suite per phase; pre-roll Crawford gating; pre-roll cube-owned-by-opponent gating; moving with hits/bar/bear-off; moving with no legal moves → pass-turn |
| `test/ai-backgammon-prompts.spec.js` | snapshot the rendered prompt per phase; pip-count math; board orientation for side A and side B; parser accepts fenced/bare JSON and rejects malformed |
| `test/ai-backgammon-player.spec.js` | with `FakeLlmClient`, assert action selection, banter passthrough, `InvalidLlmMove` on bad id, `InvalidLlmResponse` on bad JSON |

Integration:

| File | Subject |
|---|---|
| `test/ai-backgammon.spec.js` | boot the AI subsystem with `FakeLlmClient`, drive a full leg (including a doubles roll to exercise the pending-sequence cache and a cube offer round-trip); assert SSE events; assert stall on garbage LLM output |
| persona-scoping case in `test/ai-personas-route.spec.js` (new or extended) | `GET /api/ai/personas?game=backgammon` returns only backgammon-tagged or untagged personas |

Live, env-gated smoke test (parallel to the existing `test/ai-cribbage.live.spec.js` if present): one short leg against the real Claude CLI with `colonel-pip`, opt-in.

We do not test play strength.

## File map

| File | Change |
|---|---|
| `plugins/backgammon/server/ai/backgammon-player.js` | NEW |
| `plugins/backgammon/server/ai/legal-moves.js` | NEW |
| `plugins/backgammon/server/ai/prompts.js` | NEW |
| `data/ai-personas/colonel-pip.yaml` | NEW |
| `data/ai-personas/aunt-irene.yaml` | NEW |
| `data/ai-personas/the-shark.yaml` | NEW |
| `data/ai-personas/hattie.yaml` | add `games: [cribbage]` |
| `data/ai-personas/mr-snake.yaml` | add `games: [cribbage]` |
| `data/ai-personas/professor-doofi.yaml` | add `games: [cribbage]` |
| `src/server/ai/index.js` | register backgammon adapter |
| `src/server/ai/orchestrator.js` | `autoActions` map + pending-sequence consumption |
| `src/server/ai/agent-session.js` | `pending_sequence` helpers; `rowToSession` exposes column |
| `src/server/ai/persona-catalog.js` | read optional `games:` field |
| `src/server/routes.js` | `/api/ai/personas?game=` filter |
| `src/server/db.js` | migration: add `pending_sequence` column |
| `public/lobby/lobby.js` | pass `game` to persona fetch |
| `test/ai-backgammon.spec.js` | NEW |
| `test/ai-backgammon-legal-moves.spec.js` | NEW |
| `test/ai-backgammon-prompts.spec.js` | NEW |
| `test/ai-backgammon-player.spec.js` | NEW |
| `docs/games/backgammon.md` | append AI section |

## Risks

- **LLM weak at backgammon tactics.** Accepted. Bots are flavor opponents.
- **Large move menus on doubles.** A doubles roll can produce 100+ unique sequences. Mitigation: rely on Claude CLI's context handling; if cost or latency becomes a real problem, add a heuristic pre-pruner. Not in this scope.
- **Pending-sequence drift on engine state changes.** If something external mutates state mid-turn (it shouldn't — single-process, sync sqlite), the cached sequence could become illegal. Mitigation: each cached move is re-validated through `applyAction`; an `error` result triggers normal stall handling, which clears the cache.
