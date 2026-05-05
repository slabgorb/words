import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { createUser, getUserByEmail, getUserById, listUsers, renameUser, PALETTE } from '../src/server/users.js';

test('createUser inserts and returns row', () => {
  const db = openDb(':memory:');
  const u = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  assert.equal(u.email, 'a@x.com');
  assert.equal(u.friendlyName, 'Alice');
  assert.ok(PALETTE.includes(u.color));
  assert.ok(typeof u.id === 'number');
});

test('createUser auto-picks the next unused palette color', () => {
  const db = openDb(':memory:');
  const colors = [];
  for (let i = 0; i < PALETTE.length; i++) {
    colors.push(createUser(db, { email: `u${i}@x.com`, friendlyName: `U${i}` }).color);
  }
  assert.deepEqual(colors, PALETTE);
});

test('createUser throws on duplicate email (case-insensitive)', () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  assert.throws(() => createUser(db, { email: 'A@X.COM', friendlyName: 'Alice2' }));
});

test('getUserByEmail is case-insensitive', () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const u = getUserByEmail(db, 'A@X.COM');
  assert.equal(u.email, 'a@x.com');
});

test('listUsers returns rows ordered by friendly_name', () => {
  const db = openDb(':memory:');
  createUser(db, { email: 'b@x.com', friendlyName: 'Bob' });
  createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  const xs = listUsers(db);
  assert.deepEqual(xs.map(u => u.friendlyName), ['Alice', 'Bob']);
});

test('renameUser updates friendly_name', () => {
  const db = openDb(':memory:');
  const u = createUser(db, { email: 'a@x.com', friendlyName: 'Alice' });
  renameUser(db, 'a@x.com', 'Allison');
  assert.equal(getUserById(db, u.id).friendlyName, 'Allison');
});
