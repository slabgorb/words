#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/server/db.js';
import { createUser, getUserByEmail } from '../src/server/users.js';

const [email, friendlyName, color] = process.argv.slice(2);
if (!email || !friendlyName) {
  console.error('Usage: node bin/add-user.js <email> <friendly_name> [color]');
  process.exit(2);
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const db = openDb(dbPath);

if (getUserByEmail(db, email)) {
  console.error(`User ${email} already exists`);
  process.exit(1);
}

const u = createUser(db, { email, friendlyName, color });
console.log(`Added ${u.friendlyName} <${u.email}> (color ${u.color})`);
