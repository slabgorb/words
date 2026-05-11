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

  let currentGameId = null;
  const llm = {
    async send({ prompt, sessionId }) {
      const game = db.prepare("SELECT state FROM games WHERE id = ?").get(currentGameId);
      const state = JSON.parse(game.state);
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

  const aId = Math.min(humanId, botId), bId = Math.max(humanId, botId);
  const participants = [{ userId: aId, side: 'a' }, { userId: bId, side: 'b' }];
  const state = buildInitialState({ participants, rng: det(7) });
  currentGameId = db.prepare(`
    INSERT INTO games (player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
    VALUES (?, ?, 'active', 'cribbage', ?, ?, ?) RETURNING id`)
    .get(aId, bId, JSON.stringify(state), now, now).id;
  createAiSession(db, { gameId: currentGameId, botUserId: botId, personaId: 'hattie' });

  let safety = 100;
  while (safety-- > 0) {
    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(currentGameId);
    if (game.status !== 'active') break;
    const s = JSON.parse(game.state);
    if (s.phase === 'show' || s.phase === 'match-end') break;
    if (s.activeUserId === humanId) {
      const humanIdx = s.sides.a === humanId ? 0 : 1;
      const moves = enumerateLegalMoves(s, humanIdx);
      assert.ok(moves.length > 0, `no legal moves for human in phase ${s.phase}`);
      const result = cribbagePlugin.applyAction({
        state: s, action: moves[0].action, actorId: humanId, rng: det(currentGameId),
      });
      assert.equal(result.error, undefined, `human action rejected: ${result.error}`);
      db.prepare("UPDATE games SET state = ? WHERE id = ?").run(JSON.stringify(result.state), currentGameId);
      if (typeof result.state.activeUserId === 'number' && result.state.activeUserId !== humanId) {
        await orchestrator.runTurn(currentGameId);
      }
    } else if (s.activeUserId === botId) {
      await orchestrator.runTurn(currentGameId);
    } else if (s.phase === 'discard' && s.activeUserId === null) {
      // Concurrent discard: both players act simultaneously.
      // Apply human's discard if not yet submitted.
      const humanIdx = s.sides.a === humanId ? 0 : 1;
      const botIdx = 1 - humanIdx;
      if (s.pendingDiscards[humanIdx] == null) {
        const moves = enumerateLegalMoves(s, humanIdx);
        assert.ok(moves.length > 0, `no legal discard moves for human`);
        const result = cribbagePlugin.applyAction({
          state: s, action: moves[0].action, actorId: humanId, rng: det(currentGameId),
        });
        assert.equal(result.error, undefined, `human discard rejected: ${result.error}`);
        db.prepare("UPDATE games SET state = ? WHERE id = ?").run(JSON.stringify(result.state), currentGameId);
      }
      // Now let the bot discard if not yet submitted.
      const s2 = JSON.parse(db.prepare("SELECT state FROM games WHERE id = ?").get(currentGameId).state);
      if (s2.pendingDiscards[botIdx] == null) {
        await orchestrator.runTurn(currentGameId);
      }
    } else {
      break;
    }
  }

  const final = db.prepare("SELECT state FROM games WHERE id = ?").get(currentGameId);
  const finalState = JSON.parse(final.state);
  assert.ok(['show', 'match-end'].includes(finalState.phase),
    `expected to reach show or match-end; got ${finalState.phase}`);

  assert.ok(events.some(e => e.type === 'banter'));
  assert.ok(events.some(e => e.type === 'update'));
});
