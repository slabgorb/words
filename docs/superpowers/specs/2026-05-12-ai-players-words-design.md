# AI Players — Words

Status: design approved 2026-05-12. Predecessors: `2026-05-10-ai-players-cribbage-design.md`, `2026-05-11-ai-players-backgammon-design.md`.

## Goal

Add a Claude-CLI-driven bot to the Words plugin. Bots play as a solid casual opponent: real Scrabble move generation against ENABLE2K, picking among an engine-built shortlist of stylistically diverse plays. Three personas — Samantha, Suzie, Kurt — span three play archetypes (bingo hunter, defender, score maximizer). The LLM picks one shortlisted play per turn and banters in persona voice.

## Non-goals

- World-class play. No equity tables, no neural net, no Monte-Carlo simulation.
- New SSE events, bot-user model, or stall semantics — all inherited from the cribbage/backgammon orchestrator.
- Cross-game persona compatibility. Words personas are tagged `games: [words]`.
- Challenge mechanic. The engine never plays an invalid word, so there is nothing to challenge.

## Architecture

Same shape as the cribbage and backgammon adapters. Adapter-local code lives under `plugins/words/server/ai/`; one line of registration in `src/server/ai/index.js`. Shared LLM client, persona catalog, orchestrator, error classes, and session table are unchanged.

```
plugins/words/server/ai/
  words-player.js     chooseAction({llm, persona, sessionId, state, botPlayerIdx})
  trie.js             buildEnableTrie() — lazy, singleton; loads ENABLE2K into a @kamilmielnik/trie
  shortlist.js        buildShortlist(state, botSide) → Array<{ id, action, summary, slot }>
  prompts.js          buildTurnPrompt(...) + parseLlmResponse(text)
  config.js           Words ↔ scrabble-solver adapter (Board/Tile/Config + result translation)
```

`config.js` exists because `@scrabble-solver/solver` expects its own `Board`/`Tile`/`Config` types. We translate from plugin state to those once per turn, and translate the chosen `ResultJson` back to a Words `move` action (preserving blank-tile flags).

## Dependency: scrabble-solver

Add three packages to `package.json`:

| Package | Purpose |
|---|---|
| `@scrabble-solver/solver` | `solve(trie, config, board, tiles) → ResultJson[]` |
| `@scrabble-solver/types` | `Board`, `Tile`, `Cell`, `Config`, `ResultJson` |
| `@kamilmielnik/trie` | trie data structure used by solver |

**Dictionary.** Trie is built once on first call from the existing `data/enable2k.txt`. No new dictionary file. Build is memoised at module scope.

**Solver call.** scrabble-solver's `solve(...)` accepts the trie as a parameter, so we feed our own. No reliance on its bundled dictionaries.

**Budget.** Solve cost on a mid-game board is sub-second. We slice the result set to the top 50 by raw score before scoring leaves and defense (the heuristic passes). The solver itself is bounded by tile count (max 7 placed). A 2s budget cap wraps the solver call; on timeout the shortlist is built from results-so-far, or `pass` is forced. See <a href="#edge-cases">Edge cases</a>.

## Shortlist construction

`buildShortlist(state, botSide)` runs the solver once, then selects diverse candidates by filling slots in order. Later slots are dropped if they would duplicate an earlier slot's placement signature (coords + tiles).

| Slot id | Selection rule | Always present? |
|---|---|---|
| `top-score` | Highest-points play in the result set. | Yes (if any plays exist) |
| `best-bingo` | Highest-points play using all 7 rack tiles (+50 bonus). | Only if a bingo exists |
| `best-leave` | Among the top 25% by score, the play with the highest **rack-leave score**. Tends to set up future bingos. | If distinct |
| `best-defense` | Among the top 25% by score, the play with the lowest **opponent-exposure score**. Tends to avoid opening TW/TL columns. | If distinct |
| `safe-medium` | A play scoring 60–80% of top, no premium-square exposure, easy rack leave. Fills the menu when top picks converge. | If distinct |
| `pass` | `{ type: 'pass' }`. | Only when shortlist would otherwise be empty |
| `swap-worst` | `{ type: 'swap', payload: { tiles: [...] } }`, dumping the 3 lowest-utility tiles (prefer Q/V/W with no support, duplicates, all-vowel/all-consonant racks). | Only when `bag.length ≥ 7` AND `top-score < 12` |

Shortlist size is 1–5 primary entries (depending on how many distinct slots survive dedup) plus an optional `pass` or `swap-worst`, for a maximum of 7. Each entry is `{ id, action, summary, slot }`.

### `summary` format

One-line rationale per slot, suitable for direct inclusion in the prompt. Examples:

