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
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'keith@b', 'Keith', '#f00', ?)").run(now);
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'sonia@b', 'Sonia', '#0f0', ?)").run(now);
  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    req.user = { id, email: id === 1 ? 'keith@b' : 'sonia@b', friendlyName: id === 1 ? 'Keith' : 'Sonia' };
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

test('end-to-end: create Words game, fetch state, resign, list, restart', async () => {
  const { server } = await setup();
  try {
    // Create
    const create = await call(server, 'POST', '/api/games',
      { opponentId: 2, gameType: 'words' }, { 'x-test-user-id': '1' });
    assert.equal(create.status, 200);
    const gameId = create.body.id;

    // Both sides can fetch state
    const stateA = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '1' });
    const stateB = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '2' });
    assert.equal(stateA.status, 200);
    assert.equal(stateB.status, 200);
    assert.ok(stateA.body.state.racks);
    assert.equal(stateA.body.state.opponentRack.count, 7);

    // Resign as the active player
    const activeUser = stateA.body.state.activeUserId;
    const r = await call(server, 'POST', `/api/games/${gameId}/action`,
      { type: 'resign' }, { 'x-test-user-id': String(activeUser) });
    assert.equal(r.status, 200);
    assert.equal(r.body.ended, true);

    // Game is now ended
    const after = await call(server, 'GET', `/api/games/${gameId}`, null, { 'x-test-user-id': '1' });
    assert.equal(after.body.status, 'ended');

    // History was written for the resign + game-ended turn entries.
    const hist = await call(server, 'GET', `/api/games/${gameId}/history`,
      null, { 'x-test-user-id': '1' });
    assert.equal(hist.status, 200);
    assert.ok(Array.isArray(hist.body.entries));
    assert.ok(hist.body.entries.length > 0, 'expected at least one history entry');
    const kinds = hist.body.entries.map(e => e.summary.kind);
    assert.ok(kinds.includes('resign'), `expected resign in ${JSON.stringify(kinds)}`);
    assert.ok(kinds.includes('game-ended'), `expected game-ended in ${JSON.stringify(kinds)}`);
    // Game-ended must follow the resign
    assert.equal(kinds[kinds.length - 1], 'game-ended');

    // Listing only shows active games — should be empty
    const list = await call(server, 'GET', '/api/games', null, { 'x-test-user-id': '1' });
    assert.equal(list.body.games.length, 0);

    // After ending, can start a new Words game with the same opponent
    const create2 = await call(server, 'POST', '/api/games',
      { opponentId: 2, gameType: 'words' }, { 'x-test-user-id': '1' });
    assert.equal(create2.status, 200);
  } finally { server.close(); }
});

test('end-to-end: validate aux route returns structured response', async () => {
  const { server } = await setup();
  try {
    const create = await call(server, 'POST', '/api/games',
      { opponentId: 2, gameType: 'words' }, { 'x-test-user-id': '1' });
    const gameId = create.body.id;

    // We don't know the rack contents (random), but we can call validate with
    // an invalid placement and assert we get a structured response.
    const r = await call(server, 'POST', `/api/games/${gameId}/validate`,
      { placement: [{ r: 0, c: 0, letter: 'A' }] }, { 'x-test-user-id': '1' });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.valid, 'boolean');
  } finally { server.close(); }
});
