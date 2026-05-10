# AI Players for the Gamebox — Cribbage First

**Status:** Design approved 2026-05-10
**Scope:** v1 — cribbage only, framework designed to generalize
**Pattern source:** `sidequest/sidequest-server/sidequest/agents/` (subprocess + persistent-session pattern)

---

## Goal

Add Claude-driven AI opponents to the gamebox as personality/banter companions. The mechanical "imperfect player" is the feature: a max-EV cribbage bot is solitaire with extra steps. The LLM's job is to play like a *person* — sometimes greedy, sometimes sentimental, sometimes brilliant — with character voice surfaced as ephemeral speech bubbles above the opponent's seat.

Cribbage is the first game. Other games (backgammon, buraco, rummikub, words) are out of v1 scope but the framework anticipates them as thin per-game adapters.

## Non-goals (v1)

- Strong opponent AI / max-EV play
- Streaming banter (one-shot per turn is fine)
- Persona editor UI (edit YAML files)
- Optimal-play diagnostics ("you missed a 4-pegger")
- Banter persistence / scrollback
- Cost telemetry / OTel
- AI-vs-AI mode
- Per-persona model selection
- Other games — separate stories

## Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Purpose | Personality/banter companion | Mechanics secondary; voice carries the experience |
| Game | Cribbage first | Compact decision space; rich named events for banter |
| LLM role | Claude picks moves freely from legal options | Imperfection is the feature; persona shapes pick |
| Heuristic | None in v1 | Optimum-play diagnostic deferred |
| Integration | Subprocess `claude -p` (sidequest-style) | Free with subscription, no API key, sessions cache via `--session-id`/`--resume` |
| Voice surface | Speech bubble above opponent avatar (~5s, ephemeral) | "Alive" feel; logging deferred |
| Personas | Templates loaded from YAML; bot users adopt one per game | Flexibility: one bot user wears different personas |
| v1 cast | Hattie, Mr. Snake, Professor Doofi | Three voices with distinct flaws so banter feels varied |
| Bot identity | Rows in existing `users` table with `is_bot=1` | Reuses lobby/opponent plumbing; no new "AI seat" routing |

---

## Architecture

Three layers; new code under `src/server/ai/` (shared) and `plugins/cribbage/server/ai/` (game-specific).

```
┌─ Orchestrator ──────────────────────────────────────────┐
│  After every action commit, checks if newState's       │
│  activeUserId is a bot. If so, schedules an AI turn.   │
│  Per-game serialization via Map<gameId, Promise>.      │
│  Calls game adapter, applies action via                │
│  plugin.applyAction, broadcasts banter + update SSE.   │
└─────────────┬───────────────────────────┬───────────────┘
              │                           │
              ▼                           ▼
┌─ AgentSession (per game) ──┐  ┌─ CribbagePlayer adapter ────────┐
│ {gameId, claudeSessionId,  │  │ chooseAction({ publicView,      │
│  personaId} persisted in   │  │   legalMoves, persona,          │
│  ai_sessions; resume on    │  │   lastEvent }) → Promise<{      │
│  every subsequent turn     │  │   action, banter }>             │
└──────────┬─────────────────┘  └─────────────┬───────────────────┘
           │                                  │
           ▼                                  │
┌─ ClaudeCliClient ──────────┐                │
│ Spawns `claude -p`         │ ◀──────────────┘
│ --session-id NEW_UUID on   │
│   first turn               │
│ --resume SID on subsequent │
│ --system-prompt on create  │
│ --output-format json       │
│ Subprocess spawner is      │
│ dependency-injected for    │
│ tests (FakeLlmClient)      │
└────────────────────────────┘
```

### Why these boundaries

- **Orchestrator** owns "when does the AI act and how is it serialized." Single concern; no per-game knowledge.
- **AgentSession** owns "this game's conversation with Claude." Persists `claude_session_id` so the persona system prompt and prior turns stay in Claude's prompt cache (massive cost win — see sidequest ADR-066).
- **ClaudeCliClient** owns "how do we talk to the binary." Subprocess details, env, JSON envelope parsing, timeouts. Mirrors `sidequest-server/sidequest/agents/claude_client.py` shape (Node port).
- **CribbagePlayer adapter** owns "what does cribbage need from Claude per phase." Per-game knowledge is isolated here so backgammon/buraco/etc. are siblings, not modifications.

---

## Data model changes

**Migration `migrations/NNN-ai-players.sql`:**

