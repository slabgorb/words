import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import { openDb, getGameState, persistMove, resetGame } from '../src/server/db.js';
import { buildRoutes } from '../src/server/routes.js';
import { loadDictionary } from '../src/server/dictionary.js';

function buildApp(db) {
  const dict = loadDictionary();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', buildRoutes({ db, dict, secret: 'test-secret' }));
  return app;
}

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function asPlayer(server, id) {
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/api/whoami`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: id })
  });
  const cookie = r.headers.get('set-cookie');
  return { url, cookie };
}

test('openDb creates schema, seeds players, seeds active game', () => {
  const db = openDb(':memory:');
  const players = db.prepare('SELECT * FROM players ORDER BY id').all();
  assert.equal(players.length, 2);
  assert.equal(players[0].id, 'keith');
  const state = getGameState(db);
  assert.equal(state.status, 'active');
  assert.equal(state.currentTurn, 'keith');
  assert.equal(state.racks.keith.length, 7);
  assert.equal(state.racks.sonia.length, 7);
  assert.equal(state.bag.length, 104 - 14);
});

test('persistMove updates state and inserts moves row', () => {
  const db = openDb(':memory:');
  const state = getGameState(db);
  state.scores.keith = 12;
  const result = persistMove(db, state, {
    playerId: 'keith', kind: 'play', placement: [{ r:7, c:7, letter:'A' }],
    wordsFormed: ['A'], scoreDelta: 12, clientNonce: 'n1'
  });
  assert.equal(result.idempotent, false);
  const after = getGameState(db);
  assert.equal(after.scores.keith, 12);
  const moves = db.prepare('SELECT * FROM moves').all();
  assert.equal(moves.length, 1);
});

test('persistMove with duplicate nonce is idempotent', () => {
  const db = openDb(':memory:');
  const state = getGameState(db);
  persistMove(db, state, { playerId:'keith', kind:'pass', clientNonce:'dup' });
  const second = persistMove(db, state, { playerId:'keith', kind:'pass', clientNonce:'dup' });
  assert.equal(second.idempotent, true);
  const moves = db.prepare('SELECT * FROM moves').all();
  assert.equal(moves.length, 1);
});

test('resetGame archives and reinitializes', () => {
  const db = openDb(':memory:');
  resetGame(db);
  const history = db.prepare('SELECT COUNT(*) AS n FROM game_history').get().n;
  assert.equal(history, 1);
  const state = getGameState(db);
  assert.equal(state.status, 'active');
});

test('GET /api/state requires identity', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const r = await fetch(`http://localhost:${server.address().port}/api/state`);
    assert.equal(r.status, 401);
  } finally { server.close(); }
});

test('POST /api/whoami sets cookie and GET /api/state returns state', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    const r = await fetch(`${url}/api/state`, { headers: { cookie } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.you, 'keith');
    assert.equal(body.currentTurn, 'keith');
  } finally { server.close(); }
});

test('POST /api/move from wrong player returns 409', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    // Active turn is keith; sonia tries to play.
    const { url, cookie } = await asPlayer(server, 'sonia');
    const r = await fetch(`${url}/api/move`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ placement: [{ r:7, c:7, letter:'A' }], clientNonce: 'n1' })
    });
    assert.equal(r.status, 409);
  } finally { server.close(); }
});

test('POST /api/move with bad placement returns 400', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    // First move not on center
    const r = await fetch(`${url}/api/move`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ placement: [{ r:0, c:0, letter:'A' }], clientNonce: 'n2' })
    });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.equal(body.error, 'placement-invalid');
  } finally { server.close(); }
});

test('POST /api/validate with non-word returns valid:false but 200', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    // Need a real placement — give keith's actual rack tiles. We don't know them; use generic tiles
    // and rely on validate accepting any placement (it doesn't check rack ownership for /validate).
    const r = await fetch(`${url}/api/validate`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ placement: [
        { r:7, c:6, letter:'X' }, { r:7, c:7, letter:'Q' }, { r:7, c:8, letter:'Z' }
      ]})
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.valid, false);
    assert.equal(body.score, 0);
  } finally { server.close(); }
});

test('POST /api/pass advances turn', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    const r = await fetch(`${url}/api/pass`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ clientNonce: 'p1' })
    });
    assert.equal(r.status, 200);
    const state = await (await fetch(`${url}/api/state`, { headers: { cookie } })).json();
    assert.equal(state.currentTurn, 'sonia');
    assert.equal(state.consecutiveScorelessTurns, 1);
  } finally { server.close(); }
});

test('POST /api/swap exchanges tiles', async () => {
  const db = openDb(':memory:');
  const app = buildApp(db);
  const server = await listen(app);
  try {
    const { url, cookie } = await asPlayer(server, 'keith');
    const stateBefore = await (await fetch(`${url}/api/state`, { headers: { cookie } })).json();
    const swapTiles = stateBefore.racks.keith.slice(0, 3);
    const r = await fetch(`${url}/api/swap`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ tiles: swapTiles, clientNonce: 's1' })
    });
    assert.equal(r.status, 200);
    const stateAfter = await (await fetch(`${url}/api/state`, { headers: { cookie } })).json();
    assert.equal(stateAfter.racks.keith.length, 7);
    assert.equal(stateAfter.bag.length, stateBefore.bag.length); // size unchanged
  } finally { server.close(); }
});
