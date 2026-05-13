import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
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
  const t0 = Date.now();
  const proc = nodeSpawn(command, args, options);
  const stdoutChunks = [];
  const stderrChunks = [];
  let firstByteAt = null;
  proc.stdout.on('data', c => {
    if (firstByteAt == null) firstByteAt = Date.now();
    stdoutChunks.push(c.toString('utf8'));
  });
  proc.stderr.on('data', c => stderrChunks.push(c.toString('utf8')));
  return {
    pid: proc.pid,
    spawnedAt: t0,
    get firstByteAt() { return firstByteAt; },
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
    // The bot is pure text-in/text-out — no Bash/Edit/Read tools needed.
    // --tools "" disables all built-in tools (drops ~30k tokens of tool
    // schemas from every prompt). --effort low caps thinking time.
    // --strict-mcp-config blocks ad-hoc MCP servers; the inline --settings
    // override disables plugin-bundled MCPs (Playwright et al.).
    const overrides = JSON.stringify({ enabledPlugins: {} });
    args.push(
      '-p', prompt,
      '--output-format', 'json',
      '--setting-sources', 'user',
      '--strict-mcp-config',
      '--effort', 'low',
      '--tools', '',
      '--settings', overrides,
    );

    const start = Date.now();
    // cwd is set to a neutral directory so the bot's claude subprocess
    // does not auto-load this project's CLAUDE.md, .claude/agents,
    // .claude/skills, or per-project auto-memory — all of which carry
    // dev-side context (e.g. Pennyfarthing personas) that would leak
    // into the bot's persona.
    const proc = this._spawn(this._command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: tmpdir() });
    // INSTRUMENTATION: dump the actual argv claude sees so we can verify
    // that --settings overrides + --strict-mcp-config are present.
    console.log(`[llm] spawn pid=${proc.pid} args=${JSON.stringify(args.map(a => a.length > 80 ? a.slice(0,80)+`…(${a.length})` : a))}`);
    let exitCode;
    let timeoutHandle;
    try {
      exitCode = await Promise.race([
        proc.wait(),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new TimeoutError(Date.now() - start)),
            this._timeoutMs,
          );
        }),
      ]);
    } catch (err) {
      proc.kill();
      throw err;
    } finally {
      // Without this, every successful send leaves a pending timeout that
      // pins the event loop alive for the full timeoutMs — turning a
      // suite of fast unit tests into a 180-second wait.
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    const stdout = proc.stdoutChunks.join('');
    const stderr = proc.stderrChunks.join('');
    const elapsed = Date.now() - start;
    const ttfb = proc.firstByteAt ? proc.firstByteAt - proc.spawnedAt : null;
    // Extract claude's own API timing from the envelope so we can separate
    // Anthropic-side latency from CLI/local overhead.
    let apiMs = null, cacheRead = null, cacheCreate = null;
    try { const j = JSON.parse(stdout); apiMs = j.duration_api_ms ?? null;
          cacheRead = j.usage?.cache_read_input_tokens ?? null;
          cacheCreate = j.usage?.cache_creation_input_tokens ?? null; } catch {}
    console.log(`[llm] done pid=${proc.pid} exit=${exitCode} elapsed=${elapsed}ms ttfb=${ttfb}ms api_ms=${apiMs} cache_read=${cacheRead} cache_create=${cacheCreate} stdout=${stdout.length}B stderr=${stderr.length}B${stderr.length ? ' stderr_head=' + JSON.stringify(stderr.slice(0,400)) : ''}`);
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
