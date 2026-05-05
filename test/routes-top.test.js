import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import { mountRoutes } from '../src/server/routes.js';
import { attachIdentity } from '../src/server/identity.js';
import wordsPlugin from '../plugins/words/plugin.js';

function buildApp(db, devUser = null) {
  const app = express();
  app.use(express.json());
  app.use(attachIdentity({ db, isProd: false, devUser }));
  const registry = { words: wordsPlugin };
  const sse = { broadcast: () => {} };
  mountRoutes(app, { db, registry, sse });
  return app;
}
async function listen(app) { return new Promise(r => { const s = app.listen(0, () => r(s)); }); }
function urlOf(server) { return `http://localhost:${server.address().port}`; }

test('GET /api/me returns user and games list', async () => {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/me`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.user.email, 'a@x.com');
  assert.equal(body.user.friendlyName, 'Alice');
  assert.deepEqual(body.games, []);
  server.close();
});

test('GET /api/users returns roster without emails', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/users`);
  assert.equal(r.status, 200);
  const xs = await r.json();
  assert.equal(xs.length, 2);
  assert.ok(xs[0].id);
  assert.ok(xs[0].friendlyName);
  assert.ok(xs[0].color);
  assert.equal(xs[0].email, undefined);
  server.close();
});

test('POST /api/games creates a game between two users', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ opponentId: b.id, gameType: 'words' })
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.id);
  server.close();
});

test('POST /api/games returns 409 if active pair already exists', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const url = urlOf(server);
  await fetch(`${url}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opponentId: b.id, gameType: 'words' }) });
  const r = await fetch(`${url}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opponentId: b.id, gameType: 'words' }) });
  assert.equal(r.status, 409);
  server.close();
});

test('POST /api/games returns 400 on self-pairing', async () => {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ opponentId: a.id, gameType: 'words' })
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /api/games returns 400 on unknown user', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ opponentId: 999, gameType: 'words' })
  });
  assert.equal(r.status, 400);
  server.close();
});
