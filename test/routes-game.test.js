import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import { createGame, getGameById } from '../src/server/games.js';
import { mountRoutes } from '../src/server/routes.js';
import { attachIdentity } from '../src/server/identity.js';
import wordsPlugin from '../plugins/words/plugin.js';

function buildApp(db, devUser) {
  const app = express();
  app.use(express.json());
  app.use(attachIdentity({ db, isProd: false, devUser }));
  const registry = { words: wordsPlugin };
  const sse = { broadcast: () => {} };
  mountRoutes(app, { db, registry, sse });
  return app;
}

async function listen(app) { return new Promise(r => { const s = app.listen(0, () => r(s)); }); }
function urlOf(s) { return `http://localhost:${s.address().port}`; }

function makeWordsGame(db, p1, p2) {
  const lo = Math.min(p1, p2), hi = Math.max(p1, p2);
  const participants = [{ userId: lo, side: 'a' }, { userId: hi, side: 'b' }];
  const initialState = wordsPlugin.initialState({ participants, rng: Math.random });
  return createGame(db, { playerAId: lo, playerBId: hi, gameType: 'words', initialState });
}

function setup() {
  const db = openDb(':memory:');
  const a = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const b = createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  const c = createUser(db, { email: 'c@x.com', friendlyName: 'Charlie' });
  const g = makeWordsGame(db, a.id, b.id);
  return { db, a, b, c, g };
}

test('POST /api/games/:id/action (pass) advances the turn', async () => {
  const { db, a, g } = setup();
  // Force activeUserId = player a's id so Alice can pass.
  const _stateA = JSON.parse(db.prepare('SELECT state FROM games WHERE id=?').get(g.id).state);
  _stateA.activeUserId = _stateA.sides.a;
  db.prepare("UPDATE games SET state=? WHERE id=?").run(JSON.stringify(_stateA), g.id);
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/action`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'pass' })
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok('state' in body, 'response should have state field');
  assert.equal(getGameById(db, g.id).currentTurn, 'b');
  server.close();
});

test('POST /api/games/:id/action (pass) returns 422 when not your turn', async () => {
  const { db, g } = setup();
  // Force activeUserId = player b's id so Alice cannot pass.
  const _stateB = JSON.parse(db.prepare('SELECT state FROM games WHERE id=?').get(g.id).state);
  _stateB.activeUserId = _stateB.sides.b;
  db.prepare("UPDATE games SET state=? WHERE id=?").run(JSON.stringify(_stateB), g.id);
  const server = await listen(buildApp(db, 'a@x.com'));
  const r = await fetch(`${urlOf(server)}/api/games/${g.id}/action`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'pass' })
  });
  assert.equal(r.status, 422);
  server.close();
});
