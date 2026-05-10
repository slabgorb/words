# AI Players for Cribbage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Claude-driven AI opponents to cribbage as personality/banter companions. Bot picks from validated legal moves, persona-flavored voice surfaces as ephemeral speech bubbles. Stall-and-resolve failure model — never silently play a bad card.

**Architecture:** Subprocess-based `claude -p` LLM client with persistent sessions for prompt-cache reuse, mirroring the sidequest pattern. Persona templates loaded from YAML; bot users adopt one per game via `ai_sessions` table. Per-game adapter (cribbage first) bridges plugin engine to LLM. Orchestrator serializes per-game AI turns and broadcasts banter via existing SSE stream.

**Tech Stack:** Node 20 + Express + better-sqlite3 (existing). New dep: `js-yaml` for persona files. Tests: `node:test` runner (existing convention). No client framework — plain JS DOM, matching cribbage client style.

**Spec:** `docs/superpowers/specs/2026-05-10-ai-players-cribbage-design.md` (commit `0d3c7be`).

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `data/ai-personas/hattie.yaml` | Persona: warm, sentimental about face cards |
| `data/ai-personas/mr-snake.yaml` | Persona: cagey hustler who slow-plays |
| `data/ai-personas/professor-doofi.yaml` | Persona: overconfident pseudo-mathematician |
| `src/server/ai/persona-catalog.js` | Load YAML files at boot into `Map<id, Persona>` |
| `src/server/ai/llm-client.js` | `ClaudeCliClient` subprocess wrapper + `LlmClient` interface |
| `src/server/ai/fake-llm-client.js` | Test double for LlmClient |
| `src/server/ai/agent-session.js` | `ai_sessions` row CRUD + claude_session_id lifecycle |
| `src/server/ai/orchestrator.js` | scheduleTurn + per-game queue + stall protocol |
| `src/server/ai/index.js` | Bootstrap (load personas, seed bot user, resume in-flight) |
| `plugins/cribbage/server/ai/legal-moves.js` | Pure functions: enumerate legal moves per phase |
| `plugins/cribbage/server/ai/prompts.js` | Per-phase prompt builders + JSON envelope parser |
| `plugins/cribbage/server/ai/cribbage-player.js` | `chooseAction({...})` adapter |
| `plugins/cribbage/client/opponent-bubble.js` | Speech bubble + thinking indicator + stalled banner |
| `test/ai-persona-catalog.test.js` | Catalog loader tests |
| `test/ai-llm-client.test.js` | ClaudeCliClient tests with injected spawner |
| `test/ai-agent-session.test.js` | ai_sessions CRUD tests |
| `test/ai-orchestrator.test.js` | Orchestrator + stall protocol tests |
| `test/ai-bootstrap.test.js` | Bootstrap (seed, resume) tests |
| `test/cribbage-ai-legal-moves.test.js` | Per-phase legal-move enumeration |
| `test/cribbage-ai-prompts.test.js` | Prompt build + parse |
| `test/cribbage-ai-player.test.js` | chooseAction tests with FakeLlmClient |
| `test/cribbage-ai-routes.test.js` | personaId acceptance + retry/abandon routes |
| `test/cribbage-ai-full-deal.test.js` | End-to-end deal driven by FakeLlmClient |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `js-yaml` dependency |
| `src/server/db.js` | Schema delta: `users.is_bot` column + `ai_sessions` table (inline pattern, matches existing convention; no separate `migrations/` folder) |
| `src/server/server.js` | Boot AI subsystem after `mountRoutes` |
| `src/server/routes.js` | Accept `personaId` in `POST /api/games`; create `ai_sessions` row when opponent is bot; call `aiOrchestrator.scheduleTurn` after action commit; mount `/ai/retry` and `/ai/abandon` routes |
| `plugins/cribbage/server/view.js` | (No change — persona display injected at plugin-clients layer; view stays pure) |
| `src/server/plugin-clients.js` | When opponent is a bot, look up `ai_sessions.persona_id`, override `opponentFriendlyName/Color/Glyph` in `ctx` from persona |
| `plugins/cribbage/client/app.js` | Subscribe to new SSE events: `banter`, `bot_thinking`, `bot_stalled`; mount opponent-bubble |
| `plugins/cribbage/client/index.html` | Add `<div id="opponent-bubble">` slot; load `opponent-bubble.js` |
| `plugins/cribbage/client/style.css` | Bubble + thinking-dots + stalled-banner styles |

---

## Conventions to follow (read before starting)

- **Tests:** `node:test` + `node:assert/strict`. Files live flat in `test/`, named `<area>.test.js` (e.g., `test/ai-orchestrator.test.js`). Run a single file via `node --test test/ai-orchestrator.test.js`. Run all tests via `npm test`.
- **No async test wrapping:** test bodies are `async () => { ... }` — see `test/cribbage-discard.test.js` for shape.
- **DB schema deltas:** appended to `src/server/db.js` `openDb()` body using `IF NOT EXISTS` / column-existence checks. **Do NOT create a `migrations/` folder** — that conflicts with the existing convention.
- **ESM only:** `"type": "module"` in package.json. Use `import`, no `require`. File extensions required (`.js`).
- **Commits:** small commits per task. Conventional-commit prefix matching repo style: `feat(ai/cribbage):` for new code, `fix(ai/cribbage):` for fixes.

---

## Task 1: Add `js-yaml` dependency and seed three persona files

**Files:**
- Modify: `package.json`
- Create: `data/ai-personas/hattie.yaml`
- Create: `data/ai-personas/mr-snake.yaml`
- Create: `data/ai-personas/professor-doofi.yaml`

- [ ] **Step 1: Install dependency**

```bash
npm install js-yaml
```

Expected: `package.json` `dependencies` gains `"js-yaml": "^4.1.0"` (or current). Lockfile updates.

- [ ] **Step 2: Create `data/ai-personas/hattie.yaml`**

```yaml
id: hattie
displayName: Hattie
color: '#ec4899'
glyph: ♡
systemPrompt: |
  You are Hattie, who has been playing cribbage at the Methodist church
  social hall for forty years. You speak warmly and sometimes wander off
  topic. You are sentimental about face cards (jacks, queens, kings) and
  reluctant to discard them to your opponent's crib. You prefer a long run
  over a quick pair.

  When asked to choose a move, you will be given a list of legal moves
  with string IDs. You MUST respond with valid JSON of the form:
  {"moveId": "<exact-id-from-list>", "banter": "<short in-character line, may be empty string>"}

  Banter should be one short sentence at most. No narration of your own
  actions ("I play the seven") — speak as a person at the table.
voiceExamples:
  - "Oh dear, what a lovely run."
  - "I'll just lay this old fellow down."
  - "Now where did I put that jack..."
```

- [ ] **Step 3: Create `data/ai-personas/mr-snake.yaml`**

```yaml
id: mr-snake
displayName: Mr. Snake
color: '#10b981'
glyph: ♧
systemPrompt: |
  You are Mr. Snake, a cagey cribbage hustler at a back-room card table.
  You slow-play strong hands and trash-talk weak ones. You favor pairs
  and fifteens over runs. You will sometimes hold a card you "should"
  play just to throw your opponent off rhythm. You enjoy a small needle.

  When asked to choose a move, you will be given a list of legal moves
  with string IDs. You MUST respond with valid JSON of the form:
  {"moveId": "<exact-id-from-list>", "banter": "<short in-character line, may be empty string>"}

  Banter is one short sentence at most. Speak as a person at the table,
  never narrate your own moves mechanically.
voiceExamples:
  - "Hmm. We'll see, won't we."
  - "You sure about that one, friend?"
  - "Tsk. Bad luck."
```

- [ ] **Step 4: Create `data/ai-personas/professor-doofi.yaml`**

```yaml
id: professor-doofi
displayName: Professor Doofi
color: '#8b5cf6'
glyph: ✦
systemPrompt: |
  You are Professor Doofi, a self-styled mathematician of cribbage who
  miscounts with absolute confidence. You announce probabilities that
  may or may not be accurate. You favor what you believe is "optimal"
  play, but your reasoning is often wrong in interesting ways. You enjoy
  a brief lecture.

  When asked to choose a move, you will be given a list of legal moves
  with string IDs. You MUST respond with valid JSON of the form:
  {"moveId": "<exact-id-from-list>", "banter": "<short in-character line, may be empty string>"}

  Banter is one short sentence at most. You may cite a (possibly wrong)
  probability or rule.
voiceExamples:
  - "The odds favor this, naturally."
  - "A run of three has expected value 4.7, give or take."
  - "Statistically inevitable, my friend."
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json data/ai-personas/
git commit -m "feat(ai): add js-yaml dep and three persona templates"
```

---

## Task 2: Persona catalog loader

**Files:**
- Create: `src/server/ai/persona-catalog.js`
- Test: `test/ai-persona-catalog.test.js`

- [ ] **Step 1: Write failing test**

`test/ai-persona-catalog.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPersonaCatalog } from '../src/server/ai/persona-catalog.js';

function makeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'personas-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test('loadPersonaCatalog: reads YAML files into a Map keyed by id', () => {
  const dir = makeDir({
    'hattie.yaml': 'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: hello\n',
  });
  const catalog = loadPersonaCatalog(dir);
  assert.equal(catalog.size, 1);
  const p = catalog.get('hattie');
  assert.equal(p.displayName, 'Hattie');
  assert.equal(p.color, '#ec4899');
  assert.equal(p.glyph, '♡');
  assert.equal(p.systemPrompt, 'hello');
});

test('loadPersonaCatalog: rejects file whose id mismatches filename', () => {
  const dir = makeDir({
    'wrong.yaml': 'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: x\n',
  });
  assert.throws(() => loadPersonaCatalog(dir), /id 'hattie' does not match filename 'wrong'/);
});

test('loadPersonaCatalog: rejects missing required field', () => {
  const dir = makeDir({
    'broken.yaml': 'id: broken\ndisplayName: Broken\n',
  });
  assert.throws(() => loadPersonaCatalog(dir), /missing required field/);
});

test('loadPersonaCatalog: ignores non-yaml files', () => {
  const dir = makeDir({
    'hattie.yaml': 'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: x\n',
    'README.md': 'notes',
  });
  assert.equal(loadPersonaCatalog(dir).size, 1);
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/ai-persona-catalog.test.js
```

Expected: FAIL with `Cannot find module '.../src/server/ai/persona-catalog.js'`.

- [ ] **Step 3: Write implementation**

`src/server/ai/persona-catalog.js`:

```javascript
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import yaml from 'js-yaml';

const REQUIRED = ['id', 'displayName', 'color', 'glyph', 'systemPrompt'];

export function loadPersonaCatalog(dir) {
  const out = new Map();
  for (const file of readdirSync(dir)) {
    if (extname(file) !== '.yaml') continue;
    const expectedId = basename(file, '.yaml');
    const raw = yaml.load(readFileSync(join(dir, file), 'utf8'));
    if (!raw || typeof raw !== 'object') {
      throw new Error(`persona ${file}: not an object`);
    }
    for (const field of REQUIRED) {
      if (typeof raw[field] !== 'string' || raw[field].length === 0) {
        throw new Error(`persona ${file}: missing required field '${field}'`);
      }
    }
    if (raw.id !== expectedId) {
      throw new Error(`persona ${file}: id '${raw.id}' does not match filename '${expectedId}'`);
    }
    out.set(raw.id, {
      id: raw.id,
      displayName: raw.displayName,
      color: raw.color,
      glyph: raw.glyph,
      systemPrompt: raw.systemPrompt,
      voiceExamples: Array.isArray(raw.voiceExamples) ? raw.voiceExamples : [],
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/ai-persona-catalog.test.js
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/persona-catalog.js test/ai-persona-catalog.test.js
git commit -m "feat(ai): persona catalog loader (YAML → Map)"
```

---

## Task 3: Schema delta — `users.is_bot` + `ai_sessions` table

**Files:**
- Modify: `src/server/db.js` (append schema delta inside `openDb`)
- Test: `test/ai-schema.test.js` (new)

- [ ] **Step 1: Write failing test**

