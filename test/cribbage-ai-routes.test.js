import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';
import { buildRegistry } from '../src/server/plugins.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';
import { getAiSession, markStalled } from '../src/server/ai/agent-session.js';

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
  const bootResult = bootAiSubsystem({
    db, sse,
    llm: { send: async () => ({ text: '{"moveId":"discard:0,1","banter":""}', sessionId: 'sid' }) },
    personaDir,
  });
  const { orchestrator } = bootResult;
  const botId = db.prepare("SELECT id FROM users WHERE is_bot = 1").get().id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: humanId, friendlyName: 'H' }; req.authEmail = 'h@x'; next(); });
  const registry = buildRegistry({ cribbage: cribbagePlugin });
  mountRoutes(app, { db, registry, sse, ai: bootResult });
  return { app, db, humanId, botId, events, orchestrator };
}

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

test('POST /api/games/:id/ai/retry: clears stall and re-runs orchestrator', async () => {
  const { app, db, botId, orchestrator } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const gameId = create.body.id;
    markStalled(db, gameId, 'timeout');
    const r = await POST(port, `/api/games/${gameId}/ai/retry`, {});
    assert.equal(r.status, 200);
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

test('GET /api/games/:id/events: replays current stall on subscribe', async () => {
  const { app, db, botId } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const gameId = create.body.id;
    markStalled(db, gameId, 'timeout');

    const ctrl = new AbortController();
    const resp = await fetch(`http://localhost:${port}/api/games/${gameId}/events`, { signal: ctrl.signal });
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && !buf.includes('event: bot_stalled')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    ctrl.abort();
    assert.match(buf, /event: bot_stalled/);
    assert.match(buf, /"reason":"timeout"/);
    assert.match(buf, /"displayName":"Hattie"/);
  } finally {
    srv.close();
  }
});

test('GET /api/games/:id/events: no stall replay when AI session is healthy', async () => {
  const { app, botId } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const gameId = create.body.id;

    const ctrl = new AbortController();
    const resp = await fetch(`http://localhost:${port}/api/games/${gameId}/events`, { signal: ctrl.signal });
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    // Read whatever's immediately available, then bail.
    await new Promise(r => setTimeout(r, 100));
    try {
      const { value } = await Promise.race([
        reader.read(),
        new Promise(r => setTimeout(() => r({ value: undefined }), 50)),
      ]);
      if (value) buf += dec.decode(value);
    } catch {}
    ctrl.abort();
    assert.equal(/event: bot_stalled/.test(buf), false);
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

test('POST /action: when newState.activeUserId is a bot, orchestrator schedules turn', async () => {
  const { app, db, humanId, botId, events } = makeApp();
  const { srv, port } = await listen(app);
  try {
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const gameId = create.body.id;

    const game = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId);
    const state = JSON.parse(game.state);
    const humanSide = state.sides.a === humanId ? 0 : 1;
    const cards = state.hands[humanSide].slice(0, 2);

    await POST(port, `/api/games/${gameId}/action`, { type: 'discard', payload: { cards } });

    await new Promise(r => setTimeout(r, 50));

    assert.ok(events.some(e => e.type === 'bot_thinking') || events.some(e => e.type === 'banter'),
      'orchestrator was scheduled');
  } finally {
    srv.close();
  }
});
