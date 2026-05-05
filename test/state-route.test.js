import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';

const hidingPlugin = {
  id: 'hide',
  displayName: 'Hide',
  players: 2,
  clientDir: 'plugins/hide/client',
  initialState: () => ({ activeUserId: 1, racks: { a: ['secret-a'], b: ['secret-b'] } }),
  applyAction: ({ state }) => ({ state, ended: false }),
  publicView: ({ state, viewerId }) => {
    const seenSide = viewerId === 1 ? 'a' : 'b';
    return {
      ...state,
      racks: { [seenSide]: state.racks[seenSide], [seenSide === 'a' ? 'b' : 'a']: null },
    };
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
              VALUES (1, 1, 2, 'active', 'hide', ?, ?, ?)`)
    .run(JSON.stringify({ activeUserId: 1, racks: { a: ['secret-a'], b: ['secret-b'] } }), now, now);

  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id };
    next();
  });

  mountRoutes(app, { db, registry: { hide: hidingPlugin }, sse: { broadcast: () => {} } });
  const server = await new Promise(resolve => {
    const s = http.createServer(app);
    s.listen(0, () => resolve(s));
  });
  return { app, db, server };
}

async function get(server, path, headers = {}) {
  const port = server.address().port;
  const res = await fetch(`http://localhost:${port}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('GET /api/games/:id filters opponent rack for viewer (side a)', async () => {
  const { server } = await setupApp();
  try {
    const r = await get(server, '/api/games/1', { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.state.racks.a, ['secret-a']);
    assert.equal(r.body.state.racks.b, null);
  } finally { server.close(); }
});

test('GET /api/games/:id filters opponent rack for viewer (side b)', async () => {
  const { server } = await setupApp();
  try {
    const r = await get(server, '/api/games/1', { 'x-test-user-id': '2' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.state.racks.b, ['secret-b']);
    assert.equal(r.body.state.racks.a, null);
  } finally { server.close(); }
});

test('GET /api/games/:id 404 for missing game', async () => {
  const { server } = await setupApp();
  try {
    const r = await get(server, '/api/games/999', { 'x-test-user-id': '1' });
    assert.equal(r.status, 404);
  } finally { server.close(); }
});

test('GET /api/games/:id 403 for non-participant', async () => {
  const { server } = await setupApp();
  try {
    const r = await get(server, '/api/games/1', { 'x-test-user-id': '99' });
    assert.equal(r.status, 403);
  } finally { server.close(); }
});
