import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

const stub = {
  id: 'stub', displayName: 'Stub', players: 2, clientDir: 'x',
  initialState: ({ participants }) => ({
    activeUserId: participants[0].userId,
    sides: { a: participants[0].userId, b: participants[1].userId },
  }),
  applyAction: ({ state }) => ({ state, ended: false }),
  publicView: ({ state }) => state,
};

async function setup() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  const now = Date.now();
  for (let i = 1; i <= 3; i++) {
    db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(i, `u${i}@b`, `User${i}`, '#000', now);
  }
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id };
    req.authEmail = `${id}@test`;
    next();
  });
  mountRoutes(app, { db, registry: { stub }, sse: { broadcast: () => {} } });
  const server = await new Promise(r => { const s = http.createServer(app); s.listen(0, () => r(s)); });
  return { server };
}

async function call(server, method, path, body, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('lobby data: GET /api/plugins lists registered plugins', async () => {
  const { server } = await setup();
  try {
    const r = await call(server, 'GET', '/api/plugins', null, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.plugins.length, 1);
    assert.equal(r.body.plugins[0].id, 'stub');
    assert.equal(r.body.plugins[0].displayName, 'Stub');
  } finally { server.close(); }
});

test('lobby data: GET /api/games + POST /api/games for current user', async () => {
  const { server } = await setup();
  try {
    await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
    const r = await call(server, 'GET', '/api/games', null, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.games.length, 1);
    assert.equal(r.body.games[0].gameType, 'stub');
    const g = r.body.games[0];
    const opponentId = g.playerAId === 1 ? g.playerBId : g.playerAId;
    assert.equal(opponentId, 2);
  } finally { server.close(); }
});
