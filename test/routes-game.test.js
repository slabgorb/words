import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import { createGame, getGameById } from '../src/server/games.js';
import { buildRoutes } from '../src/server/routes.js';
import { loadDictionary } from '../src/server/dictionary.js';

function buildApp(db, devUser) {
  const dict = loadDictionary();
  const app = express();
  app.use(express.json());
  app.use('/api', buildRoutes({ db, dict, isProd: false, devUser }));
  return app;
}
async function listen(app) { return new Promise(r => { const s = app.listen(0, () => r(s)); }); }
function urlOf(s) { return `http://localhost:${s.address().port}`; }

function setup() {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const c = createUser(db, { email: 'c@x.com', friendlyName: 'Charlie' });
  const g = createGame(db, a.id, b.id);
  return { db, a, b, c, g };
}

test('GET /api/games/:id/state returns snapshot for a participant', async () => {
  const { db, g } = setup();
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/state`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.you, 'a'); // Alice has lower id post-canonicalization
  assert.ok(body.opponent.friendlyName);
  assert.ok(Array.isArray(body.board));
  server.close();
});

test('GET /api/games/:id/state returns 403 for non-participant', async () => {
  const { db, g } = setup();
  const server = await listen(buildApp(db, 'c@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/state`);
  assert.equal(r.status, 403);
  server.close();
});

test('GET /api/games/:id/state returns 404 for missing game', async () => {
  const { db } = setup();
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/9999/state`);
  assert.equal(r.status, 404);
  server.close();
});

test('POST /api/games/:id/pass advances the turn', async () => {
  const { db, g } = setup();
  // Force currentTurn = 'a' so Alice can pass.
  db.prepare("UPDATE games SET current_turn='a' WHERE id=?").run(g.id);
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/pass`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientNonce: 'n1' })
  });
  assert.equal(r.status, 200);
  assert.equal(getGameById(db, g.id).currentTurn, 'b');
  server.close();
});

test('POST /api/games/:id/pass returns 409 when not your turn', async () => {
  const { db, g } = setup();
  db.prepare("UPDATE games SET current_turn='b' WHERE id=?").run(g.id);
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/pass`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientNonce: 'n1' })
  });
  assert.equal(r.status, 409);
  server.close();
});

test('POST /api/games/:id/new-game requires both players to confirm', async () => {
  const { db, g } = setup();
  db.prepare("UPDATE games SET status='ended', ended_reason='resigned', winner_side='a' WHERE id=?").run(g.id);
  const server = await listen(buildApp(db, 'a@x.com'));
  const url = urlOf(server);
  let r = await fetch(`${url}/api/games/${g.id}/new-game`, { method: 'POST' });
  assert.equal(r.status, 200);
  let body = await r.json();
  assert.equal(body.started, false);
  assert.ok(body.waitingFor);
  // Same caller pressing twice does not start a game.
  r = await fetch(`${url}/api/games/${g.id}/new-game`, { method: 'POST' });
  body = await r.json();
  assert.equal(body.started, false);
  server.close();

  // Bob now confirms.
  const server2 = await listen(buildApp(db, 'b@x.com'));
  const r2 = await fetch(`${urlOf(server2)}/api/games/${g.id}/new-game`, { method: 'POST' });
  const body2 = await r2.json();
  assert.equal(body2.started, true);
  assert.ok(body2.newGameId);
  assert.notEqual(body2.newGameId, g.id);
  server2.close();
});
