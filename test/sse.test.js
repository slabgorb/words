import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { subscribe, broadcast, subscriberCount } from '../src/server/sse.js';

function buildApp() {
  const app = express();
  app.get('/events/:id', (req, res) => subscribe(Number(req.params.id), req, res));
  return app;
}

async function listen(app) {
  return new Promise(r => { const s = app.listen(0, () => r(s)); });
}

test('subscribers are scoped per gameId', async () => {
  const app = buildApp();
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const c1 = new AbortController(), c2 = new AbortController();
  const r1 = fetch(`${url}/events/1`, { signal: c1.signal });
  const r2 = fetch(`${url}/events/2`, { signal: c2.signal });
  // Yield long enough for the connections to register.
  await new Promise(r => setTimeout(r, 50));
  assert.equal(subscriberCount(1), 1);
  assert.equal(subscriberCount(2), 1);
  c1.abort(); c2.abort();
  await Promise.allSettled([r1, r2]);
  server.close();
});

test('broadcast(gameId) only fans out to that game', async () => {
  const app = buildApp();
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const c1 = new AbortController();
  const r1 = fetch(`${url}/events/7`, { signal: c1.signal });
  await new Promise(r => setTimeout(r, 50));
  let chunks = '';
  r1.then(async resp => {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks += dec.decode(value);
    }
  }).catch(() => {});

  broadcast(7, { type: 'move', payload: { hi: 1 } });
  broadcast(8, { type: 'move', payload: { hi: 2 } });
  await new Promise(r => setTimeout(r, 50));
  c1.abort();
  await new Promise(r => setTimeout(r, 50));
  assert.match(chunks, /event: move/);
  assert.match(chunks, /"hi":1/);
  assert.equal(/"hi":2/.test(chunks), false);
  server.close();
});