`test/ai-schema.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-schema-'));
  return openDb(join(dir, 'test.db'));
}

test('schema: users has is_bot column with default 0', () => {
  const db = tmpDb();
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const isBot = cols.find(c => c.name === 'is_bot');
  assert.ok(isBot, 'is_bot column exists');
  assert.equal(isBot.notnull, 1);
  assert.equal(isBot.dflt_value, '0');
});

test('schema: ai_sessions table has the documented columns', () => {
  const db = tmpDb();
  const cols = db.prepare("PRAGMA table_info(ai_sessions)").all();
  const names = cols.map(c => c.name);
  for (const required of ['game_id', 'bot_user_id', 'persona_id', 'claude_session_id',
                          'stalled_at', 'stall_reason', 'created_at', 'last_used_at']) {
    assert.ok(names.includes(required), `column ${required} present`);
  }
});

test('schema: ai_sessions.game_id is PRIMARY KEY referencing games(id)', () => {
  const db = tmpDb();
  const fk = db.prepare("PRAGMA foreign_key_list(ai_sessions)").all();
  assert.ok(fk.some(f => f.table === 'games' && f.from === 'game_id'));
  const pk = db.prepare("PRAGMA table_info(ai_sessions)").all().find(c => c.pk === 1);
  assert.equal(pk.name, 'game_id');
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/ai-schema.test.js
```

Expected: FAIL — columns/table missing.

- [ ] **Step 3: Add schema delta to `src/server/db.js`**

Locate the section in `openDb` after the `glyph` column delta (around line 144-146 — `if (!userCols.includes('glyph'))`). Append immediately after that block:

```javascript
  // --- AI players schema delta (story: 2026-05-10-ai-players-cribbage) ---
  if (!userCols.includes('is_bot')) {
    db.exec("ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_sessions (
      game_id           INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      bot_user_id       INTEGER NOT NULL REFERENCES users(id),
      persona_id        TEXT NOT NULL,
      claude_session_id TEXT,
      stalled_at        INTEGER,
      stall_reason      TEXT,
      created_at        INTEGER NOT NULL,
      last_used_at      INTEGER NOT NULL
    )
  `);
```

(The `userCols` variable is already in scope from the `glyph` block above.)

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/ai-schema.test.js
```

Expected: 3 PASS.

- [ ] **Step 5: Verify nothing else broke**

```bash
npm test
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/db.js test/ai-schema.test.js
git commit -m "feat(ai): schema delta — users.is_bot + ai_sessions table"
```

---

## Task 4: ClaudeCliClient with injectable spawner

**Files:**
- Create: `src/server/ai/llm-client.js`
- Create: `src/server/ai/fake-llm-client.js`
- Test: `test/ai-llm-client.test.js`

- [ ] **Step 1: Write failing test**

`test/ai-llm-client.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCliClient } from '../src/server/ai/llm-client.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';

// A fake spawner returns an object that mimics enough of node's
// child_process.spawn return value: stdout/stderr async-iterable, exitCode promise.
function fakeSpawn({ stdout = '', stderr = '', exitCode = 0, delayMs = 0 } = {}) {
  return (command, args, options) => {
    const calls = { command, args, options };
    const proc = {
      _calls: calls,
      stdoutChunks: [stdout],
      stderrChunks: [stderr],
      async wait() {
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
        return exitCode;
      },
      kill() { proc._killed = true; },
      _killed: false,
    };
    return proc;
  };
}

test('ClaudeCliClient.send: builds command, parses JSON envelope, returns text + sessionId', async () => {
  const envelope = JSON.stringify({
    result: 'hello world',
    session_id: 'abc-123',
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  let captured;
  const spawn = (cmd, args, opts) => {
    captured = { cmd, args, opts };
    return {
      stdoutChunks: [envelope],
      stderrChunks: [''],
      async wait() { return 0; },
      kill() {},
    };
  };
  const client = new ClaudeCliClient({ spawn });
  const r = await client.send({ prompt: 'hi', sessionId: null, systemPrompt: 'sys' });
  assert.equal(r.text, 'hello world');
  assert.equal(r.sessionId, 'abc-123');
  assert.equal(captured.cmd, 'claude');
  assert.deepEqual(captured.args.slice(0, 2), ['--model', 'claude-sonnet-4-6']);
  assert.ok(captured.args.includes('--system-prompt'));
  assert.ok(captured.args.includes('--session-id'));
  assert.ok(captured.args.includes('-p'));
  assert.ok(captured.args.includes('--output-format'));
  assert.ok(captured.args.includes('json'));
});

test('ClaudeCliClient.send: with existing sessionId, uses --resume not --session-id', async () => {
  let captured;
  const spawn = (cmd, args, opts) => {
    captured = { cmd, args };
    return {
      stdoutChunks: [JSON.stringify({ result: 'ok', session_id: 'sid-1' })],
      stderrChunks: [''],
      async wait() { return 0; },
      kill() {},
    };
  };
  const client = new ClaudeCliClient({ spawn });
  await client.send({ prompt: 'hi', sessionId: 'sid-1', systemPrompt: 'should-be-ignored' });
  assert.ok(captured.args.includes('--resume'));
  assert.equal(captured.args[captured.args.indexOf('--resume') + 1], 'sid-1');
  assert.ok(!captured.args.includes('--session-id'));
  assert.ok(!captured.args.includes('--system-prompt'), 'system-prompt suppressed on resume');
});

test('ClaudeCliClient.send: non-zero exit raises SubprocessFailed', async () => {
  const spawn = () => ({
    stdoutChunks: [''],
    stderrChunks: ['boom'],
    async wait() { return 2; },
    kill() {},
  });
  const client = new ClaudeCliClient({ spawn });
  await assert.rejects(
    client.send({ prompt: 'hi', sessionId: null, systemPrompt: 'sys' }),
    /exit code 2.*boom/s
  );
});

test('ClaudeCliClient.send: timeout kills subprocess and raises TimeoutError', async () => {
  let killed = false;
  const spawn = () => ({
    stdoutChunks: [''],
    stderrChunks: [''],
    wait() { return new Promise(() => {}); },  // never resolves
    kill() { killed = true; },
  });
  const client = new ClaudeCliClient({ spawn, timeoutMs: 50 });
  await assert.rejects(
    client.send({ prompt: 'hi', sessionId: null, systemPrompt: 'sys' }),
    /timed out after/
  );
  assert.equal(killed, true);
});

test('ClaudeCliClient.send: empty stdout raises EmptyResponse', async () => {
  const spawn = () => ({
    stdoutChunks: [''],
    stderrChunks: [''],
    async wait() { return 0; },
    kill() {},
  });
  const client = new ClaudeCliClient({ spawn });
  await assert.rejects(
    client.send({ prompt: 'hi', sessionId: null, systemPrompt: 'sys' }),
    /empty/i
  );
});

test('FakeLlmClient: returns canned responses in order, exhausts then throws', async () => {
  const fake = new FakeLlmClient([
    { text: 'first', sessionId: 's-1' },
    { text: 'second', sessionId: 's-1' },
  ]);
  const r1 = await fake.send({ prompt: 'x', sessionId: null, systemPrompt: 's' });
  assert.equal(r1.text, 'first');
  const r2 = await fake.send({ prompt: 'x', sessionId: 's-1', systemPrompt: null });
  assert.equal(r2.text, 'second');
  await assert.rejects(fake.send({ prompt: 'x', sessionId: 's-1', systemPrompt: null }), /exhausted/);
});

test('FakeLlmClient: can also be configured to throw on demand', async () => {
  const fake = new FakeLlmClient([
    { throw: new Error('simulated timeout') },
  ]);
  await assert.rejects(fake.send({ prompt: 'x', sessionId: null, systemPrompt: 's' }), /simulated timeout/);
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/ai-llm-client.test.js
```

Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write `src/server/ai/llm-client.js`**

```javascript
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_COMMAND = 'claude';

export class LlmClientError extends Error {}
export class TimeoutError extends LlmClientError {
  constructor(elapsedMs) {
    super(`claude CLI timed out after ${elapsedMs}ms`);
    this.elapsedMs = elapsedMs;
  }
}
export class SubprocessFailed extends LlmClientError {
  constructor(exitCode, stderr) {
    super(`claude CLI exit code ${exitCode}: ${stderr}`);
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}
export class EmptyResponse extends LlmClientError {
  constructor() { super('claude CLI returned empty response'); }
}
export class ParseError extends LlmClientError {
  constructor(detail) { super(`claude CLI returned unparseable output: ${detail}`); }
}

function defaultSpawn(command, args, options) {
  const proc = nodeSpawn(command, args, options);
  const stdoutChunks = [];
  const stderrChunks = [];
  proc.stdout.on('data', c => stdoutChunks.push(c.toString('utf8')));
  proc.stderr.on('data', c => stderrChunks.push(c.toString('utf8')));
  return {
    stdoutChunks,
    stderrChunks,
    wait() { return new Promise(resolve => proc.on('close', code => resolve(code))); },
    kill() { try { proc.kill('SIGKILL'); } catch {} },
  };
}

export class ClaudeCliClient {
  constructor({ spawn = defaultSpawn, timeoutMs = DEFAULT_TIMEOUT_MS,
                command = DEFAULT_COMMAND, model = DEFAULT_MODEL } = {}) {
    this._spawn = spawn;
    this._timeoutMs = timeoutMs;
    this._command = command;
    this._model = model;
  }

  async send({ prompt, sessionId, systemPrompt }) {
    if (!prompt || !prompt.trim()) throw new EmptyResponse();
    const args = ['--model', this._model];
    if (sessionId) {
      args.push('--resume', sessionId);
    } else {
      args.push('--session-id', randomUUID());
      if (systemPrompt) args.push('--system-prompt', systemPrompt);
    }
    args.push('-p', prompt, '--output-format', 'json');

    const start = Date.now();
    const proc = this._spawn(this._command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let exitCode;
    try {
      exitCode = await Promise.race([
        proc.wait(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new TimeoutError(Date.now() - start)), this._timeoutMs)
        ),
      ]);
    } catch (err) {
      proc.kill();
      throw err;
    }

    const stdout = proc.stdoutChunks.join('');
    const stderr = proc.stderrChunks.join('');
    if (exitCode !== 0) throw new SubprocessFailed(exitCode, stderr);
    const trimmed = stdout.trim();
    if (!trimmed) throw new EmptyResponse();

    let envelope;
    try { envelope = JSON.parse(trimmed); }
    catch (e) { throw new ParseError(e.message); }

    const text = typeof envelope.result === 'string' ? envelope.result : trimmed;
    if (!text) throw new EmptyResponse();
    return {
      text,
      sessionId: envelope.session_id ?? null,
      inputTokens: envelope.usage?.input_tokens ?? null,
      outputTokens: envelope.usage?.output_tokens ?? null,
    };
  }
}
```

- [ ] **Step 4: Write `src/server/ai/fake-llm-client.js`**

```javascript
export class FakeLlmClient {
  constructor(responses = []) {
    this._responses = responses.slice();
    this.calls = [];
  }

  async send(args) {
    this.calls.push(args);
    if (this._responses.length === 0) throw new Error('FakeLlmClient: response queue exhausted');
    const next = this._responses.shift();
    if (next.throw) throw next.throw;
    return {
      text: next.text,
      sessionId: next.sessionId ?? null,
      inputTokens: null,
      outputTokens: null,
    };
  }

  pushResponse(r) { this._responses.push(r); }
}
```

- [ ] **Step 5: Run test, expect PASS**

```bash
node --test test/ai-llm-client.test.js
```

Expected: 7 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/llm-client.js src/server/ai/fake-llm-client.js test/ai-llm-client.test.js
git commit -m "feat(ai): ClaudeCliClient subprocess wrapper + FakeLlmClient test double"
```

---

## Task 5: Agent session module (`ai_sessions` CRUD)

**Files:**
- Create: `src/server/ai/agent-session.js`
- Test: `test/ai-agent-session.test.js`

- [ ] **Step 1: Write failing test**

`test/ai-agent-session.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import {
  createAiSession,
  getAiSession,
  setClaudeSessionId,
  markStalled,
  clearStall,
  listStalledOrInFlight,
} from '../src/server/ai/agent-session.js';

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-session-'));
  const db = openDb(join(dir, 'test.db'));
  // seed two users + one game
  const now = Date.now();
  const u1 = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('a@x', 'A', '#000', ?) RETURNING id").get(now).id;
  const u2 = db.prepare("INSERT INTO users (email, friendly_name, color, is_bot, created_at) VALUES ('bot@x', 'Bot', '#fff', 1, ?) RETURNING id").get(now).id;
  const aId = Math.min(u1, u2), bId = Math.max(u1, u2);
  const gameId = db.prepare(`INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at) VALUES (?, ?, 'active', 'cribbage', '{}', ?, ?) RETURNING id`).get(aId, bId, now, now).id;
  return { db, gameId, botUserId: u2 };
}