```
top-score:    "FRAZZLED H8→H15, hooks ZERO; 86 pts; leaves QU"
best-bingo:   "SLATIER 7E→7K; 74 pts; bingo; leaves nothing"
best-leave:   "ZINS 4F→4I; 28 pts; saves AERST for next turn"
best-defense: "QI 11J→11K (on triple-letter); 22 pts; closes 8-row"
safe-medium:  "LINER 9C→9G; 18 pts; no premium exposure"
swap-worst:   "swap QVW; keep AEIR; bag=58"
```

Coordinates follow standard Scrabble notation: row digit + column letter, with axis derived from the placement direction.

### Rack-leave score (heuristic)

`leaveScore(remainingRack) = vowelConsonantBalance + repetitionPenalty + retentionBonus`

Per-letter table: `S R T L N E` worth +2 each (good retention), `Q` worth −5 (offload), duplicates beyond two penalised. Blanks worth +6. Vowel-consonant balance peaks at 2:3 or 3:2 in a 5-tile leave. Fast, deterministic, sufficient for a casual bot.

### Opponent-exposure score (heuristic)

For each newly-placed tile, sum the value of premium squares (`TW=15, DW=10, TL=8, DL=4`) reachable by a one-tile extension orthogonal to the play axis from the played tile's neighbors. Lower = more defensive. We do not simulate the opponent's rack. This is a flavor of "did I leave the triple-word open?"

## Prompt design

`buildTurnPrompt({state, shortlist, botSide, persona})` assembles five blocks: header, board, rack, shortlist, footer.

### Header

```
You are playing side A. Score: you 142, opponent 167. Bag remaining: 41 tiles.
Consecutive scoreless turns: 0.
```

### Board

ASCII 15×15. Bot's tiles shown as `O[letter]`, opponent's as `X[letter]`; blanks shown lower-cased. Empty premium squares marked `★`=TW, `◆`=DW, `▲`=TL, `△`=DL. Center dot for empty non-premium. Columns A–O across the top, rows 1–15 down the left, standard Scrabble notation. Fixed orientation regardless of which side the bot plays — Words has no perspective flip.

### Rack

```
Your rack: A E I R S T Z   (7 tiles)
```

Blanks shown as `_`.

### Shortlist

```
Legal candidates:
  top-score:    FRAZZLED H8→H15; 86 pts; leaves QU
  best-bingo:   SLATIER 7E→7K; 74 pts; bingo; leaves nothing
  best-leave:   ZINS 4F→4I; 28 pts; saves AERST for next turn
  best-defense: QI 11J→11K (on triple-letter); 22 pts; closes 8-row
  swap-worst:   swap QVW; keep AEIRS; bag=58
```

### Footer

Identical contract to cribbage and backgammon:

```
Respond with a single JSON object (and nothing else):
{"moveId": "<one of the candidate ids above>", "banter": "<short in-character line, may be empty>"}
```

### Parsing

`parseLlmResponse(text)` accepts a fenced JSON block (`` ```json ... ``` ``) or a bare object. Throws `InvalidLlmResponse` on missing `moveId` or non-string `banter`; `InvalidLlmMove` if `moveId` is not in the shortlist. Same error classes the orchestrator already knows how to stall on.

## Personas

Three new YAMLs under `data/ai-personas/`, each tagged `games: [words]`. One per archetype.

| id | Display | Archetype | Prompt bias |
|---|---|---|---|
| `samantha` | Samantha | bingo hunter | "Favor `best-bingo` when shown. Trade short-term points for a balanced rack — S, R, T, L, N, E are worth holding." |
| `suzie` | Suzie | defender | "Favor `best-defense`. A closed board is a winning board. Decline `top-score` when it opens a triple-word column." |
| `kurt` | Kurt | score maximizer | "Favor `top-score`. Premium squares exist to be used. Rack leave is for people who lose." |

Each system prompt also includes the standard secrecy clause adapted for Words ("don't reveal your rack, don't telegraph your strategy") and the JSON-only contract.

## Orchestrator integration

**Adapter registration** — one line in `src/server/ai/index.js`:

```js
words: { plugin: wordsPlugin, chooseAction: wordsChoose },
```

**No `autoActions` entry.** Words has no mechanical phase to skip. Every turn is an LLM-driven decision among the shortlist.

**No `pending_sequence` use.** Words is one action per turn (one `move`, one `pass`, or one `swap`). The existing cache machinery sits dormant for this game.

**Recursion.** The existing depth-1 cap in `_runOnce` is sufficient. After a Words bot action, `activeUserId` flips to the human; no recurse case applies.

**Phase awareness.** Words plugin state has no `phase` / `turn.phase` field, only `activeUserId`. The orchestrator already gates on `state.activeUserId === session.botUserId`; no change needed.

## Edge cases