```sql
-- Bot flag on users
ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;

-- Per-game AI session record
CREATE TABLE ai_sessions (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  bot_user_id INTEGER NOT NULL REFERENCES users(id),
  persona_id TEXT NOT NULL,
  claude_session_id TEXT,           -- null until first turn (created lazily)
  stalled_at INTEGER,               -- non-null while bot turn is unresolved
  stall_reason TEXT,                -- timeout|invalid_response|illegal_move|subprocess_error
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
```

Persona is **not** a column on `users` — it's chosen per game at lobby creation time. The same bot user can play as Granny in one game and the Hustler in another.

**Persona files: `data/ai-personas/*.yaml`**

```yaml
id: hattie
displayName: Hattie
color: '#ec4899'
glyph: ♡
systemPrompt: |
  You are Hattie, who has been playing cribbage at the Methodist church
  social hall for forty years. You speak warmly and sometimes wander off
  topic. You are sentimental about face cards and reluctant to discard
  them to your opponent's crib. You enjoy a long run more than a quick pair.
voiceExamples:
  - "Oh dear, what a lovely run."
  - "I'll just lay this old fellow down."
  - "Now where did I put that jack..."
```

Loaded once at server boot into an in-memory catalog. v1 ships with three personas: **Hattie** (warm, sentimental about face cards), **Mr. Snake** (cagey hustler who slow-plays and trash-talks), **Professor Doofi** (overconfident pseudo-mathematician who miscounts with conviction).

**Bot user seeding:** at first server boot, ensure at least one bot user exists in the `users` table (e.g., `friendlyName: "AI Opponent"`, `email: "ai+default@bot.local"`, `is_bot: 1`). v1 has one bot user; persona selection at game-creation time gives variety.

---

## Lobby integration

`POST /api/games` body grows one optional field:

```json
{
  "opponentId": 7,
  "gameType": "cribbage",
  "variant": "...",
  "personaId": "granny"   // required iff opponent is a bot
}
```

Server validates: if `opponent.is_bot`, `personaId` must reference a known persona. On game create, write the `ai_sessions` row with `claude_session_id = null`; the session is created lazily on the bot's first turn so we don't burn tokens on games that never start.