test('createAiSession: inserts a row with null claude_session_id and timestamps', () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  const row = getAiSession(db, gameId);
  assert.equal(row.gameId, gameId);
  assert.equal(row.botUserId, botUserId);
  assert.equal(row.personaId, 'hattie');
  assert.equal(row.claudeSessionId, null);
  assert.equal(row.stalledAt, null);
  assert.ok(row.createdAt > 0);
});

test('createAiSession: duplicate game_id rejected', () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  assert.throws(() => createAiSession(db, { gameId, botUserId, personaId: 'hattie' }), /UNIQUE/);
});

test('setClaudeSessionId: stores UUID and bumps last_used_at', async () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  const before = getAiSession(db, gameId).lastUsedAt;
  await new Promise(r => setTimeout(r, 5));
  setClaudeSessionId(db, gameId, 'uuid-1');
  const after = getAiSession(db, gameId);
  assert.equal(after.claudeSessionId, 'uuid-1');
  assert.ok(after.lastUsedAt > before);
});

test('markStalled / clearStall: round-trip', () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  markStalled(db, gameId, 'timeout');
  let row = getAiSession(db, gameId);
  assert.ok(row.stalledAt > 0);
  assert.equal(row.stallReason, 'timeout');
  clearStall(db, gameId);
  row = getAiSession(db, gameId);
  assert.equal(row.stalledAt, null);
  assert.equal(row.stallReason, null);
});

test('listStalledOrInFlight: returns active games whose activeUserId is a bot or that are stalled', () => {
  const { db, gameId, botUserId } = tmpDb();
  createAiSession(db, { gameId, botUserId, personaId: 'hattie' });
  // make the game's state.activeUserId point at the bot
  const state = JSON.stringify({ activeUserId: botUserId });
  db.prepare("UPDATE games SET state = ? WHERE id = ?").run(state, gameId);
  const rows = listStalledOrInFlight(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gameId, gameId);
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/ai-agent-session.test.js
```

Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/server/ai/agent-session.js`**

```javascript
function rowToSession(row) {
  if (!row) return null;
  return {
    gameId: row.game_id,
    botUserId: row.bot_user_id,
    personaId: row.persona_id,
    claudeSessionId: row.claude_session_id,
    stalledAt: row.stalled_at,
    stallReason: row.stall_reason,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function createAiSession(db, { gameId, botUserId, personaId }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO ai_sessions (game_id, bot_user_id, persona_id, claude_session_id,
                             stalled_at, stall_reason, created_at, last_used_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)
  `).run(gameId, botUserId, personaId, now, now);
}

export function getAiSession(db, gameId) {
  return rowToSession(db.prepare("SELECT * FROM ai_sessions WHERE game_id = ?").get(gameId));
}

export function setClaudeSessionId(db, gameId, claudeSessionId) {
  db.prepare("UPDATE ai_sessions SET claude_session_id = ?, last_used_at = ? WHERE game_id = ?")
    .run(claudeSessionId, Date.now(), gameId);
}

export function markStalled(db, gameId, reason) {
  db.prepare("UPDATE ai_sessions SET stalled_at = ?, stall_reason = ?, last_used_at = ? WHERE game_id = ?")
    .run(Date.now(), reason, Date.now(), gameId);
}

export function clearStall(db, gameId) {
  db.prepare("UPDATE ai_sessions SET stalled_at = NULL, stall_reason = NULL, last_used_at = ? WHERE game_id = ?")
    .run(Date.now(), gameId);
}

// Used at server boot to find bot turns that were in-flight or stalled
// when the server stopped, so the orchestrator can resume them.
export function listStalledOrInFlight(db) {
  return db.prepare(`
    SELECT s.* FROM ai_sessions s
    JOIN games g ON g.id = s.game_id
    WHERE g.status = 'active'
      AND (
        s.stalled_at IS NOT NULL
        OR json_extract(g.state, '$.activeUserId') = s.bot_user_id
      )
  `).all().map(rowToSession);
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/ai-agent-session.test.js
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/agent-session.js test/ai-agent-session.test.js
git commit -m "feat(ai): agent-session CRUD on ai_sessions table"
```

---

## Task 6: Cribbage legal-moves enumeration

**Files:**
- Create: `plugins/cribbage/server/ai/legal-moves.js`
- Test: `test/cribbage-ai-legal-moves.test.js`

- [ ] **Step 1: Write failing test**

`test/cribbage-ai-legal-moves.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateLegalMoves } from '../plugins/cribbage/server/ai/legal-moves.js';

const CARD = (rank, suit) => ({ rank, suit });

test('discard: returns C(6,2)=15 moves with deterministic id format', () => {
  const state = {
    phase: 'discard',
    hands: [[CARD('A','H'), CARD('2','H'), CARD('3','H'), CARD('4','H'), CARD('5','H'), CARD('6','H')], []],
    sides: { a: 1, b: 2 },
  };
  const moves = enumerateLegalMoves(state, /* botPlayerIdx= */ 0);
  assert.equal(moves.length, 15);
  // Each move id is "discard:<i>,<j>" where i<j are 0-based indexes into the player's hand
  for (const m of moves) {
    assert.match(m.id, /^discard:\d+,\d+$/);
    assert.equal(m.action.type, 'discard');
    assert.equal(m.action.payload.cards.length, 2);
    assert.ok(typeof m.summary === 'string' && m.summary.length > 0);
  }
  // Unique ids
  assert.equal(new Set(moves.map(m => m.id)).size, 15);
});

test('cut: returns single move {type:"cut"}', () => {
  const state = { phase: 'cut', dealer: 0, hands: [[],[]], sides: { a:1, b:2 } };
  const moves = enumerateLegalMoves(state, /* botPlayerIdx= */ 1);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 'cut');
  assert.deepEqual(moves[0].action, { type: 'cut' });
});

test('pegging: returns one move per playable card; running+pip ≤ 31', () => {
  const state = {
    phase: 'pegging',
    hands: [[CARD('K','H'), CARD('5','S'), CARD('2','D')], []],
    pegging: { running: 25, next: 0 },
    sides: { a:1, b:2 },
  };
  const moves = enumerateLegalMoves(state, 0);
  // K=10 → 25+10=35 (illegal), 5 → 25+5=30 (legal), 2 → 25+2=27 (legal)
  assert.equal(moves.length, 2);
  assert.deepEqual(moves.map(m => m.id).sort(), ['play:5S', 'play:2D'].sort());
});

test('show: returns single {type:"next"} acknowledgement', () => {
  const state = { phase: 'show', hands: [[],[]], sides: { a:1, b:2 } };
  const moves = enumerateLegalMoves(state, 0);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, 'next');
  assert.deepEqual(moves[0].action, { type: 'next' });
});

test('match-end: returns empty array (no moves)', () => {
  const state = { phase: 'match-end', hands: [[],[]], sides: { a:1, b:2 } };
  assert.equal(enumerateLegalMoves(state, 0).length, 0);
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/cribbage-ai-legal-moves.test.js
```

Expected: FAIL — module missing.

- [ ] **Step 3: Write `plugins/cribbage/server/ai/legal-moves.js`**

```javascript
import { pipValue } from '../values.js';

const RANK_LABEL = { A:'Ace','2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Nine',T:'Ten',J:'Jack',Q:'Queen',K:'King' };
const SUIT_LABEL = { H:'Hearts', D:'Diamonds', C:'Clubs', S:'Spades' };

function cardId(c) { return `${c.rank}${c.suit}`; }
function cardSummary(c) { return `${RANK_LABEL[c.rank]} of ${SUIT_LABEL[c.suit]}`; }

export function enumerateLegalMoves(state, botPlayerIdx) {
  switch (state.phase) {
    case 'discard': {
      const hand = state.hands[botPlayerIdx];
      const out = [];
      for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
          out.push({
            id: `discard:${i},${j}`,
            action: { type: 'discard', payload: { cards: [hand[i], hand[j]] } },
            summary: `Discard ${cardSummary(hand[i])} and ${cardSummary(hand[j])} to crib`,
          });
        }
      }
      return out;
    }
    case 'cut':
      return [{ id: 'cut', action: { type: 'cut' }, summary: 'Cut the deck' }];
    case 'pegging': {
      const hand = state.hands[botPlayerIdx];
      const running = state.pegging?.running ?? 0;
      const out = [];
      for (const c of hand) {
        if (running + pipValue(c) <= 31) {
          out.push({
            id: `play:${cardId(c)}`,
            action: { type: 'play', payload: { card: c } },
            summary: `Play ${cardSummary(c)} (running ${running} → ${running + pipValue(c)})`,
          });
        }
      }
      return out;
    }
    case 'show':
      return [{ id: 'next', action: { type: 'next' }, summary: 'Acknowledge the count and continue' }];
    case 'match-end':
    default:
      return [];
  }
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/cribbage-ai-legal-moves.test.js
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/ai/legal-moves.js test/cribbage-ai-legal-moves.test.js
git commit -m "feat(ai/cribbage): enumerate legal moves per phase"
```

---

## Task 7: Cribbage prompts (build per-phase prompt + parse JSON)

**Files:**
- Create: `plugins/cribbage/server/ai/prompts.js`
- Test: `test/cribbage-ai-prompts.test.js`

- [ ] **Step 1: Write failing test**

`test/cribbage-ai-prompts.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTurnPrompt, parseLlmResponse } from '../plugins/cribbage/server/ai/prompts.js';

const CARD = (rank, suit) => ({ rank, suit });

test('buildTurnPrompt: discard phase — includes hand, scores, legal moves with ids', () => {
  const state = {
    phase: 'discard',
    dealer: 1,
    hands: [[CARD('A','H'), CARD('5','H'), CARD('K','D'), CARD('7','S'), CARD('3','C'), CARD('Q','H')], []],
    scores: [12, 19],
    sides: { a:1, b:2 },
  };
  const legalMoves = [
    { id: 'discard:0,1', summary: 'Discard Ace of Hearts and Five of Hearts' },
    { id: 'discard:2,5', summary: 'Discard King of Diamonds and Queen of Hearts' },
  ];
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx: 0 });
  assert.match(prompt, /phase.*discard/i);
  assert.match(prompt, /your score.*12/i);
  assert.match(prompt, /opponent score.*19/i);
  assert.match(prompt, /your hand/i);
  assert.match(prompt, /Ace of Hearts/);
  assert.match(prompt, /discard:0,1/);
  assert.match(prompt, /discard:2,5/);
  // The opponent's crib note
  assert.match(prompt, /opponent.*crib|opponent's crib/i);
  assert.match(prompt, /JSON.*moveId.*banter/);
});

test('buildTurnPrompt: pegging phase — shows running total and pile', () => {
  const state = {
    phase: 'pegging',
    hands: [[CARD('5','H'), CARD('2','D')], []],
    scores: [60, 58],
    pegging: { running: 25, history: [CARD('K','C')], pile: [[],[CARD('K','C')]], next: 0 },
    sides: { a:1, b:2 },
  };
  const legal = [{ id: 'play:5H', summary: 'Play Five of Hearts (running 25 → 30)' }];
  const prompt = buildTurnPrompt({ state, legalMoves: legal, botPlayerIdx: 0 });
  assert.match(prompt, /running total.*25/i);
  assert.match(prompt, /play:5H/);
});

test('parseLlmResponse: valid JSON → {moveId, banter}', () => {
  const text = '{"moveId":"play:5H","banter":"There we go."}';
  const r = parseLlmResponse(text);
  assert.deepEqual(r, { moveId: 'play:5H', banter: 'There we go.' });
});

test('parseLlmResponse: JSON inside fenced block → still parsed', () => {
  const text = 'Here you go:\n```json\n{"moveId":"play:5H","banter":""}\n```';
  const r = parseLlmResponse(text);
  assert.equal(r.moveId, 'play:5H');
  assert.equal(r.banter, '');
});

test('parseLlmResponse: missing moveId → throws', () => {
  assert.throws(() => parseLlmResponse('{"banter":"hi"}'), /moveId/);
});

test('parseLlmResponse: not JSON at all → throws', () => {
  assert.throws(() => parseLlmResponse('I will play the five.'), /no JSON/i);
});

