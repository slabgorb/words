import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';
import { plugins } from '../src/plugins/index.js';
import { buildRegistry } from '../src/server/plugins.js';

async function setup() {
  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'k@b', 'Keith', '#f00', ?)").run(now);
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 's@b', 'Sonia', '#0f0', ?)").run(now);
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id, email: id === 1 ? 'k@b' : 's@b', friendlyName: id === 1 ? 'Keith' : 'Sonia' };
    req.authEmail = req.user.email;
    next();
  });
  mountRoutes(app, { db, registry: buildRegistry(plugins), sse: { broadcast: () => {} } });
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

test('e2e: create rummikub game, draw + resign produces ended game', async () => {
  const { server } = await setup();

  const create = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(create.status, 200);
  const gameId = create.body.id;

  const stateA = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '1' });
  assert.equal(stateA.status, 200);
  assert.equal(stateA.body.gameType, 'rummikub');
  assert.equal(stateA.body.state.racks.a.length, 14);
  assert.equal(stateA.body.state.opponentRack.count, 14);
  assert.equal(stateA.body.state.pool.count, 78);

  const activeUser = stateA.body.state.activeUserId;
  const draw = await call(server, 'POST', `/api/games/${gameId}/action`,
    { type: 'draw-tile' }, { 'x-test-user-id': String(activeUser) });
  assert.equal(draw.status, 200);
  assert.equal(draw.body.ended, false);
  assert.equal(draw.body.state.activeUserId !== activeUser, true);

  const newActive = draw.body.state.activeUserId;
  const resign = await call(server, 'POST', `/api/games/${gameId}/action`,
    { type: 'resign' }, { 'x-test-user-id': String(newActive) });
  assert.equal(resign.status, 200);
  assert.equal(resign.body.ended, true);

  const final = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '1' });
  assert.equal(final.body.status, 'ended');

  // History captured both the draw, the resign, and the synthetic game-ended row.
  const hist = await call(server, 'GET', `/api/games/${gameId}/history`,
    null, { 'x-test-user-id': '1' });
  assert.equal(hist.status, 200);
  assert.ok(Array.isArray(hist.body.entries));
  const kinds = hist.body.entries.map(e => e.summary.kind);
  assert.ok(kinds.includes('draw-tile'), `expected draw-tile in ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes('resign'), `expected resign in ${JSON.stringify(kinds)}`);
  assert.equal(kinds[kinds.length - 1], 'game-ended');

  const create2 = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(create2.status, 200);

  server.close();
});

test('e2e: cannot have two active rummikub games with same opponent (409)', async () => {
  const { server } = await setup();
  const r1 = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(r1.status, 200);
  const r2 = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(r2.status, 409);
  server.close();
});

test('e2e: words and rummikub games can coexist with same opponent', async () => {
  const { server } = await setup();
  const w = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'words' }, { 'x-test-user-id': '1' });
  assert.equal(w.status, 200);
  const r = await call(server, 'POST', '/api/games',
    { opponentId: 2, gameType: 'rummikub' }, { 'x-test-user-id': '1' });
  assert.equal(r.status, 200);
  server.close();
});
