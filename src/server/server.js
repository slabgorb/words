import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { mountRoutes } from './routes.js';
import { mountPluginClients } from './plugin-clients.js';
import { plugins } from '../plugins/index.js';
import { buildRegistry } from './plugins.js';
import { attachIdentity } from './identity.js';
import { broadcast } from './sse.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? resolve(PROJECT_ROOT, 'game.db');
const isProd = process.env.NODE_ENV === 'production';
const devUser = process.env.DEV_USER || null;

const db = openDb(dbPath);
console.log(`[startup] database opened at ${dbPath}`);
if (!isProd && devUser) {
  console.log(`[startup] DEV_USER override active: ${devUser}`);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(attachIdentity({ db, isProd, devUser }));

const registry = buildRegistry(plugins);
mountRoutes(app, { db, registry, sse: { broadcast } });
mountPluginClients(app, { db, registry });

const PUBLIC = resolve(PROJECT_ROOT, 'public');
const LOBBY = resolve(PUBLIC, 'lobby');
app.use('/lobby', express.static(LOBBY));
app.get('/', (_req, res) => res.sendFile(resolve(LOBBY, 'lobby.html')));
app.get('/lockout', (_req, res) => res.sendFile(resolve(PUBLIC, 'lockout.html')));
app.use(express.static(PUBLIC));

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'server' });
});

app.listen(port, () => console.log(`[startup] listening on http://localhost:${port}`));