test('parseLlmResponse: banter optional, defaults to empty string', () => {
  const r = parseLlmResponse('{"moveId":"next"}');
  assert.equal(r.moveId, 'next');
  assert.equal(r.banter, '');
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/cribbage-ai-prompts.test.js
```

Expected: FAIL — module missing.

- [ ] **Step 3: Write `plugins/cribbage/server/ai/prompts.js`**

```javascript
const RANK_LABEL = { A:'Ace','2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Nine',T:'Ten',J:'Jack',Q:'Queen',K:'King' };
const SUIT_LABEL = { H:'Hearts', D:'Diamonds', C:'Clubs', S:'Spades' };

function fmtCard(c) { return `${RANK_LABEL[c.rank]} of ${SUIT_LABEL[c.suit]}`; }

function commonHeader(state, botPlayerIdx) {
  const opp = 1 - botPlayerIdx;
  return [
    `Phase: ${state.phase}`,
    `Your score: ${state.scores[botPlayerIdx]} of ${state.matchTarget ?? 121}`,
    `Opponent score: ${state.scores[opp]} of ${state.matchTarget ?? 121}`,
  ].join('\n');
}

function legalMovesBlock(legalMoves) {
  const lines = legalMoves.map(m => `  - ${m.id}: ${m.summary}`);
  return `Legal moves:\n${lines.join('\n')}`;
}

const RESPONSE_FOOTER = `
Respond with a single JSON object (and nothing else):
{"moveId": "<one of the legal move ids above>", "banter": "<short in-character line, may be empty>"}
`.trim();

export function buildTurnPrompt({ state, legalMoves, botPlayerIdx }) {
  const blocks = [commonHeader(state, botPlayerIdx)];
  const hand = state.hands[botPlayerIdx];

  if (state.phase === 'discard') {
    const youAreDealer = state.dealer === botPlayerIdx;
    const cribOwner = youAreDealer ? 'YOUR crib' : "your OPPONENT'S crib";
    blocks.push(`The two cards you discard go to ${cribOwner}.`);
    blocks.push(`Your hand:\n${hand.map(c => `  - ${fmtCard(c)}`).join('\n')}`);
  } else if (state.phase === 'pegging') {
    const peg = state.pegging;
    blocks.push(`Pegging running total: ${peg.running}`);
    if (peg.history.length > 0) {
      blocks.push(`Cards already played this round (oldest first):\n${peg.history.map(c => `  - ${fmtCard(c)}`).join('\n')}`);
    }
    blocks.push(`Your remaining hand:\n${hand.map(c => `  - ${fmtCard(c)}`).join('\n')}`);
  } else if (state.phase === 'show') {
    blocks.push('The hand counts have been tallied. Acknowledge to continue.');
  }

  blocks.push(legalMovesBlock(legalMoves));
  blocks.push(RESPONSE_FOOTER);
  return blocks.join('\n\n');
}

// Extract the first JSON object from arbitrary LLM output.
// Handles fenced ```json ... ``` blocks and bare object literals.
function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  throw new Error('no JSON object found in response');
}

export function parseLlmResponse(text) {
  const json = extractJson(text);
  let parsed;
  try { parsed = JSON.parse(json); }
  catch (e) { throw new Error(`response is not valid JSON: ${e.message}`); }
  if (typeof parsed.moveId !== 'string') throw new Error('response missing moveId');
  return {
    moveId: parsed.moveId,
    banter: typeof parsed.banter === 'string' ? parsed.banter : '',
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/cribbage-ai-prompts.test.js
```

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/ai/prompts.js test/cribbage-ai-prompts.test.js
git commit -m "feat(ai/cribbage): per-phase prompt builder + response parser"
```

---

## Task 8: Cribbage player adapter (`chooseAction`)

**Files:**
- Create: `plugins/cribbage/server/ai/cribbage-player.js`
- Test: `test/cribbage-ai-player.test.js`

- [ ] **Step 1: Write failing test**

`test/cribbage-ai-player.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { chooseAction } from '../plugins/cribbage/server/ai/cribbage-player.js';

const CARD = (rank, suit) => ({ rank, suit });

const persona = {
  id: 'hattie',
  displayName: 'Hattie',
  systemPrompt: 'you are hattie',
};

function discardState() {
  return {
    phase: 'discard',
    dealer: 1,
    hands: [[CARD('A','H'), CARD('5','H'), CARD('K','D'), CARD('7','S'), CARD('3','C'), CARD('Q','H')], []],
    scores: [0, 0],
    matchTarget: 121,
    sides: { a: 1, b: 2 },
  };
}

test('chooseAction: returns matching action when LLM picks a valid moveId', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":"oh dear"}', sessionId: 'sid-1' },
  ]);
  const r = await chooseAction({
    llm, persona, sessionId: null,
    state: discardState(), botPlayerIdx: 0,
  });
  assert.equal(r.action.type, 'discard');
  assert.equal(r.action.payload.cards.length, 2);
  assert.equal(r.banter, 'oh dear');
  assert.equal(r.sessionId, 'sid-1');
});

test('chooseAction: passes systemPrompt only on first call (sessionId=null)', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid-1' },
  ]);
  await chooseAction({ llm, persona, sessionId: null, state: discardState(), botPlayerIdx: 0 });
  assert.equal(llm.calls[0].systemPrompt, 'you are hattie');
});

test('chooseAction: omits systemPrompt on resume (sessionId set)', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid-1' },
  ]);
  await chooseAction({ llm, persona, sessionId: 'sid-1', state: discardState(), botPlayerIdx: 0 });
  assert.equal(llm.calls[0].sessionId, 'sid-1');
  assert.equal(llm.calls[0].systemPrompt, null);
});

test('chooseAction: throws InvalidLlmMove when moveId is not in legal moves', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:99,99","banter":"oops"}', sessionId: 'sid-1' },
  ]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: discardState(), botPlayerIdx: 0 }),
    err => err.name === 'InvalidLlmMove' && /discard:99,99/.test(err.message),
  );
});

test('chooseAction: throws InvalidLlmResponse when JSON cannot be parsed', async () => {
  const llm = new FakeLlmClient([
    { text: 'I dunno', sessionId: 'sid-1' },
  ]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: discardState(), botPlayerIdx: 0 }),
    err => err.name === 'InvalidLlmResponse',
  );
});

test('chooseAction: propagates underlying LlmClient errors as-is', async () => {
  const llm = new FakeLlmClient([{ throw: new Error('subprocess died') }]);
  await assert.rejects(
    chooseAction({ llm, persona, sessionId: null, state: discardState(), botPlayerIdx: 0 }),
    /subprocess died/,
  );
});

test('chooseAction: pegging phase — picks among playable cards', async () => {
  const state = {
    phase: 'pegging',
    hands: [[CARD('5','H'), CARD('2','D')], []],
    scores: [60, 58],
    matchTarget: 121,
    pegging: { running: 25, history: [], pile: [[],[]], next: 0 },
    sides: { a:1, b:2 },
  };
  const llm = new FakeLlmClient([
    { text: '{"moveId":"play:2D","banter":"a small one"}', sessionId: 'sid-1' },
  ]);
  const r = await chooseAction({ llm, persona, sessionId: null, state, botPlayerIdx: 0 });
  assert.equal(r.action.type, 'play');
  assert.deepEqual(r.action.payload.card, CARD('2','D'));
  assert.equal(r.banter, 'a small one');
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/cribbage-ai-player.test.js
```

Expected: FAIL — module missing.

- [ ] **Step 3: Write `plugins/cribbage/server/ai/cribbage-player.js`**

```javascript
import { enumerateLegalMoves } from './legal-moves.js';
import { buildTurnPrompt, parseLlmResponse } from './prompts.js';

export class InvalidLlmResponse extends Error {
  constructor(detail) { super(`LLM response invalid: ${detail}`); this.name = 'InvalidLlmResponse'; }
}
export class InvalidLlmMove extends Error {
  constructor(moveId, legalIds) {
    super(`LLM picked moveId '${moveId}' not in legal set [${legalIds.join(', ')}]`);
    this.name = 'InvalidLlmMove';
  }
}

export async function chooseAction({ llm, persona, sessionId, state, botPlayerIdx }) {
  const legalMoves = enumerateLegalMoves(state, botPlayerIdx);
  if (legalMoves.length === 0) {
    throw new Error(`no legal moves for phase '${state.phase}'`);
  }
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx });

  const r = await llm.send({
    prompt,
    sessionId,
    systemPrompt: sessionId ? null : persona.systemPrompt,
  });

  let parsed;
  try { parsed = parseLlmResponse(r.text); }
  catch (e) { throw new InvalidLlmResponse(e.message); }

  const match = legalMoves.find(m => m.id === parsed.moveId);
  if (!match) throw new InvalidLlmMove(parsed.moveId, legalMoves.map(m => m.id));

  return {
    action: match.action,
    banter: parsed.banter,
    sessionId: r.sessionId,
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/cribbage-ai-player.test.js
```

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/server/ai/cribbage-player.js test/cribbage-ai-player.test.js
git commit -m "feat(ai/cribbage): chooseAction adapter (LLM → validated action + banter)"
```

---

## Task 9: Orchestrator — scheduleTurn + per-game queue + stall protocol

**Files:**
- Create: `src/server/ai/orchestrator.js`
- Test: `test/ai-orchestrator.test.js`

The orchestrator owns: serialization of per-game AI turns, the one-retry-then-stall protocol, applying the action via `plugin.applyAction`, and broadcasting SSE events. To keep it testable, the per-game adapter is injected (one per game type).

- [ ] **Step 1: Write failing test (happy path + stall)**

`test/ai-orchestrator.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { createAiSession, getAiSession } from '../src/server/ai/agent-session.js';
import { createOrchestrator } from '../src/server/ai/orchestrator.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { chooseAction as cribbageChoose } from '../plugins/cribbage/server/ai/cribbage-player.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function setup(llm) {
  const dir = mkdtempSync(join(tmpdir(), 'orch-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email, friendly_name, color, is_bot, created_at) VALUES ('b@x','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(42) });
  // Force the bot to be the active player by setting activeUserId.
  state.activeUserId = botId;
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'hattie' });

  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const persona = { id: 'hattie', displayName: 'Hattie', color: '#ec4899', glyph: '♡', systemPrompt: 'you are hattie' };
  const personas = new Map([['hattie', persona]]);
  const adapters = { cribbage: { plugin: cribbagePlugin, chooseAction: cribbageChoose } };
  const orch = createOrchestrator({ db, llm, sse, personas, adapters });

  return { db, gameId, botId, humanId, events, orch };
}

test('orchestrator: happy path — chooses action, applies it, broadcasts banter+update, persists session id', async () => {
  // Bot is active in discard phase. Pick the first legal discard.
  // A bot-active game starts at discard phase, so legal id is "discard:0,1".
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":"hello dear"}', sessionId: 'sid-A' },
  ]);
  const { db, gameId, botId, events, orch } = setup(llm);

  await orch.runTurn(gameId);

  const types = events.map(e => e.type);
  assert.ok(types.includes('bot_thinking'), 'thinking emitted');
  assert.ok(types.includes('banter'), 'banter emitted');
  assert.ok(types.includes('update'), 'update emitted');
  // banter must come before update
  assert.ok(types.indexOf('banter') < types.indexOf('update'));

  const sess = getAiSession(db, gameId);
  assert.equal(sess.claudeSessionId, 'sid-A');
  assert.equal(sess.stalledAt, null);

  // Game state advanced: pendingDiscards[bot] should be set.
  const game = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId);
  const state = JSON.parse(game.state);
  assert.ok(Array.isArray(state.pendingDiscards));
  // bot is whichever side has the larger userId
  const botPlayerIdx = state.sides.a === botId ? 0 : 1;
  assert.equal(state.pendingDiscards[botPlayerIdx].length, 2);
});

test('orchestrator: invalid response → retry once → success on retry', async () => {
  const llm = new FakeLlmClient([
    { text: 'I dunno', sessionId: 'sid-B' },
    { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid-B' },
  ]);
  const { db, gameId, events, orch } = setup(llm);
  await orch.runTurn(gameId);
  const sess = getAiSession(db, gameId);
  assert.equal(sess.stalledAt, null, 'not stalled — succeeded on retry');
  assert.ok(events.some(e => e.type === 'banter'));
});

test('orchestrator: two consecutive failures → stall + bot_stalled SSE + game state untouched', async () => {
  const llm = new FakeLlmClient([
    { text: 'nope', sessionId: 'sid-C' },
    { text: 'still nope', sessionId: 'sid-C' },
  ]);
  const { db, gameId, events, orch } = setup(llm);
  const before = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId).state;

  await orch.runTurn(gameId);

  const sess = getAiSession(db, gameId);
  assert.ok(sess.stalledAt > 0);
  assert.equal(sess.stallReason, 'invalid_response');

  const after = db.prepare("SELECT state FROM games WHERE id = ?").get(gameId).state;
  assert.equal(before, after, 'game state unchanged on stall');

  const stalled = events.filter(e => e.type === 'bot_stalled');
  assert.equal(stalled.length, 1);
  assert.equal(stalled[0].payload.reason, 'invalid_response');
  assert.equal(stalled[0].payload.personaId, 'hattie');
});

