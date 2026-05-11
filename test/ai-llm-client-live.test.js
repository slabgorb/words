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