- **No legal plays** (rare; late game when no rack tile connects through any anchor and bag is empty): shortlist is `[pass]` only. LLM picks pass; banter allowed.
- **Best play scores low + bag has tiles**: `swap-worst` appears in the shortlist. LLM may pick swap or play anyway (persona-dependent).
- **Bag too small to swap** (`bag.length < 7`): swap slot omitted. Bot must play or pass.
- **Resign**: not exposed to the bot.
- **Blanks**: solver accepts blanks in the rack and returns plays with the blank-as-letter encoded. `config.js` translates the result into our `{ blank: true, letter }` placement entries.
- **First move** (empty board): solver enforces the center-cover rule via its `Config`. Shortlist construction is unchanged.
- **Game-end via 6 scoreless turns**: bot will rarely pass twice in a row given engine costs are cheap. Mostly a human-driven endgame.
- **Solver budget exceeded** (>2s): we shortlist what we have so far. If zero plays were produced, force `pass` and emit `bot_stalled` with reason `subprocess_error`.
- **Engine rejects bot move**: existing orchestrator retry-once + stall machinery applies. `InvalidLlmMove` / `InvalidLlmResponse` error classes.

## Persona scoping

`/api/ai/personas?game=words` filtering is already implemented (added during backgammon work). The four new YAMLs just declare `games: [words]`.

## Testing

Unit:

| File | Subject |
|---|---|
| `test/ai-words-trie.spec.js` | trie loads ENABLE2K; known words validate, garbage rejects; build is memoised |
| `test/ai-words-config.spec.js` | round-trip translation: plugin board ↔ solver Board; rack with blanks; placement result ↔ plugin action |
| `test/ai-words-shortlist.spec.js` | slot population on curated mid-game state (`top-score`, `best-bingo`, `best-leave`, `best-defense` distinct); empty-rack edge case → pass; weak-rack mid-bag → `swap-worst` included; swap omitted when bag < 7; signature dedup |
| `test/ai-words-prompts.spec.js` | snapshot the rendered board and shortlist; parser accepts fenced/bare JSON and rejects malformed |
| `test/ai-words-player.spec.js` | with `FakeLlmClient`: chooses the requested slot's action; `InvalidLlmMove` on unknown slot id; `InvalidLlmResponse` on bad JSON |

Integration:

| File | Subject |
|---|---|
| `test/ai-words.spec.js` | boot the AI subsystem with `FakeLlmClient`, drive a short game (a few plays, one swap, one pass, end on rack-empty); assert SSE `bot_thinking` / `banter` / `update` / `turn` event sequence; persona stall on garbage LLM output |
| persona-scoping case in `test/ai-personas-route.spec.js` (extended) | `GET /api/ai/personas?game=words` returns only the three words personas |

Live, env-gated smoke test (parallel to existing live specs): one short game against the real Claude CLI with `samantha`. Opt-in. Skipped in CI.

We do not test play strength.

## File map

| File | Change |
|---|---|
| `plugins/words/server/ai/words-player.js` | NEW |
| `plugins/words/server/ai/trie.js` | NEW |
| `plugins/words/server/ai/shortlist.js` | NEW |
| `plugins/words/server/ai/prompts.js` | NEW |
| `plugins/words/server/ai/config.js` | NEW |
| `data/ai-personas/samantha.yaml` | NEW |
| `data/ai-personas/suzie.yaml` | NEW |
| `data/ai-personas/kurt.yaml` | NEW |
| `src/server/ai/index.js` | register words adapter |
| `package.json` | add `@scrabble-solver/solver`, `@scrabble-solver/types`, `@kamilmielnik/trie` |
| `docs/games/words.md` | NEW (mirror structure of `docs/games/backgammon.md` AI section) |
| `test/ai-words-trie.spec.js` | NEW |
| `test/ai-words-config.spec.js` | NEW |
| `test/ai-words-shortlist.spec.js` | NEW |
| `test/ai-words-prompts.spec.js` | NEW |
| `test/ai-words-player.spec.js` | NEW |
| `test/ai-words.spec.js` | NEW |
| `test/ai-personas-route.spec.js` | extend with words-scope case |

## Risks

- **Solver latency on early-game racks with full board access.** First few moves can produce thousands of legal plays. Mitigation: top-50 slice before heuristic passes + 2s budget cap. If still slow, add a cheap pre-filter (require score ≥ N) before leave/defense scoring.
- **Persona bias is "soft".** The archetype lives in the prompt rather than the engine, so an LLM can pick off-archetype. Acceptable — feels more like a person; obvious deviations are rare with the directives we use today.
- **LLM hallucinates a `moveId` not in the shortlist.** Same handling as cribbage/backgammon: retry-once, then stall with reason `illegal_move`.
- **Blank-tile encoding mismatch.** scrabble-solver's `Tile` shape may use a different blank marker than our `'_'`. Translation layer in `config.js`; covered by the round-trip test.
- **scrabble-solver upstream changes.** Adapter pinning + the `solve(trie, ...)` signature being parameter-passed (verified by reading `solve.ts`) limits exposure; the trie format is the only contract we depend on externally.