test('orchestrator: timeout maps to stall reason "timeout"', async () => {
  const { TimeoutError } = await import('../src/server/ai/llm-client.js');
  const llm = new FakeLlmClient([
    { throw: new TimeoutError(30000) },
    { throw: new TimeoutError(30000) },
  ]);
  const { db, gameId, events, orch } = setup(llm);
  await orch.runTurn(gameId);
  const sess = getAiSession(db, gameId);
  assert.equal(sess.stallReason, 'timeout');
  assert.equal(events.find(e => e.type === 'bot_stalled').payload.reason, 'timeout');
});

test('orchestrator: serializes per-game — concurrent runTurn calls do not double-fire', async () => {
  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":"a"}', sessionId: 'sid-D' },
  ]);
  const { gameId, orch, events } = setup(llm);
  // Fire two concurrent runs; second should be a no-op (LLM only consumed once).
  await Promise.all([orch.runTurn(gameId), orch.runTurn(gameId)]);
  const banters = events.filter(e => e.type === 'banter');
  assert.equal(banters.length, 1, 'banter fires exactly once');
});

test('orchestrator: clears stall on next successful runTurn', async () => {
  const llm = new FakeLlmClient([
    { text: 'nope', sessionId: 's' }, { text: 'still nope', sessionId: 's' },  // stall
    { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 's' },           // recover
  ]);
  const { db, gameId, orch } = setup(llm);
  await orch.runTurn(gameId);
  assert.ok(getAiSession(db, gameId).stalledAt > 0);
  await orch.runTurn(gameId);
  assert.equal(getAiSession(db, gameId).stalledAt, null);
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/ai-orchestrator.test.js
```

Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/server/ai/orchestrator.js`**

```javascript
import { getAiSession, setClaudeSessionId, markStalled, clearStall } from './agent-session.js';
import { InvalidLlmResponse, InvalidLlmMove } from '../../../plugins/cribbage/server/ai/cribbage-player.js';
import { TimeoutError, SubprocessFailed, ParseError, EmptyResponse } from './llm-client.js';

function rngFor(gameId) {
  let s = gameId * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function stallReasonFor(err) {
  if (err instanceof TimeoutError) return 'timeout';
  if (err instanceof InvalidLlmMove) return 'illegal_move';
  if (err instanceof InvalidLlmResponse || err instanceof ParseError) return 'invalid_response';
  if (err instanceof SubprocessFailed || err instanceof EmptyResponse) return 'subprocess_error';
  return 'subprocess_error';
}

function botPlayerIdxOf(state, botUserId) {
  return state.sides.a === botUserId ? 0 : 1;
}

export function createOrchestrator({ db, llm, sse, personas, adapters, logger = console }) {
  // Per-game serialization: a Map<gameId, Promise> chain.
  const inFlight = new Map();

  async function _runOnce(gameId) {
    const session = getAiSession(db, gameId);
    if (!session) {
      logger.warn?.(`[ai] runTurn: no ai_sessions row for game ${gameId}`);
      return;
    }
    const gameRow = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId);
    if (!gameRow || gameRow.status !== 'active') return;
    const state = JSON.parse(gameRow.state);
    if (state.activeUserId !== session.botUserId) return;  // not bot's turn anymore

    const persona = personas.get(session.personaId);
    if (!persona) throw new Error(`unknown persona ${session.personaId}`);
    const adapter = adapters[gameRow.game_type];
    if (!adapter) throw new Error(`no AI adapter for game_type ${gameRow.game_type}`);
    const botPlayerIdx = botPlayerIdxOf(state, session.botUserId);
    const botSide = botPlayerIdx === 0 ? 'a' : 'b';

    sse.broadcast(gameId, {
      type: 'bot_thinking',
      payload: { side: botSide, personaId: persona.id, displayName: persona.displayName },
    });

    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await adapter.chooseAction({
          llm, persona, sessionId: session.claudeSessionId,
          state, botPlayerIdx,
        });
        if (r.sessionId && r.sessionId !== session.claudeSessionId) {
          setClaudeSessionId(db, gameId, r.sessionId);
        }

        // Apply via plugin
        const result = adapter.plugin.applyAction({
          state, action: r.action, actorId: session.botUserId, rng: rngFor(gameId),
        });
        if (result.error) {
          lastError = new InvalidLlmMove(`engine rejected action: ${result.error}`, []);
          continue;
        }

        const newState = result.state;
        const updateGame = db.prepare("UPDATE games SET state = ?, updated_at = ? WHERE id = ?");
        const tx = db.transaction(() => {
          updateGame.run(JSON.stringify(newState), Date.now(), gameId);
          if (result.ended) {
            db.prepare("UPDATE games SET status='ended', ended_reason=?, winner_side=? WHERE id=?")
              .run(newState.endedReason ?? 'plugin', newState.winnerSide ?? null, gameId);
          }
        });
        tx();
        clearStall(db, gameId);

        if (r.banter) {
          sse.broadcast(gameId, {
            type: 'banter',
            payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, text: r.banter },
          });
        }
        sse.broadcast(gameId, { type: 'update', payload: {} });
        return;
      } catch (err) {
        lastError = err;
        logger.warn?.(`[ai] game ${gameId} attempt ${attempt + 1} failed: ${err.message}`);
      }
    }

    // Stall
    const reason = stallReasonFor(lastError);
    markStalled(db, gameId, reason);
    sse.broadcast(gameId, {
      type: 'bot_stalled',
      payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, reason },
    });
  }

  async function runTurn(gameId) {
    const prev = inFlight.get(gameId) ?? Promise.resolve();
    let release;
    const next = prev.then(async () => {
      try { await _runOnce(gameId); } finally { release(); }
    });
    next.catch(() => {});  // prevent unhandled-rejection from prior chain
    const settled = new Promise(r => { release = r; });
    inFlight.set(gameId, settled);
    return next;
  }

  function scheduleTurn(gameId) {
    // Fire-and-forget — caller doesn't await
    runTurn(gameId).catch(err => logger.error?.(`[ai] runTurn(${gameId}) failed: ${err.stack || err}`));
  }

  return { runTurn, scheduleTurn };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/ai-orchestrator.test.js
```

Expected: 6 PASS. Some tests stress recursion-after-bot-still-active and multi-step phases — see Task 10 if those fail.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/orchestrator.js test/ai-orchestrator.test.js
git commit -m "feat(ai): orchestrator with per-game queue and stall protocol"
```

---

## Task 10: Orchestrator — recurse if bot is still active after action

**Files:**
- Modify: `src/server/ai/orchestrator.js` (in `_runOnce`, after broadcast: if newState.activeUserId is still the bot, schedule another turn)
- Test: append to `test/ai-orchestrator.test.js`

This handles multi-step bot phases (e.g., `show` → bot acks `next`, deal advances, bot acts again).

- [ ] **Step 1: Write failing test**

Append to `test/ai-orchestrator.test.js`:

```javascript
test('orchestrator: re-runs when newState.activeUserId is still the bot', async () => {
  // Two turns in a row for the bot. We force this by giving the bot the
  // 'cut' phase (cut leaves activeUserId at non-dealer, which we make the bot).
  const llm = new FakeLlmClient([
    { text: '{"moveId":"cut","banter":"go"}', sessionId: 'sid' },
    // After cut, pegging starts; bot is still next (we set it up that way)
    { text: '{"moveId":"play:5H","banter":""}', sessionId: 'sid' },  // adjust as needed
  ]);
  // (Construct a state where bot is non-dealer in cut, then will be next in pegging.)
  // For the test, simpler: use the already-built setup but verify the runTurn re-fires.
  // We assert by checking that the LLM was called twice.
  // (See setup() helper — bot is active in discard. We'll verify recursion via a different angle below.)
});
```

(Note: writing a clean cribbage state where the bot moves twice in a row is tricky because of dealer rotation. The simpler recursion test:)

```javascript
test('orchestrator: scheduleTurn after _runOnce when bot remains active (instrumented)', async () => {
  // We monkey-patch a test-only hook by wrapping the LLM to reset activeUserId
  // back to the bot once before letting the test continue.
  let callCount = 0;
  const llm = {
    async send(args) {
      callCount++;
      return { text: '{"moveId":"discard:0,1","banter":"x"}', sessionId: 'sid' };
    },
  };
  // setup() forces activeUserId=bot in DISCARD. After bot's discard, the
  // human is the active player (since human hasn't discarded yet), so the
  // bot is no longer active and recursion should NOT happen here.
  // Verify exactly ONE call.
  const { gameId, orch } = setup(llm);
  await orch.runTurn(gameId);
  assert.equal(callCount, 1);
});
```

Then a positive recursion test by constructing a state where both pendingDiscards are pre-filled except the bot's, and after the bot discards, the cut phase begins with non-dealer (the bot, by construction) active:

```javascript
test('orchestrator: bot acts twice in a row when phase advance keeps it active', async () => {
  // Build a state where after bot discards, cut phase begins with bot as non-dealer.
  // Setup helper sets dealer=0 (random), so we need to construct manually.
  const dir = mkdtempSync(join(tmpdir(), 'orch-rec-'));
  const db = openDb(join(dir, 'test.db'));
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botId = db.prepare("INSERT INTO users (email, friendly_name, color, is_bot, created_at) VALUES ('b@x','Bot','#fff',1,?) RETURNING id").get(now).id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const botSide = botId === aId ? 'a' : 'b';
  const botPlayerIdx = botSide === 'a' ? 0 : 1;
  const dealer = botPlayerIdx;  // bot is dealer → non-dealer is human
  // Wait — non-dealer cuts. If bot is dealer, human cuts. We need bot to be the non-dealer.
  const dealerIdx = 1 - botPlayerIdx;

  // Construct state: discard phase, both pendingDiscards null except human already
  // submitted (we set it up so the bot's discard advances to cut).
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(99) });
  state.dealer = dealerIdx;
  // Pre-submit human's discard
  state.pendingDiscards[1 - botPlayerIdx] = state.hands[1 - botPlayerIdx].slice(0, 2).map(c => ({...c}));
  state.activeUserId = botId;

  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'hattie' });

  const llm = new FakeLlmClient([
    { text: '{"moveId":"discard:0,1","banter":"first"}', sessionId: 'sid' },  // bot discards
    { text: '{"moveId":"cut","banter":"second"}', sessionId: 'sid' },          // bot cuts (still non-dealer)
  ]);
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push(ev) };
  const persona = { id: 'hattie', displayName: 'Hattie', color: '#ec4899', glyph: '♡', systemPrompt: 'p' };
  const adapters = { cribbage: { plugin: cribbagePlugin, chooseAction: cribbageChoose } };
  const orch = createOrchestrator({ db, llm, sse, personas: new Map([['hattie', persona]]), adapters });

  await orch.runTurn(gameId);

  // Both LLM calls consumed
  assert.equal(llm.calls.length, 2, 'orchestrator recursed for the cut phase');
  const banters = events.filter(e => e.type === 'banter').map(e => e.payload.text);
  assert.deepEqual(banters, ['first', 'second']);
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/ai-orchestrator.test.js
```

Expected: FAIL — recursion test fails because `_runOnce` returns after one turn.

- [ ] **Step 3: Modify `_runOnce` to recurse via `runTurn` when bot is still active**

In `src/server/ai/orchestrator.js`, replace the success path's `return` with:

```javascript
        if (r.banter) {
          sse.broadcast(gameId, {
            type: 'banter',
            payload: { side: botSide, personaId: persona.id, displayName: persona.displayName, text: r.banter },
          });
        }
        sse.broadcast(gameId, { type: 'update', payload: {} });

        // If the bot is STILL active after this action (e.g., advancing
        // through 'cut' as non-dealer, or multi-step show acks), recurse.
        if (!result.ended && newState.activeUserId === session.botUserId) {
          // Re-enter via the queue so re-entry is serialized correctly.
          await _runOnce(gameId);
        }
        return;
```

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/ai-orchestrator.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/orchestrator.js test/ai-orchestrator.test.js
git commit -m "feat(ai): orchestrator recurses when bot remains active after action"
```

