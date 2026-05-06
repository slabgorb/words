import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

const stubPlugin = {
  id: 'stub',
  displayName: 'Stub',
  players: 2,
  clientDir: 'plugins/stub/client',
  initialState: () => ({ activeUserId: 1, count: 0 }),
  applyAction: ({ state, action, actorId }) => {
    if (action.type === 'inc') {
      return {
        state: { ...state, count: state.count + 1, activeUserId: actorId === 1 ? 2 : 1 },
        ended: false,
        summary: { kind: 'inc', count: state.count + 1 },
      };
    }
    if (action.type === 'finish') {
      return {
        state: { ...state, ended: true, endedReason: 'done', winnerSide: 'a' },
        ended: true,
        scoreDelta: { a: 5, b: 0 },
        summary: { kind: 'finish' },
      };
    }
    return { error: 'unknown action' };
  },
  publicView: ({ state }) => state,
};

function setupApp() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');

  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f00', ?)").run(now);
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#0f0', ?)").run(now);
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
              VALUES (1, 1, 2, 'active', 'stub', ?, ?, ?)`).run(JSON.stringify({ activeUserId: 1, count: 0 }), now, now);

  // Test identity middleware — sets req.user from a header
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id, email: `${id}@b`, friendlyName: id === 1 ? 'A' : 'B' };
    req.authEmail = req.user.email;
    next();
  });

  const broadcasts = [];
  mountRoutes(app, { db, registry: { stub: stubPlugin }, sse: { broadcast: (gameId, event) => broadcasts.push({ gameId, event }) } });
  return { app, db, broadcasts };
}

async function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, () => resolve(server));
  });
}

async function call(server, method, path, body, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('action increments count and returns new state', async () => {
  const { app, db } = setupApp();
  const server = await startServer(app);
  try {
    const r = await call(server, 'POST', '/api/games/1/action', { type: 'inc' }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.state.count, 1);
    assert.equal(r.body.state.activeUserId, 2);
    const row = db.prepare("SELECT state FROM games WHERE id = 1").get();
    assert.equal(JSON.parse(row.state).count, 1);
  } finally { server.close(); }
});

test('non-participant gets 403', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  try {
    const r = await call(server, 'POST', '/api/games/1/action', { type: 'inc' }, { 'x-test-user-id': '99' });
    assert.equal(r.status, 403);
  } finally { server.close(); }
});

test('not your turn gets 422', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  try {
    const r = await call(server, 'POST', '/api/games/1/action', { type: 'inc' }, { 'x-test-user-id': '2' });
    assert.equal(r.status, 422);
    assert.match(r.body.error, /turn/i);
  } finally { server.close(); }
});

test('plugin error returns 422', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  try {
    const r = await call(server, 'POST', '/api/games/1/action', { type: 'unknown' }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'unknown action');
  } finally { server.close(); }
});

test('ended game persists and returns ended flag', async () => {
  const { app, db } = setupApp();
  const server = await startServer(app);
  try {
    const r = await call(server, 'POST', '/api/games/1/action', { type: 'finish' }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ended, true);
    const row = db.prepare("SELECT status FROM games WHERE id = 1").get();
    assert.equal(row.status, 'ended');
  } finally { server.close(); }
});

test('action writes a turn_log row and broadcasts a turn event', async () => {
  const { app, db, broadcasts } = setupApp();
  const server = await startServer(app);
  try {
    const r = await call(server, 'POST', '/api/games/1/action', { type: 'inc' }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    const rows = db.prepare("SELECT * FROM turn_log WHERE game_id = 1 ORDER BY id").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].turn_number, 1);
    assert.equal(rows[0].side, 'a');
    assert.equal(rows[0].kind, 'inc');
    assert.deepEqual(JSON.parse(rows[0].summary), { kind: 'inc', count: 1 });

    const turnEvents = broadcasts.filter(b => b.event.type === 'turn');
    assert.equal(turnEvents.length, 1);
    assert.equal(turnEvents[0].event.payload.turnNumber, 1);
    assert.equal(turnEvents[0].event.payload.side, 'a');
    assert.deepEqual(turnEvents[0].event.payload.summary, { kind: 'inc', count: 1 });

    const updateEvents = broadcasts.filter(b => b.event.type === 'update');
    assert.equal(updateEvents.length, 1, 'update event still emitted');
  } finally { server.close(); }
});

test('ending action writes synthetic game-ended row after the action row', async () => {
  const { app, db, broadcasts } = setupApp();
  const server = await startServer(app);
  try {
    await call(server, 'POST', '/api/games/1/action', { type: 'finish' }, { 'x-test-user-id': '1' });
    const rows = db.prepare("SELECT * FROM turn_log WHERE game_id = 1 ORDER BY id").all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, 'finish');
    assert.equal(rows[1].kind, 'game-ended');
    assert.equal(rows[1].turn_number, 2);
    assert.equal(rows[1].side, 'a');
    assert.deepEqual(JSON.parse(rows[1].summary), { kind: 'game-ended', reason: 'done', winnerSide: 'a' });

    const turnEvents = broadcasts.filter(b => b.event.type === 'turn');
    assert.equal(turnEvents.length, 2);
    assert.equal(turnEvents[1].event.payload.summary.kind, 'game-ended');
  } finally { server.close(); }
});

test('GET /api/games/:id/history returns entries oldest-first', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  try {
    await call(server, 'POST', '/api/games/1/action', { type: 'inc' }, { 'x-test-user-id': '1' });
    await call(server, 'POST', '/api/games/1/action', { type: 'inc' }, { 'x-test-user-id': '2' });
    const r = await call(server, 'GET', '/api/games/1/history', null, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.entries));
    assert.equal(r.body.entries.length, 2);
    assert.equal(r.body.entries[0].turnNumber, 1);
    assert.equal(r.body.entries[1].turnNumber, 2);
    assert.equal(r.body.entries[0].summary.kind, 'inc');
  } finally { server.close(); }
});

test('GET /api/games/:id/history rejects non-participants', async () => {
  const { app } = setupApp();
  const server = await startServer(app);
  try {
    const r = await call(server, 'GET', '/api/games/1/history', null, { 'x-test-user-id': '99' });
    assert.equal(r.status, 403);
  } finally { server.close(); }
});
