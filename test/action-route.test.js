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
      return { state: { ...state, count: state.count + 1, activeUserId: actorId === 1 ? 2 : 1 }, ended: false };
    }
    if (action.type === 'finish') {
      return { state: { ...state, ended: true }, ended: true, scoreDelta: { a: 5, b: 0 } };
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
    next();
  });

  mountRoutes(app, { db, registry: { stub: stubPlugin }, sse: { broadcast: () => {} } });
  return { app, db };
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