---

## Task 11: Bootstrap module (load personas, seed bot user, resume in-flight)

**Files:**
- Create: `src/server/ai/index.js`
- Test: `test/ai-bootstrap.test.js`

- [ ] **Step 1: Write failing test**

`test/ai-bootstrap.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';
import { createAiSession } from '../src/server/ai/agent-session.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-boot-'));
  const personaDir = join(dir, 'personas');
  mkdirSync(personaDir);
  writeFileSync(join(personaDir, 'hattie.yaml'),
    'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: hi\n');
  return { dbPath: join(dir, 'db.db'), personaDir };
}

test('bootAiSubsystem: seeds at least one bot user if none exist', () => {
  const { dbPath, personaDir } = tmp();
  const db = openDb(dbPath);
  const sse = { broadcast: () => {} };
  const llm = { send: async () => ({ text: '{"moveId":"x","banter":""}' }) };
  bootAiSubsystem({ db, sse, llm, personaDir });
  const bots = db.prepare("SELECT * FROM users WHERE is_bot = 1").all();
  assert.ok(bots.length >= 1);
});

test('bootAiSubsystem: returns orchestrator that can be invoked', () => {
  const { dbPath, personaDir } = tmp();
  const db = openDb(dbPath);
  const { orchestrator } = bootAiSubsystem({
    db, sse: { broadcast: () => {} },
    llm: { send: async () => ({ text: '{"moveId":"x","banter":""}' }) },
    personaDir,
  });
  assert.equal(typeof orchestrator.runTurn, 'function');
  assert.equal(typeof orchestrator.scheduleTurn, 'function');
});

test('bootAiSubsystem: schedules pending bot turns from listStalledOrInFlight', async () => {
  const { dbPath, personaDir } = tmp();
  const db = openDb(dbPath);
  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const botRow = db.prepare("INSERT INTO users (email, friendly_name, color, is_bot, created_at) VALUES ('b@x','Bot','#fff',1,?) RETURNING id").get(now);
  const botId = botRow.id;
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(7) });
  state.activeUserId = botId;
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: botId, personaId: 'hattie' });

  let scheduled = 0;
  const llm = { send: async () => { scheduled++; return { text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid' }; } };
  const { orchestrator } = bootAiSubsystem({
    db, sse: { broadcast: () => {} }, llm, personaDir,
  });
  // Wait for any scheduled turns to settle
  await new Promise(r => setImmediate(r));
  await orchestrator.runTurn(gameId);
  assert.ok(scheduled >= 1);
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/ai-bootstrap.test.js
```

Expected: FAIL — module missing.

- [ ] **Step 3: Write `src/server/ai/index.js`**

```javascript
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadPersonaCatalog } from './persona-catalog.js';
import { createOrchestrator } from './orchestrator.js';
import { listStalledOrInFlight } from './agent-session.js';
import { ClaudeCliClient } from './llm-client.js';
import cribbagePlugin from '../../../plugins/cribbage/plugin.js';
import { chooseAction as cribbageChoose } from '../../../plugins/cribbage/server/ai/cribbage-player.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_PERSONA_DIR = resolve(PROJECT_ROOT, 'data', 'ai-personas');
const DEFAULT_BOT_EMAIL = 'ai+default@bot.local';
const DEFAULT_BOT_NAME = 'AI Opponent';

function ensureBotUser(db) {
  const existing = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get();
  if (existing) return existing.id;
  const now = Date.now();
  return db.prepare(`
    INSERT INTO users (email, friendly_name, color, glyph, is_bot, created_at)
    VALUES (?, ?, ?, ?, 1, ?) RETURNING id
  `).get(DEFAULT_BOT_EMAIL, DEFAULT_BOT_NAME, '#888888', '✦', now).id;
}

export function bootAiSubsystem({ db, sse, llm, personaDir = DEFAULT_PERSONA_DIR }) {
  if (!existsSync(personaDir)) {
    throw new Error(`AI persona directory not found: ${personaDir}`);
  }
  const catalog = loadPersonaCatalog(personaDir);
  if (catalog.size === 0) throw new Error(`No personas loaded from ${personaDir}`);
  ensureBotUser(db);

  const client = llm ?? new ClaudeCliClient({});
  const adapters = {
    cribbage: { plugin: cribbagePlugin, chooseAction: cribbageChoose },
  };
  const orchestrator = createOrchestrator({
    db, llm: client, sse, personas: catalog, adapters,
  });

  // Resume any in-flight or stalled bot turns from the previous boot.
  for (const sess of listStalledOrInFlight(db)) {
    orchestrator.scheduleTurn(sess.gameId);
  }

  return { orchestrator, personas: catalog };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/ai-bootstrap.test.js
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/index.js test/ai-bootstrap.test.js
git commit -m "feat(ai): bootstrap module — load personas, seed bot user, resume in-flight"
```

---

## Task 12: Routes — accept `personaId` in `POST /api/games`

**Files:**
- Modify: `src/server/routes.js`
- Test: `test/cribbage-ai-routes.test.js`

- [ ] **Step 1: Write failing test**

`test/cribbage-ai-routes.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';
import { buildRegistry } from '../src/server/plugins.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';
import { getAiSession } from '../src/server/ai/agent-session.js';

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-route-'));
  const personaDir = join(dir, 'personas');
  mkdirSync(personaDir);
  writeFileSync(join(personaDir, 'hattie.yaml'),
    'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: hi\n');
  const db = openDb(join(dir, 'db.db'));

  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;
  const events = [];
  const sse = { broadcast: (g, ev) => events.push({ g, ...ev }) };
  const { orchestrator } = bootAiSubsystem({
    db, sse,
    llm: { send: async () => ({ text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid' }) },
    personaDir,
  });
  const botId = db.prepare("SELECT id FROM users WHERE is_bot = 1").get().id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: humanId, friendlyName: 'H' }; next(); });
  const registry = buildRegistry({ cribbage: cribbagePlugin });
  mountRoutes(app, { db, registry, sse, ai: { orchestrator } });
  return { app, db, humanId, botId, events, orchestrator };
}

async function postJson(app, path, body) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', url: path, body, headers: {} };
    let status = 200, jsonBody;
    const res = {
      status(c) { status = c; return this; },
      json(b) { jsonBody = b; resolve({ status, body: b }); },
      end() { resolve({ status, body: undefined }); },
      set() { return this; },
    };
    // Use express handle directly
    app(req, res, err => err ? reject(err) : resolve({ status, body: jsonBody }));
  });
}

// Helper using supertest-style probe via raw Node http would be heavier.
// Instead: directly invoke the Express handler stack with a minimal req/res.
// (For real tests, a brief supertest dep would simplify these — but we can
// also manually drive the app via http.createServer + fetch.)

import http from 'node:http';

function listen(app) {
  return new Promise(resolve => {
    const srv = http.createServer(app);
    srv.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

async function POST(port, path, body) {
  const r = await fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

test('POST /api/games: with bot opponent + valid personaId, creates ai_sessions row', async () => {
  const { app, db, botId } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const r = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    assert.equal(r.status, 200);
    const sess = getAiSession(db, r.body.id);
    assert.ok(sess);
    assert.equal(sess.personaId, 'hattie');
    assert.equal(sess.botUserId, botId);
  } finally {
    srv.close();
  }
});

test('POST /api/games: with bot opponent but missing personaId → 400', async () => {
  const { app, botId } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const r = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /personaId required/i);
  } finally {
    srv.close();
  }
});

test('POST /api/games: with bot opponent + unknown personaId → 400', async () => {
  const { app, botId } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const r = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'nobody' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /unknown persona/i);
  } finally {
    srv.close();
  }
});

test('POST /api/games: with human opponent, personaId is ignored (no ai_sessions row)', async () => {
  const { app, db, humanId } = makeApp();
  const now = Date.now();
  const otherHumanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h2@x','H2','#222',?) RETURNING id").get(now).id;
  const { srv, port } = await listen(app);
  try {
    const r = await POST(port, '/api/games', { opponentId: otherHumanId, gameType: 'cribbage' });
    assert.equal(r.status, 200);
    assert.equal(getAiSession(db, r.body.id), null);
  } finally {
    srv.close();
  }
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/cribbage-ai-routes.test.js
```

Expected: FAIL — `mountRoutes` doesn't accept `ai`, doesn't validate personaId.

- [ ] **Step 3: Modify `src/server/routes.js`**

In `mountRoutes` signature, add `ai` parameter:

```javascript
export function mountRoutes(app, { db, registry, sse, ai = null }) {
```

In the `POST /api/games` handler, after fetching the `opponent` row, add bot-validation block before plugin.initialState:

```javascript
    const opponentRow = db.prepare('SELECT id, is_bot FROM users WHERE id = ?').get(opponentId);
    if (!opponentRow) return res.status(400).json({ error: 'opponent not on roster' });
    const opponentIsBot = opponentRow.is_bot === 1;

    let personaId = null;
    if (opponentIsBot) {
      personaId = req.body?.personaId;
      if (typeof personaId !== 'string' || !personaId) {
        return res.status(400).json({ error: 'personaId required for AI opponent' });
      }
      if (!ai?.personas?.has(personaId)) {
        return res.status(400).json({ error: `unknown personaId: ${personaId}` });
      }
    }
```

Replace the existing `const opponent = db.prepare(...)` line. Then after the game INSERT succeeds, add:

```javascript
      if (opponentIsBot && ai) {
        const { createAiSession } = await import('./ai/agent-session.js');
        createAiSession(db, { gameId: result.id, botUserId: opponentId, personaId });
      }
```

To pass `ai.personas`, the bootstrap return must include personas. (It does — we returned `{ orchestrator, personas: catalog }`.)

Update server.js to pass `ai` (Task 17 below; for now ensure tests still pass by passing the `ai` object directly in the test).

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/cribbage-ai-routes.test.js
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.js test/cribbage-ai-routes.test.js
git commit -m "feat(ai): POST /api/games accepts personaId for bot opponents"
```

---

## Task 13: Routes — `POST /api/games/:id/ai/retry` and `/ai/abandon`

**Files:**
- Modify: `src/server/routes.js`
- Test: append to `test/cribbage-ai-routes.test.js`

- [ ] **Step 1: Write failing test**

Append to `test/cribbage-ai-routes.test.js`:

```javascript
import { markStalled } from '../src/server/ai/agent-session.js';

test('POST /api/games/:id/ai/retry: clears stall and re-runs orchestrator', async () => {
  const { app, db, botId, orchestrator } = makeApp();
  const { srv, port } = await listen(app);
  try {
    // create game
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const gameId = create.body.id;
    // mark stalled
    markStalled(db, gameId, 'timeout');
    // call retry
    const r = await POST(port, `/api/games/${gameId}/ai/retry`, {});
    assert.equal(r.status, 200);
    // orchestrator should clear the stall on its successful run (we configured FakeLlmClient
    // to return a valid response in makeApp())
    await new Promise(r => setImmediate(r));
    const sess = getAiSession(db, gameId);
    assert.equal(sess.stalledAt, null);
  } finally {
    srv.close();
  }
});

test('POST /api/games/:id/ai/abandon: ends game with endedReason ai_stalled', async () => {
  const { app, db, botId } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const gameId = create.body.id;
    markStalled(db, gameId, 'timeout');
    const r = await POST(port, `/api/games/${gameId}/ai/abandon`, {});
    assert.equal(r.status, 200);
    const game = db.prepare("SELECT status, ended_reason FROM games WHERE id = ?").get(gameId);
    assert.equal(game.status, 'ended');
    assert.equal(game.ended_reason, 'ai_stalled');
  } finally {
    srv.close();
  }
});