The lobby UI shows the bot user(s) in the opponent list (already free since they're real `users` rows); when a bot is selected, a persona dropdown appears.

**Public view rendering:** the bot's display name in the running game comes from the **persona's** `displayName`, not the user row's `friendlyName`. Same for color/glyph. `ai_sessions` is the source of truth for "which face is the bot wearing in this game."

---

## Per-turn flow

1. Human POSTs action via existing `/api/games/:id/action` route → `plugin.applyAction` → state persisted → SSE `update` broadcast.
2. **New step** (after txn commit): if `newState.activeUserId` is a bot user id, call `aiOrchestrator.scheduleTurn(gameId)`. Returns immediately; turn runs async.
3. Orchestrator's per-game queue picks up the work:
   - Loads game + `ai_sessions` row + persona from catalog
   - Computes `publicView` from bot's perspective
   - Calls `cribbagePlayer.chooseAction({ publicView, legalMoves, persona, lastEvent })`
4. Adapter constructs the per-turn user message with `{phase, hand, scores, last_event, legal_moves}` and asks for JSON `{move: <one of legal_moves>, banter: "<short line, may be empty>"}`. Persona's system prompt is set on session creation only (not re-sent).
5. Adapter calls `claudeCliClient.sendWithSession({ prompt, sessionId, systemPrompt, personaId })`:
   - First turn: spawn with `--session-id NEW_UUID --system-prompt "..."`. Persist returned UUID into `ai_sessions.claude_session_id`.
   - Subsequent turns: spawn with `--resume <UUID>`. (`systemPrompt` is ignored — already in session history.)
6. Adapter parses the JSON envelope from stdout, extracts `{move, banter}`, validates `move ∈ legalMoves`. Returns to orchestrator.
7. Orchestrator applies action via the SAME `plugin.applyAction` path the HTTP route uses (with bot's userId as `actorId`). Persists. Broadcasts `banter` event then `update` event.
8. If `newState.activeUserId` is *still* a bot (multi-step phases like the show acknowledgment), recurses from step 3.

### Cribbage adapter — per-phase prompt shape

| Phase | Decision | Legal moves | Banter? |
|---|---|---|---|
| `discard` | Pick 2 of 6 cards | C(6,2) = 15 ordered pairs | Yes |
| `cut` | Confirm cut | Single action `{type:'cut'}` | No (skip) |
| `pegging` | Play one card | Subset of hand where running total ≤ 31; or `{type:'go'}` if none playable | Yes |
| `show` | Acknowledge `{type:'next'}` | Single action | Optional ("ah, 24 hand!") |

`legalMoves` is computed in JS — Claude only ever picks from validated options. Imperfection comes from *which* legal move it picks, not from generating illegal ones. The prompt encodes the move-id (e.g., `"discard:2,5"` or `"play:H7"`) so Claude returns a string lookup, not a structured action.

---

## SSE banter event

```json
{
  "type": "banter",
  "payload": {
    "side": "b",
    "personaId": "hattie",
    "displayName": "Hattie",
    "text": "Oh, that was a lovely run."
  }
}
```

Broadcast just before the corresponding `update` event so the bubble appears slightly before the move's mechanical effects.

## Speech bubble UI

New client component `<OpponentBubble />`:
- Subscribes to existing SSE stream (already plumbed for `update`)
- On `banter`, displays styled bubble above the opponent's seat for 5s with fade-out
- Multiple in quick succession queue and play sequentially (one at a time)
- No persistent log in v1

Position/styling: stays out of the way of cards/score; respects the existing phone-layout guards (per recent commits — `fix(rummikub/client): tighten phone layout`).

---

## Failure modes — fail loud, never silently play a bad move

**Core principle:** if Claude can't pick a move, the bot does **not** play. Auto-playing a "first legal card" silently throws the game with a card the persona would never have picked, hides systemic problems, and lies to the human. The game stalls visibly and the human resolves it.

### Stall protocol

When `chooseAction` cannot produce a valid `{action, banter}`:

1. **Retry once.** Same prompt, fresh subprocess (Anthropic blips often clear on a second call).
2. **If retry also fails:** mark the bot's turn as stalled.
   - Add `stalled_at INTEGER` and `stall_reason TEXT` columns to `ai_sessions`.
   - Set both. Persist.
   - Broadcast SSE event: `{ type: 'bot_stalled', payload: { side, personaId, displayName, reason } }` where `reason ∈ {timeout, invalid_response, illegal_move, subprocess_error}`.
   - Do **not** apply any action. Game state is unchanged. `activeUserId` still points at the bot.
3. **Human resolution.** The opponent UI shows a banner like *"Hattie froze up — retry or abandon?"* with two buttons:
   - **Retry** → `POST /api/games/:id/ai/retry` clears `stalled_at`, re-runs `chooseAction`. Same protocol applies (one retry, then re-stall).
   - **Abandon** → `POST /api/games/:id/ai/abandon` ends the game with `endedReason: 'ai_stalled'`, no winner. The human gets a clean exit.
4. **Cribbage has no pass move**, so we can't auto-skip the bot's turn. Stall + retry/abandon is the only honest option.

### Per-failure mapping

| Failure | Behavior |
|---|---|
| Claude returns invalid JSON | Retry once; on second failure, stall with reason=`invalid_response`. |
| Claude picks a move not in `legalMoves` | Retry once; on second failure, stall with reason=`illegal_move`. |
| Subprocess timeout (default 30s) | Retry once; on second timeout, stall with reason=`timeout`. |
| Subprocess exits non-zero (auth, network down, CLI panic) | Retry once; on second failure, stall with reason=`subprocess_error`. |
| `claude` CLI not installed | Fail-loud at server boot if any bot users exist (don't silently disable). |
| `ai_sessions` row missing for a bot's turn | Recreate it (defensive); log warning. Not a stall. |
| Server restart mid-game with active bot turn | On boot, scan `games` where `activeUserId` is a bot and `status='active'`; resume those games via the orchestrator queue. If `claude_session_id` resume fails, create a fresh session and prepend a state recap as the first user message. Treat persistent failure as a stall. |
| Subscription has no listeners | Bot still plays; banter just doesn't reach anyone. (This is not a failure.) |

### What the 30s timeout does in practice

- **Normal turn:** 2-8s. Almost never hits.
- **Hot spell:** API overloaded, real turn would take 25s — hits the cap. Retry usually succeeds.
- **Both calls time out:** stall. Human sees the banner and chooses retry or abandon.
- **The dial trade-off:** too tight (5-10s) means spurious stalls on legit-slow turns; too generous (60s+) means humans stare at frozen UI for a full minute when Claude is genuinely stuck. 30s is the sweet spot for v1; revisit with telemetry.

### Thinking indicator

While a bot turn is in flight (between schedule and apply), the opponent seat shows a subtle *"Hattie is thinking…"* indicator (pulsing dots in the bubble area). Without this, a 6-second wait feels longer than 6 seconds. The indicator is driven by a new SSE event pair: `{ type: 'bot_thinking', payload: { side, personaId } }` on schedule, cleared on the next `update` or `bot_stalled` event.

---

## Testing strategy

- **`FakeLlmClient`** with canned `{move, banter}` responses → unit-test orchestrator + adapter without subprocess.
- **Persona snapshot tests** — system prompt build is stable across loads; YAML round-trip preserves content.
- **Adapter contract tests** — every cribbage phase parses correctly; invalid responses fall back as designed; legal-moves enumeration is exhaustive.
- **Integration test** — full deal end-to-end driven by `FakeLlmClient`, verifies state transitions and SSE event emissions in order.
- **Per-game serialization test** — concurrent action requests don't double-fire AI turns.
- **Stall + retry/abandon flow** — `FakeLlmClient` configured to fail twice; verify SSE `bot_stalled` event, persisted `stalled_at`/`stall_reason`, and that retry / abandon endpoints behave correctly.
- **Boot-time resume** — game with active bot turn at startup is picked up by orchestrator scan.
- **No live subprocess in CI.** A single opt-in smoke test exercises the real `ClaudeCliClient` locally (skipped in CI via env-gate).

---

## File-level layout

```
src/server/ai/
  llm-client.js           # ClaudeCliClient + LlmClient interface
  fake-llm-client.js      # Test double
  persona-catalog.js      # YAML loader; in-memory map
  agent-session.js        # ai_sessions table accessor; session UUID lifecycle
  orchestrator.js         # scheduleTurn + per-game queue
  index.js                # Wiring; bootstrap (seed bot user, load personas)

plugins/cribbage/server/ai/
  cribbage-player.js      # chooseAction adapter
  prompts.js              # Per-phase prompt templates
  legal-moves.js          # Pure functions: enumerate legal moves per phase

data/ai-personas/
  hattie.yaml
  mr-snake.yaml
  professor-doofi.yaml

migrations/
  NNN-ai-players.sql

test/server/ai/
  llm-client.test.js
  agent-session.test.js
  orchestrator.test.js
  persona-catalog.test.js

test/plugins/cribbage/ai/
  cribbage-player.test.js
  legal-moves.test.js
  full-deal.integration.test.js
```

Existing files touched (small):
- `src/server/routes.js` — accept `personaId` in `POST /api/games`; create `ai_sessions` row when opponent is a bot. New routes `POST /api/games/:id/ai/retry` and `POST /api/games/:id/ai/abandon` for stall resolution.
- `src/server/migrate.js` — register the new migration.
- `src/server/server.js` — boot AI subsystem (seed bot user, load personas, resume in-flight bot turns).
- Action-applying path in `routes.js` — after txn commit, call `aiOrchestrator.scheduleTurn(gameId)` if next active user is a bot.
- `plugins/cribbage/server/view.js` — substitute persona's displayName/color/glyph for the bot side in publicView.

---

## Generalization story

The framework defines interfaces that any future game implements:

- **Per-game adapter contract:** `chooseAction({ publicView, legalMoves, persona, lastEvent }) → Promise<{ action, banter? }>` — pure async function. No globals.
- **`legalMoves` shape:** array of `{ id: string, action: object, summary: string }` — `id` is what Claude returns, `action` is what `plugin.applyAction` consumes, `summary` is what the prompt shows.

Adding backgammon: write `plugins/backgammon/server/ai/backgammon-player.js` and `prompts.js`. No changes to `src/server/ai/`.

Adding a new persona: drop a YAML file in `data/ai-personas/`. No code changes.

---

## Open questions to resolve during planning

- **Banter rate limiting.** The pegging phase can produce 2-4 bot moves in quick succession. Should we cap banter to one bubble per N seconds? v1 default: emit every banter line; UI queue handles display pacing. Revisit if it feels overwhelming.
- **Persona default.** When the lobby user picks an AI opponent, what's the default persona in the dropdown? v1: alphabetical first. Later: remember per-user last-played persona.
- **Stall UI placement.** Where exactly does the *"Hattie froze up — retry / abandon?"* banner live — replacing the speech bubble, in a separate strip, or modal? Defer to UX during implementation; the SSE event carries enough info that any presentation works.
- **Long-running session token cost.** Claude sessions accumulate context turn-over-turn. A 121-point cribbage match could run 30+ turns. Even with prompt caching, the cumulative cache-creation cost could matter. v1 monitors and revisits — if it's a problem, snapshot+reset the session at deal boundaries.
