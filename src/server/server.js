import express from 'express';
import cookieParser from 'cookie-parser';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { loadDictionary } from './dictionary.js';
import { buildRoutes } from './routes.js';
import { loadOrCreateSecret } from './identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const secretPath = process.env.SECRET_PATH ?? resolve(PROJECT_ROOT, '.secret');

const dict = loadDictionary();
console.log(`[startup] dictionary loaded (${dict.size} words)`);
const db = openDb(dbPath);
console.log(`[startup] database opened at ${dbPath}`);
const secret = loadOrCreateSecret(secretPath);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api', buildRoutes({ db, dict, secret }));
app.use(express.static(resolve(PROJECT_ROOT, 'public')));

// Top-level error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'server' });
});

app.listen(port, () => console.log(`[startup] listening on http://localhost:${port}`));