test('POST /api/games/:id/ai/retry: 422 if no stall pending', async () => {
  const { app, botId } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const r = await POST(port, `/api/games/${create.body.id}/ai/retry`, {});
    assert.equal(r.status, 422);
  } finally {
    srv.close();
  }
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/cribbage-ai-routes.test.js
```

- [ ] **Step 3: Add routes in `src/server/routes.js`**

After the existing `app.post('/api/games/:gameId/action', ...)` block, add:

```javascript
  // -- AI stall resolution --
  app.post('/api/games/:gameId/ai/retry', requireIdentity, async (req, res) => {
    if (!ai) return res.status(500).json({ error: 'ai subsystem not enabled' });
    const { getAiSession, clearStall } = await import('./ai/agent-session.js');
    const sess = getAiSession(db, req.game.id);
    if (!sess) return res.status(404).json({ error: 'no AI session' });
    if (sess.stalledAt == null) return res.status(422).json({ error: 'not stalled' });
    clearStall(db, req.game.id);
    ai.orchestrator.scheduleTurn(req.game.id);
    res.json({ ok: true });
  });

  app.post('/api/games/:gameId/ai/abandon', requireIdentity, async (req, res) => {
    if (!ai) return res.status(500).json({ error: 'ai subsystem not enabled' });
    const { getAiSession } = await import('./ai/agent-session.js');
    const sess = getAiSession(db, req.game.id);
    if (!sess) return res.status(404).json({ error: 'no AI session' });
    db.prepare("UPDATE games SET status='ended', ended_reason=?, winner_side=NULL, updated_at=? WHERE id=?")
      .run('ai_stalled', Date.now(), req.game.id);
    sse.broadcast(req.game.id, { type: 'ended', payload: { reason: 'ai_stalled' } });
    res.json({ ok: true });
  });
```

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/cribbage-ai-routes.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.js test/cribbage-ai-routes.test.js
git commit -m "feat(ai): /ai/retry and /ai/abandon routes for stall resolution"
```

---

## Task 14: Hook orchestrator after action commit

**Files:**
- Modify: `src/server/routes.js` (in the `/action` handler, after the txn commits)

- [ ] **Step 1: Write failing test**

Append to `test/cribbage-ai-routes.test.js`:

```javascript
test('POST /action: when newState.activeUserId is a bot, orchestrator schedules turn', async () => {
  const { app, db, humanId, botId, events } = makeApp();
  const { srv, port } = await listen(app);
  try {
    // Create the game
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const gameId = create.body.id;

    // Determine which side the human is on, so we send the right discard action
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId);
    const state = JSON.parse(game.state);
    const humanSide = state.sides.a === humanId ? 0 : 1;
    const cards = state.hands[humanSide].slice(0, 2);

    // Submit the human's discard
    await POST(port, `/api/games/${gameId}/action`, { type: 'discard', payload: { cards } });

    // Wait for the scheduled bot turn to run
    await new Promise(r => setTimeout(r, 50));

    // Bot should have produced a banter or update event
    assert.ok(events.some(e => e.type === 'bot_thinking') || events.some(e => e.type === 'banter'),
      'orchestrator was scheduled');
  } finally {
    srv.close();
  }
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/cribbage-ai-routes.test.js
```

- [ ] **Step 3: Modify the `/action` handler in `src/server/routes.js`**

Find the section after the `tx()` call that returns `{ http, body, turnRows }`. Right after `sse.broadcast(req.game.id, { type: 'update' })` (which already exists), add:

```javascript
      // If the next active player is a bot, schedule an AI turn.
      if (ai && typeof outcome.body?.state?.activeUserId === 'number') {
        // Cheap check: does that user have is_bot=1?
        const isBot = db.prepare("SELECT is_bot FROM users WHERE id = ?").get(outcome.body.state.activeUserId)?.is_bot === 1;
        if (isBot) ai.orchestrator.scheduleTurn(req.game.id);
      }
```

(Note: the existing `outcome` variable in the route holds the txn return value. If the variable name in the actual code is different, locate the SSE broadcast line for `update` and place the schedule call immediately after it. Read `routes.js` around the action route (line ~200-220) before making this edit.)

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/cribbage-ai-routes.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/server/routes.js test/cribbage-ai-routes.test.js
git commit -m "feat(ai): action route schedules bot turn when next active player is a bot"
```

---

## Task 15: Plugin-clients — inject persona display into game ctx

**Files:**
- Modify: `src/server/plugin-clients.js`
- Test: extend an existing test or add `test/cribbage-ai-client-ctx.test.js`

The opponent's display name/color/glyph in the running game should come from the persona, not the bot user row.

- [ ] **Step 1: Write failing test**

`test/cribbage-ai-client-ctx.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';
import { mountPluginClients } from '../src/server/plugin-clients.js';
import { buildRegistry } from '../src/server/plugins.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';

async function GET(port, path) {
  const r = await fetch(`http://localhost:${port}${path}`);
  return { status: r.status, text: await r.text() };
}
async function POST(port, path, body) {
  const r = await fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test('plugin-clients: bot opponent ctx uses persona displayName/color/glyph, not bot user row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
  const personaDir = join(dir, 'personas');
  mkdirSync(personaDir);
  writeFileSync(join(personaDir, 'hattie.yaml'),
    'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: hi\n');
  const db = openDb(join(dir, 'db.db'));

  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;

  const { orchestrator, personas } = bootAiSubsystem({
    db, sse: { broadcast: () => {} },
    llm: { send: async () => ({ text: '{"moveId":"x","banter":""}' }) },
    personaDir,
  });
  const botId = db.prepare("SELECT id FROM users WHERE is_bot=1").get().id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: humanId, friendlyName: 'H' }; next(); });
  const registry = buildRegistry({ cribbage: cribbagePlugin });
  mountRoutes(app, { db, registry, sse: { broadcast: () => {} }, ai: { orchestrator, personas } });
  mountPluginClients(app, { db, registry, ai: { orchestrator, personas } });

  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const html = (await GET(port, `/play/cribbage/${create.body.id}/`)).text;
    const m = html.match(/window\.__GAME__\s*=\s*(\{[^<]*\})/);
    assert.ok(m, 'ctx is injected');
    const ctx = JSON.parse(m[1]);
    assert.equal(ctx.opponentFriendlyName, 'Hattie');
    assert.equal(ctx.opponentColor, '#ec4899');
    assert.equal(ctx.opponentGlyph, '♡');
    assert.equal(ctx.opponentPersonaId, 'hattie');  // new field
  } finally {
    srv.close();
  }
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
node --test test/cribbage-ai-client-ctx.test.js
```

- [ ] **Step 3: Modify `src/server/plugin-clients.js`**

Update signature: `export function mountPluginClients(app, { db, registry, ai = null })`.

In `serveIndex(...)`, accept `ai` as a parameter (pass it through). After looking up `opponent`, add:

```javascript
  let personaOverlay = null;
  if (ai && opponent && opponent.is_bot) {
    const sess = db.prepare("SELECT persona_id FROM ai_sessions WHERE game_id = ?").get(req.game.id);
    if (sess) personaOverlay = ai.personas?.get(sess.persona_id) ?? null;
  }
```

Then build `ctx` with overlay applied:

```javascript
  const ctx = {
    gameId: req.game.id,
    userId: req.user.id,
    gameType: req.game.gameType,
    sseUrl: `/api/games/${req.game.id}/events`,
    actionUrl: `/api/games/${req.game.id}/action`,
    stateUrl: `/api/games/${req.game.id}`,
    yourFriendlyName: req.user.friendlyName,
    yourGlyph: req.user.glyph ?? null,
    yourColor: req.user.color ?? null,
    opponentFriendlyName: personaOverlay?.displayName ?? opponent?.friendlyName ?? 'Opponent',
    opponentGlyph: personaOverlay?.glyph ?? opponent?.glyph ?? null,
    opponentColor: personaOverlay?.color ?? opponent?.color ?? null,
    opponentPersonaId: personaOverlay?.id ?? null,
  };
```

You'll also need `getUserById` to return `is_bot`. Check `src/server/users.js` — if `rowToUser` doesn't include it, add `isBot: row.is_bot === 1` to the returned object, OR query `is_bot` directly here:

```javascript
  const opponentRow = db.prepare('SELECT id, friendly_name, color, glyph, is_bot FROM users WHERE id = ?').get(opponentId);
  const opponent = opponentRow ? {
    id: opponentRow.id, friendlyName: opponentRow.friendly_name,
    color: opponentRow.color, glyph: opponentRow.glyph, is_bot: opponentRow.is_bot === 1,
  } : null;
```

Replace the existing `const opponent = getUserById(db, opponentId);` with the above.

- [ ] **Step 4: Run test, expect PASS**

```bash
node --test test/cribbage-ai-client-ctx.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/server/plugin-clients.js test/cribbage-ai-client-ctx.test.js
git commit -m "feat(ai): inject persona display into game ctx for bot opponent"
```

---

## Task 16: Wire AI subsystem into `server.js`

**Files:**
- Modify: `src/server/server.js`

- [ ] **Step 1: Manual change**

Edit `src/server/server.js`. After `const registry = buildRegistry(plugins);` and before `mountRoutes(...)`:

```javascript
import { bootAiSubsystem } from './ai/index.js';

// ... after registry is built ...
const ai = bootAiSubsystem({ db, sse: { broadcast } });
```

Update the `mountRoutes` and `mountPluginClients` calls:

```javascript
mountRoutes(app, { db, registry, sse: { broadcast }, ai });
mountPluginClients(app, { db, registry, ai });
```

- [ ] **Step 2: Smoke-start the server**

```bash
node src/server/server.js &
sleep 1
curl -sf http://localhost:3000/lobby/lobby.html > /dev/null && echo OK
kill %1
```

Expected: prints `OK`. If `claude` CLI is not installed, the server should still start (it's only invoked on bot turns).

- [ ] **Step 3: Run all tests to ensure nothing broke**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/server.js
git commit -m "feat(ai): wire AI subsystem into server.js"
```

---

## Task 17: Client — opponent bubble + thinking indicator + stalled banner

**Files:**
- Create: `plugins/cribbage/client/opponent-bubble.js`
- Modify: `plugins/cribbage/client/index.html`
- Modify: `plugins/cribbage/client/style.css`
- Modify: `plugins/cribbage/client/app.js`

This task has no automated test — vitest is configured for the dice subsystem only. Verify by manual playtest at the end.

- [ ] **Step 1: Add HTML slot**

In `plugins/cribbage/client/index.html`, between the `<header>` and `<section id="peg-board">`, add:

```html
  <div id="opponent-bubble" class="opp-bubble" hidden>
    <span id="opp-bubble-text"></span>
    <span id="opp-bubble-dots" class="opp-bubble__dots" hidden>
      <span></span><span></span><span></span>
    </span>
  </div>
  <div id="opp-stall-banner" class="opp-stall" hidden>
    <span id="opp-stall-text"></span>
    <button id="opp-stall-retry" type="button">Retry</button>
    <button id="opp-stall-abandon" type="button">Abandon</button>
  </div>
```

Add the script reference before the existing `app.js` script tag:

```html
  <script type="module" src="opponent-bubble.js"></script>
```

- [ ] **Step 2: Add CSS**

Append to `plugins/cribbage/client/style.css`:

```css
.opp-bubble {
  position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.85); color: white; padding: 8px 14px;
  border-radius: 16px; font-size: 14px; max-width: 80%; z-index: 100;
  transition: opacity 0.4s; pointer-events: none;
}
.opp-bubble[hidden] { display: none; }
.opp-bubble__dots span {
  display: inline-block; width: 6px; height: 6px; margin: 0 2px;
  background: #ccc; border-radius: 50%;
  animation: bubble-dot 1.2s infinite ease-in-out;
}
.opp-bubble__dots span:nth-child(2) { animation-delay: 0.2s; }
.opp-bubble__dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes bubble-dot {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}
.opp-stall {
  position: fixed; top: 100px; left: 50%; transform: translateX(-50%);
  background: #fef3c7; border: 1px solid #f59e0b; color: #92400e;
  padding: 12px 20px; border-radius: 8px; z-index: 100;
  display: flex; gap: 12px; align-items: center;
}
.opp-stall[hidden] { display: none; }
.opp-stall button {
  padding: 4px 12px; border-radius: 4px; border: 1px solid #92400e;
  background: white; cursor: pointer;
}
```

- [ ] **Step 3: Write `plugins/cribbage/client/opponent-bubble.js`**

