import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

const stubPlugin = {
  id: 'stub', displayName: 'Stub', players: 2, clientDir: 'x',
  initialState: ({ participants }) => ({
    activeUserId: participants[0].userId,
    sides: { a: participants.find(p => p.side === 'a').userId, b: participants.find(p => p.side === 'b').userId },
    seeded: true,
  }),
  applyAction: ({ state }) => ({ state, ended: false }),
  publicView: ({ state }) => state,
};

async function setup() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f00', ?)").run(now);
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#0f0', ?)").run(now);
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id };
    next();
  });
  mountRoutes(app, { db, registry: { stub: stubPlugin }, sse: { broadcast: () => {} } });
  const server = await new Promise(r => { const s = http.createServer(app); s.listen(0, () => r(s)); });
  return { server, db };
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

test('POST /api/games creates a game with plugin initialState', async () => {
  const { server, db } = await setup();
  try {
    const r = await call(server, 'POST', '/api/games',
      { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.ok(r.body.id);
    assert.equal(r.body.gameType, 'stub');
    const row = db.prepare("SELECT state, game_type FROM games WHERE id = ?").get(r.body.id);
    assert.equal(row.game_type, 'stub');
    const state = JSON.parse(row.state);
    assert.equal(state.seeded, true);
  } finally { server.close(); }
});

test('POST /api/games 409 if pair already has active game of that type', async () => {
  const { server } = await setup();
  try {
    await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
    const r2 = await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
    assert.equal(r2.status, 409);
  } finally { server.close(); }
});

test('POST /api/games 400 on unknown game_type', async () => {
  const { server } = await setup();
  try {
    const r = await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'nope' }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 400);
  } finally { server.close(); }
});

test('POST /api/games 400 on opponentId == self', async () => {
  const { server } = await setup();
  try {
    const r = await call(server, 'POST', '/api/games', { opponentId: 1, gameType: 'stub' }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 400);
  } finally { server.close(); }
});

test('GET /api/games lists active games for current user', async () => {
  const { server } = await setup();
  try {
    await call(server, 'POST', '/api/games', { opponentId: 2, gameType: 'stub' }, { 'x-test-user-id': '1' });
    const r = await call(server, 'GET', '/api/games', null, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.games.length, 1);
    assert.equal(r.body.games[0].gameType, 'stub');
  } finally { server.close(); }
});
