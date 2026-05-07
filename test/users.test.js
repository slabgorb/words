import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/server/db.js';
import { createUser, getUserByEmail, getUserById, listUsers, renameUser, PALETTE, GLYPHS } from '../src/server/users.js';

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

test('renameUser throws when email is unknown', () => {
  const db = openDb(':memory:');
  assert.throws(() => renameUser(db, 'nope@x.com', 'Nobody'), /user not found/i);
});

test('createUser auto-picks glyph and cycles by least-used', () => {
  const db = openDb(':memory:');
  const glyphs = [];
  // Create 2 full cycles
  for (let i = 0; i < GLYPHS.length * 2; i++) {
    glyphs.push(createUser(db, { email: `g${i}@x.com`, friendlyName: `G${i}` }).glyph);
  }
  // First N entries match the GLYPHS order (every glyph at count=0 — picker returns first).
  assert.deepEqual(glyphs.slice(0, GLYPHS.length), GLYPHS);
  // Second cycle: every glyph appears exactly twice across 2N inserts.
  for (const g of GLYPHS) {
    assert.equal(glyphs.filter(x => x === g).length, 2, `glyph ${g} used twice`);
  }
});

test('createUser honors explicit glyph', () => {
  const db = openDb(':memory:');
  const u = createUser(db, { email: 'a@x.com', friendlyName: 'Alice', glyph: '★' });
  assert.equal(u.glyph, '★');
});
