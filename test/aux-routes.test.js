import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

const echoPlugin = {
  id: 'echo',
  displayName: 'Echo',
  players: 2,
  clientDir: 'plugins/echo/client',
  initialState: () => ({ activeUserId: 1 }),
  applyAction: ({ state }) => ({ state, ended: false }),
  publicView: ({ state }) => state,
  auxRoutes: {
    ping: {
      method: 'GET',
      handler: (req, res) => res.json({ pong: true, gameId: req.game.id, userId: req.user.id }),
    },
    score: {
      method: 'POST',
      handler: (req, res) => res.json({ payload: req.body }),
    },
  },
};

async function setupApp() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f00', ?)").run(now);
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#0f0', ?)").run(now);
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
              VALUES (1, 1, 2, 'active', 'echo', '{}', ?, ?)`).run(now, now);

  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id };
    next();
  });

  mountRoutes(app, { db, registry: { echo: echoPlugin }, sse: { broadcast: () => {} } });
  const server = await new Promise(resolve => {
    const s = http.createServer(app);
    s.listen(0, () => resolve(s));
  });
  return server;
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

test('GET aux route is mounted and receives req.game/req.user', async () => {
  const server = await setupApp();
  try {
    const r = await call(server, 'GET', '/api/games/1/ping', null, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { pong: true, gameId: 1, userId: 1 });
  } finally { server.close(); }
});

test('POST aux route receives parsed body', async () => {
  const server = await setupApp();
  try {
    const r = await call(server, 'POST', '/api/games/1/score', { foo: 'bar' }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.payload, { foo: 'bar' });
  } finally { server.close(); }
});

test('aux route inherits 403 for non-participant', async () => {
  const server = await setupApp();
  try {
    const r = await call(server, 'GET', '/api/games/1/ping', null, { 'x-test-user-id': '99' });
    assert.equal(r.status, 403);
  } finally { server.close(); }
});