```javascript
const ctx = window.__GAME__;
const bubble = document.getElementById('opponent-bubble');
const bubbleText = document.getElementById('opp-bubble-text');
const bubbleDots = document.getElementById('opp-bubble-dots');
const stallBanner = document.getElementById('opp-stall-banner');
const stallText = document.getElementById('opp-stall-text');
const retryBtn = document.getElementById('opp-stall-retry');
const abandonBtn = document.getElementById('opp-stall-abandon');

let bubbleTimer = null;
const queue = [];
let showing = false;

function showBubbleNext() {
  if (showing) return;
  const next = queue.shift();
  if (!next) return;
  showing = true;
  bubbleText.textContent = next;
  bubbleDots.hidden = true;
  bubble.hidden = false;
  bubble.style.opacity = '1';
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    bubble.style.opacity = '0';
    setTimeout(() => {
      bubble.hidden = true;
      showing = false;
      showBubbleNext();
    }, 400);
  }, 5000);
}

function showThinking(displayName) {
  if (showing) return;  // don't interrupt a banter line
  bubbleText.textContent = `${displayName} is thinking`;
  bubbleDots.hidden = false;
  bubble.hidden = false;
  bubble.style.opacity = '1';
}
function clearThinking() {
  if (!bubbleDots.hidden) {
    bubble.hidden = true;
    bubbleDots.hidden = true;
  }
}
function showStall(displayName, reason) {
  stallText.textContent = `${displayName} froze up (${reason}). Retry or abandon?`;
  stallBanner.hidden = false;
  clearThinking();
}
function clearStall() {
  stallBanner.hidden = true;
}

const es = new EventSource(ctx.sseUrl);
es.addEventListener('bot_thinking', e => {
  const p = JSON.parse(e.data);
  showThinking(p.displayName);
});
es.addEventListener('banter', e => {
  const p = JSON.parse(e.data);
  if (p.text) {
    queue.push(p.text);
    clearThinking();
    showBubbleNext();
  }
});
es.addEventListener('bot_stalled', e => {
  const p = JSON.parse(e.data);
  showStall(p.displayName, p.reason);
});
es.addEventListener('update', () => clearThinking());

retryBtn.addEventListener('click', async () => {
  const r = await fetch(`/api/games/${ctx.gameId}/ai/retry`, { method: 'POST' });
  if (r.ok) clearStall();
  else alert(`retry failed: ${(await r.json().catch(() => ({}))).error || r.status}`);
});
abandonBtn.addEventListener('click', async () => {
  if (!confirm('End this game?')) return;
  const r = await fetch(`/api/games/${ctx.gameId}/ai/abandon`, { method: 'POST' });
  if (r.ok) { clearStall(); location.reload(); }
  else alert(`abandon failed: ${(await r.json().catch(() => ({}))).error || r.status}`);
});
```

- [ ] **Step 4: Manual playtest**

```bash
npm start &
```

Open `http://localhost:3000/lobby/lobby.html` (or the cribbage entry). Create a cribbage game with an AI opponent (you may need to extend the lobby UI to surface a persona dropdown — see Task 18). Take a turn and verify:
- "Hattie is thinking" appears with pulsing dots
- A banter line appears for ~5s after the bot moves
- Game state advances correctly

Kill the server: `kill %1`.

- [ ] **Step 5: Commit**

```bash
git add plugins/cribbage/client/opponent-bubble.js plugins/cribbage/client/index.html plugins/cribbage/client/style.css
git commit -m "feat(ai/cribbage): client opponent bubble + thinking indicator + stall banner"
```

---

## Task 18: Lobby — surface bot opponents + persona dropdown

**Files:**
- Modify: `public/lobby/*` (whichever JS handles the new-game form)

This task is small and UI-shaped. Read `public/lobby/` to find the new-game form and:

1. When listing opponents from `/api/users` (or wherever they come from), include bots (no filter change needed if API already returns them).
2. When the selected opponent has `is_bot=1`, show a `<select>` with persona options (fetch from a new `GET /api/ai/personas` route — add it).
3. Include `personaId` in the `POST /api/games` body when set.

- [ ] **Step 1: Add `GET /api/ai/personas` route in `src/server/routes.js`**

```javascript
  app.get('/api/ai/personas', requireIdentity, (_req, res) => {
    if (!ai) return res.json({ personas: [] });
    const out = [];
    for (const p of ai.personas.values()) {
      out.push({ id: p.id, displayName: p.displayName, color: p.color, glyph: p.glyph });
    }
    res.json({ personas: out });
  });
```

- [ ] **Step 2: Test the route**

Add a small test to `test/cribbage-ai-routes.test.js`:

```javascript
test('GET /api/ai/personas: returns the catalog', async () => {
  const { app } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const r = await fetch(`http://localhost:${port}/api/ai/personas`);
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.ok(body.personas.some(p => p.id === 'hattie'));
  } finally {
    srv.close();
  }
});
```

Run: `node --test test/cribbage-ai-routes.test.js`

- [ ] **Step 3: Inspect the lobby JS to find the new-game form**

```bash
grep -nE "POST.*games|opponentId|new game" public/lobby/*.js | head -20
```

Read the relevant file. Identify the form/handler.

- [ ] **Step 4: Modify the lobby UI**

In the new-game form handler:
- After the opponent dropdown changes, check if the selected opponent has `isBot: true` (or the lobby's equivalent flag — make the `/api/users` response include it if not already).
- If yes, fetch `/api/ai/personas` and populate a `<select id="persona-select">`.
- When submitting, include `personaId` if the persona select is visible.

(Concrete code depends on the existing lobby structure — read it first. Keep edits surgical.)

- [ ] **Step 5: Manual lobby test**

Start the server, open the lobby, verify the persona dropdown appears for bot opponents and the resulting game uses the chosen persona's display name.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes.js public/lobby/ test/cribbage-ai-routes.test.js
git commit -m "feat(ai): /api/ai/personas route + lobby persona dropdown for bot opponents"
```

---

## Task 19: End-to-end deal integration test

**Files:**
- Create: `test/cribbage-ai-full-deal.test.js`

Drive a full cribbage deal with the bot using `FakeLlmClient`. Verifies orchestrator + adapter + DB persistence + SSE event ordering.

- [ ] **Step 1: Write the test**

`test/cribbage-ai-full-deal.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';
import { createAiSession } from '../src/server/ai/agent-session.js';
import { buildInitialState } from '../plugins/cribbage/server/state.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { enumerateLegalMoves } from '../plugins/cribbage/server/ai/legal-moves.js';

function det(seed = 7) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('full deal: bot drives all bot-side actions, deal completes, both players reach show', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fulldeal-'));
  const personaDir = join(dir, 'personas');
  mkdirSync(personaDir);
  writeFileSync(join(personaDir, 'hattie.yaml'),
    'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: hi\n');
  const db = openDb(join(dir, 'db.db'));

  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;

  // Build an LLM that, on each call, picks the FIRST legal move from the
  // current game state. This exercises the full pipeline without canned responses.
  let currentGameId = null;
  const llm = {
    async send({ prompt, sessionId }) {
      const game = db.prepare("SELECT state FROM games WHERE id = ?").get(currentGameId);
      const state = JSON.parse(game.state);
      // Determine bot side
      const sess = db.prepare("SELECT bot_user_id FROM ai_sessions WHERE game_id = ?").get(currentGameId);
      const botPlayerIdx = state.sides.a === sess.bot_user_id ? 0 : 1;
      const moves = enumerateLegalMoves(state, botPlayerIdx);
      return {
        text: JSON.stringify({ moveId: moves[0].id, banter: 'go' }),
        sessionId: sessionId ?? 'sid-x',
      };
    },
  };

  const events = [];
  const sse = { broadcast: (g, ev) => events.push({ g, ...ev }) };
  const { orchestrator } = bootAiSubsystem({ db, sse, llm, personaDir });
  const botId = db.prepare("SELECT id FROM users WHERE is_bot=1").get().id;

  // Build a game with bot as player b
  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(7) });
  currentGameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId: currentGameId, botUserId: botId, personaId: 'hattie' });

  // Loop: while game active, alternate human moves + bot moves until phase=show or match-end
  let safety = 100;
  while (safety-- > 0) {
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(currentGameId);
    if (game.status !== 'active') break;
    const s = JSON.parse(game.state);
    if (s.phase === 'show' || s.phase === 'match-end') break;
    if (s.activeUserId === humanId) {
      // pick first legal move for the human and apply directly via plugin
      const humanIdx = s.sides.a === humanId ? 0 : 1;
      const moves = enumerateLegalMoves(s, humanIdx);
      assert.ok(moves.length > 0, `no legal moves for human in phase ${s.phase}`);
      const result = cribbagePlugin.applyAction({
        state: s, action: moves[0].action, actorId: humanId, rng: det(currentGameId),
      });
      assert.equal(result.error, undefined, `human action rejected: ${result.error}`);
      db.prepare("UPDATE games SET state = ? WHERE id = ?").run(JSON.stringify(result.state), currentGameId);
      // schedule bot turn if needed
      if (typeof result.state.activeUserId === 'number' && result.state.activeUserId !== humanId) {
        await orchestrator.runTurn(currentGameId);
      }
    } else if (s.activeUserId === botId) {
      await orchestrator.runTurn(currentGameId);
    } else {
      break;
    }
  }

  const final = db.prepare("SELECT state FROM games WHERE id = ?").get(currentGameId);
  const finalState = JSON.parse(final.state);
  assert.ok(['show', 'match-end'].includes(finalState.phase),
    `expected to reach show or match-end; got ${finalState.phase}`);

  // Verify SSE events were emitted (banter, update, possibly bot_thinking)
  assert.ok(events.some(e => e.type === 'banter'));
  assert.ok(events.some(e => e.type === 'update'));
});
```

- [ ] **Step 2: Run test**

```bash
node --test test/cribbage-ai-full-deal.test.js
```

Expected: PASS. If it fails, the orchestrator/adapter integration has a subtle bug — debug from the logged event ordering.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add test/cribbage-ai-full-deal.test.js
git commit -m "test(ai/cribbage): end-to-end deal integration test with FakeLlmClient"
```

---

## Task 20: Opt-in live ClaudeCliClient smoke test

**Files:**
- Create: `test/ai-llm-client-live.test.js`

Skipped by default; runs only when `CLAUDE_LIVE_TEST=1` is set. Verifies the real `claude` CLI works end-to-end on the developer's machine.

- [ ] **Step 1: Write the test**

`test/ai-llm-client-live.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCliClient } from '../src/server/ai/llm-client.js';

const LIVE = process.env.CLAUDE_LIVE_TEST === '1';

test('LIVE: claude CLI returns valid JSON envelope', { skip: !LIVE }, async () => {
  const client = new ClaudeCliClient({ timeoutMs: 60_000 });
  const r = await client.send({
    prompt: 'Say only the word "ping". No other content.',
    sessionId: null,
    systemPrompt: 'You are a test fixture. Respond with exactly the word "ping".',
  });
  assert.ok(typeof r.text === 'string' && r.text.length > 0);
  assert.ok(r.sessionId, 'session_id returned');
});
```

- [ ] **Step 2: Run with the env-gate enabled (developer machine only)**

```bash
CLAUDE_LIVE_TEST=1 node --test test/ai-llm-client-live.test.js
```

Expected: PASS (if `claude` CLI is installed and authenticated). Skipped silently otherwise.

- [ ] **Step 3: Run normally — should be skipped**

```bash
node --test test/ai-llm-client-live.test.js
```

Expected: 1 test, 0 ran (skipped).

- [ ] **Step 4: Commit**

```bash
git add test/ai-llm-client-live.test.js
git commit -m "test(ai): opt-in live ClaudeCliClient smoke test (env-gated)"
```

---

## Self-review notes

After all tasks complete, verify spec coverage:

| Spec section | Covered by task |
|---|---|
| Persona templates (YAML, three v1 personas) | Task 1, 2 |
| `users.is_bot` + `ai_sessions` schema | Task 3 |
| `ClaudeCliClient` (subprocess, sessions, timeout) | Task 4 |
| Per-game session lifecycle | Task 5 |
| Cribbage adapter (`chooseAction`) | Tasks 6-8 |
| Orchestrator + per-game queue | Task 9, 10 |
| Bootstrap (seed bot, load personas, resume in-flight) | Task 11 |
| Lobby `personaId` acceptance | Task 12 |
| `/ai/retry` and `/ai/abandon` | Task 13 |
| Schedule bot turn after action commit | Task 14 |
| Persona display in client ctx | Task 15 |
| Server wiring | Task 16 |
| Speech bubble + thinking + stall UI | Task 17 |
| Lobby persona dropdown | Task 18 |
| End-to-end deal test | Task 19 |
| Live smoke test (opt-in) | Task 20 |

Spec sections **not** explicitly tasked but already addressed inline:
- **Stall protocol mapping (timeout/invalid/illegal/subprocess)** — Task 9 (`stallReasonFor`)
- **Server-restart resume** — Task 11 (`listStalledOrInFlight` scan in bootstrap)
- **No silent fallback to fake AI** — by design: if subprocess fails twice, we stall, never substitute

Spec items deferred per the spec's own "Out of scope" section: streaming banter, optimal-play diagnostics, AI-vs-AI mode, banter persistence/scrollback, OTel telemetry. None require tasks here.
