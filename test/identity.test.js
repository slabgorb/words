import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../src/server/db.js';
import { createUser } from '../src/server/users.js';
import { attachIdentity, requireIdentity } from '../src/server/identity.js';

function buildApp(opts) {
  const app = express();
  app.use(attachIdentity(opts));
  app.get('/me', requireIdentity, (req, res) => res.json({ email: req.user.email, id: req.user.id }));
  return app;
}

async function listen(app) {
  return new Promise(r => { const s = app.listen(0, () => r(s)); });
}

test('attachIdentity reads CF-Access header in production', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const app = buildApp({ db, isProd: true });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`, { headers: { 'cf-access-authenticated-user-email': 'a@x.com' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).email, 'a@x.com');
  server.close();
});

test('requireIdentity returns 401 when no header in prod', async () => {
  const db = openDb(':memory:');
  const app = buildApp({ db, isProd: true });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`);
  assert.equal(r.status, 401);
  server.close();
});

test('requireIdentity returns 403 when header email is not in users (lockout)', async () => {
  const db = openDb(':memory:');
  const app = buildApp({ db, isProd: true });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`, { headers: { 'cf-access-authenticated-user-email': 'unknown@x.com' } });
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.equal(body.error, 'not-on-roster');
  assert.equal(body.email, 'unknown@x.com');
  server.close();
});

test('DEV_USER fallback works in dev when header is missing', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const app = buildApp({ db, isProd: false, devUser: 'a@x.com' });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).email, 'a@x.com');
  server.close();
});

test('DEV_USER is ignored in production', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const app = buildApp({ db, isProd: true, devUser: 'a@x.com' });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`);
  assert.equal(r.status, 401);
  server.close();
});

test('email lookup is case-insensitive', async () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const app = buildApp({ db, isProd: true });
  const server = await listen(app);
  const url = `http://localhost:${server.address().port}`;
  const r = await fetch(`${url}/me`, { headers: { 'cf-access-authenticated-user-email': 'A@X.COM' } });
  assert.equal(r.status, 200);
  server.close();
});
