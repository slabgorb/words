import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';
import { mountPluginClients } from '../src/server/plugin-clients.js';

function makeStubPluginDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamebox-stub-'));
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<!doctype html><html><head><title>Stub</title></head><body>Hi</body></html>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("stub");');
  return dir;
}

async function setup() {
  const clientDir = makeStubPluginDir();
  const stub = {
    id: 'stub',
    displayName: 'Stub',
    players: 2,
    clientDir,
    initialState: () => ({}),
    applyAction: ({ state }) => ({ state, ended: false }),
    publicView: ({ state }) => state,
  };

  const app = express();
  app.use(express.json());
  const db = openDb(':memory:');
  const now = Date.now();
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (1, 'a@b', 'A', '#f00', ?)").run(now);
  db.prepare("INSERT INTO users (id, email, friendly_name, color, created_at) VALUES (2, 'b@b', 'B', '#0f0', ?)").run(now);
  db.prepare(`INSERT INTO games (id, player_a_id, player_b_id, status, game_type, state, created_at, updated_at)
              VALUES (42, 1, 2, 'active', 'stub', '{}', ?, ?)`).run(now, now);

  app.use((req, res, next) => {
    const id = Number(req.header('x-test-user-id'));
    if (!id) return res.status(401).end();
    const friendlyNames = { 1: 'A', 2: 'B' };
    req.user = { id, friendlyName: friendlyNames[id] ?? null };
    req.authEmail = `${id}@test`;
    next();
  });
  mountRoutes(app, { db, registry: { stub }, sse: { broadcast: () => {} } });
  mountPluginClients(app, { db, registry: { stub } });

  const server = await new Promise(resolve => {
    const s = http.createServer(app);
    s.listen(0, () => resolve(s));
  });
  return { server, clientDir };
}

function cleanup({ server, clientDir }) {
  server.close();
  try { fs.rmSync(clientDir, { recursive: true, force: true }); } catch {}
}

test('GET /play/:type/:id/ serves index.html with __GAME__ injected', async () => {
  const ctx = await setup();
  try {
    const port = ctx.server.address().port;
    const res = await fetch(`http://localhost:${port}/play/stub/42/`, { headers: { 'x-test-user-id': '1' } });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /window\.__GAME__/);
    assert.match(body, /"gameId":\s*42/);
    assert.match(body, /"userId":\s*1/);
    assert.match(body, /"gameType":\s*"stub"/);
    assert.match(body, /"yourFriendlyName":\s*"A"/);
    assert.match(body, /"opponentFriendlyName":\s*"B"/);
    assert.match(body, /Hi/);
  } finally { cleanup(ctx); }
});

test('GET /play/:type/:id/app.js serves the static asset (no injection)', async () => {
  const ctx = await setup();
  try {
    const port = ctx.server.address().port;
    const res = await fetch(`http://localhost:${port}/play/stub/42/app.js`, { headers: { 'x-test-user-id': '1' } });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.equal(body.trim(), 'console.log("stub");');
  } finally { cleanup(ctx); }
});

test('GET /play/wrong/42/ returns 404 (plugin id mismatch)', async () => {
  const ctx = await setup();
  try {
    const port = ctx.server.address().port;
    const res = await fetch(`http://localhost:${port}/play/wrong/42/`, { headers: { 'x-test-user-id': '1' } });
    assert.equal(res.status, 404);
  } finally { cleanup(ctx); }
});

test('GET /play/stub/999/ returns 404 (no such game)', async () => {
  const ctx = await setup();
  try {
    const port = ctx.server.address().port;
    const res = await fetch(`http://localhost:${port}/play/stub/999/`, { headers: { 'x-test-user-id': '1' } });
    assert.equal(res.status, 404);
  } finally { cleanup(ctx); }
});

test('non-participant gets 403', async () => {
  const ctx = await setup();
  try {
    const port = ctx.server.address().port;
    const res = await fetch(`http://localhost:${port}/play/stub/42/`, { headers: { 'x-test-user-id': '99' } });
    assert.equal(res.status, 403);
  } finally { cleanup(ctx); }
});
