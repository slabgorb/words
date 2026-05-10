import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCliClient } from '../src/server/ai/llm-client.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';

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
    wait() { return new Promise(() => {}); },
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
