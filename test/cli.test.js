import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/server/db.js';
import { listUsers, getUserByEmail } from '../src/server/users.js';

function tmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'words-cli-'));
  return { dir, dbPath: join(dir, 'game.db') };
}

test('bin/add-user.js inserts a user', () => {
  const { dir, dbPath } = tmpDb();
  try {
    execFileSync('node', ['bin/add-user.js', 'mom@x.com', 'Mom'],
      { env: { ...process.env, DB_PATH: dbPath } });
    const db = openDb(dbPath);
    assert.equal(getUserByEmail(db, 'mom@x.com').friendlyName, 'Mom');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bin/add-user.js rejects duplicates', () => {
  const { dir, dbPath } = tmpDb();
  try {
    execFileSync('node', ['bin/add-user.js', 'mom@x.com', 'Mom'],
      { env: { ...process.env, DB_PATH: dbPath } });
    assert.throws(() => execFileSync(
      'node', ['bin/add-user.js', 'mom@x.com', 'Mom'],
      { env: { ...process.env, DB_PATH: dbPath }, stdio: 'pipe' }
    ));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bin/list-users.js prints rows', () => {
  const { dir, dbPath } = tmpDb();
  try {
    execFileSync('node', ['bin/add-user.js', 'a@x.com', 'Alice'],
      { env: { ...process.env, DB_PATH: dbPath } });
    const out = execFileSync('node', ['bin/list-users.js'],
      { env: { ...process.env, DB_PATH: dbPath } }).toString();
    assert.match(out, /a@x\.com/);
    assert.match(out, /Alice/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bin/rename-user.js updates friendly_name', () => {
  const { dir, dbPath } = tmpDb();
  try {
    execFileSync('node', ['bin/add-user.js', 'a@x.com', 'Alice'],
      { env: { ...process.env, DB_PATH: dbPath } });
    execFileSync('node', ['bin/rename-user.js', 'a@x.com', 'Allison'],
      { env: { ...process.env, DB_PATH: dbPath } });
    const db = openDb(dbPath);
    assert.equal(getUserByEmail(db, 'a@x.com').friendlyName, 'Allison');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
