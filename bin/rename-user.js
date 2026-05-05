#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/server/db.js';
import { renameUser, getUserByEmail } from '../src/server/users.js';

const [email, newName] = process.argv.slice(2);
if (!email || !newName) {
  console.error('Usage: node bin/rename-user.js <email> <new_name>');
  process.exit(2);
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const db = openDb(dbPath);

if (!getUserByEmail(db, email)) {
  console.error(`User ${email} not found`);
  process.exit(1);
}

renameUser(db, email, newName);
console.log(`Renamed ${email} → ${newName}`);
