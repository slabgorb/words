#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/server/db.js';
import { listUsers } from '../src/server/users.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const db = openDb(dbPath);

const xs = listUsers(db);
if (xs.length === 0) { console.log('(no users yet — add one with bin/add-user.js)'); process.exit(0); }
const padName = Math.max(...xs.map(u => u.friendlyName.length));
const padEmail = Math.max(...xs.map(u => u.email.length));
for (const u of xs) {
  console.log(`${u.id.toString().padStart(3)}  ${u.friendlyName.padEnd(padName)}  ${u.email.padEnd(padEmail)}  ${u.color}`);
}
