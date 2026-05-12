import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { FakeLlmClient } from '../src/server/ai/fake-llm-client.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';
import { createAiSession } from '../src/server/ai/agent-session.js';
import { buildInitialState } from '../plugins/words/server/state.js';

function det(seed = 1) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function setupGame(db, { rack, board = null, bag = null }) {
  const now = Date.now();
  const human = db.prepare("INSERT INTO users (email,friendly_name,color,created_at) VALUES ('hw','Hw','#000',?) RETURNING id").get(now).id;
  const bot = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get().id;
  const aId = Math.min(human, bot), bId = Math.max(human, bot);
  const state = buildInitialState({ participants: [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }], rng: det() });
  // Force bot to side A, with a fixed rack.
  state.sides = { a: bot, b: human };
  state.racks.a = rack;
  if (board) state.board = board;
  if (bag) state.bag = bag;
  state.activeUserId = bot;
  const gameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'words', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId, botUserId: bot, personaId: 'samantha' });
  return { gameId, bot };
}

test('words bot: makes an opening play and broadcasts update + banter + turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'words-'));
  const db = openDb(join(dir, 'test.db'));
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  // Echo back whichever moveId appears first in the prompt.
  const llm = {
    calls: [],
    send: async ({ prompt }) => {
      llm.calls.push({ prompt });
      const m = prompt.match(/^ {2}([a-z-]+):/m);
      return { text: `{"moveId":"${m[1]}","banter":"a tidy little word"}`, sessionId: 'sess-1' };
    },
  };
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  // Boot once (registers the bot user); then set up the game with a known rack.
  bootAiSubsystem({ db, sse, llm, personaDir });
  const { gameId } = setupGame(db, { rack: ['C','A','T','S','D','O','G'] });

  // Re-boot and grab the orchestrator (one orchestrator per process; we just
  // want a handle).
  const { orchestrator } = bootAiSubsystem({ db, sse, llm, personaDir });
  await orchestrator.runTurn(gameId);

  const types = events.map(e => e.type);
  assert.ok(types.includes('update'), `expected 'update' SSE; got ${types}`);
  assert.ok(types.includes('banter'), `expected 'banter' SSE; got ${types}`);
  assert.ok(types.includes('turn'), `expected 'turn' SSE; got ${types}`);

  // Game state should have advanced past the opening — board is no longer
  // entirely empty.
  const game = db.prepare('SELECT state FROM games WHERE id = ?').get(gameId);
  const final = JSON.parse(game.state);
  const placed = final.board.flat().filter(Boolean).length;
  assert.ok(placed > 0, 'at least one tile placed');
});

test('words bot: garbage LLM response stalls cleanly with bot_stalled SSE', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'words-stall-'));
  const db = openDb(join(dir, 'test.db'));
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const llm = new FakeLlmClient([
    { text: 'mumble' },
    { text: 'mumble again' },
  ]);
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootAiSubsystem({ db, sse, llm, personaDir });

  const { gameId } = setupGame(db, { rack: ['C','A','T','S','D','O','G'] });
  await orchestrator.runTurn(gameId);

  const stalled = events.filter(e => e.type === 'bot_stalled');
  assert.ok(stalled.length >= 1, 'bot_stalled fired');
  assert.equal(stalled[0].payload.reason, 'invalid_response');
});

test('words bot: forced pass when no plays exist (empty rack)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'words-pass-'));
  const db = openDb(join(dir, 'test.db'));
  const events = [];
  const sse = { broadcast: (gid, ev) => events.push({ gid, ...ev }) };
  const llm = {
    send: async ({ prompt }) => {
      assert.match(prompt, /pass:/);
      return { text: '{"moveId":"pass","banter":""}', sessionId: 'sess-x' };
    },
  };
  const personaDir = join(process.cwd(), 'data', 'ai-personas');
  const { orchestrator } = bootAiSubsystem({ db, sse, llm, personaDir });

  const { gameId } = setupGame(db, { rack: [] });
  await orchestrator.runTurn(gameId);

  const types = events.map(e => e.type);
  assert.ok(types.includes('update'), 'update fired after pass');
});
