import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

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
    args.push('-p', prompt, '--output-format', 'json', '--setting-sources', 'user');

    const start = Date.now();
    // cwd is set to a neutral directory so the bot's claude subprocess
    // does not auto-load this project's CLAUDE.md, .claude/agents,
    // .claude/skills, or per-project auto-memory — all of which carry
    // dev-side context (e.g. Pennyfarthing personas) that would leak
    // into the bot's persona.
    const proc = this._spawn(this._command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: tmpdir() });
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
