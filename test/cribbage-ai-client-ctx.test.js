import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { mountRoutes } from '../src/server/routes.js';
import { mountPluginClients } from '../src/server/plugin-clients.js';
import { buildRegistry } from '../src/server/plugins.js';
import cribbagePlugin from '../plugins/cribbage/plugin.js';
import { bootAiSubsystem } from '../src/server/ai/index.js';

async function GET(port, path) {
  const r = await fetch(`http://localhost:${port}${path}`);
  return { status: r.status, text: await r.text() };
}
async function POST(port, path, body) {
  const r = await fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test('plugin-clients: bot opponent ctx uses persona displayName/color/glyph, not bot user row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
  const personaDir = join(dir, 'personas');
  mkdirSync(personaDir);
  writeFileSync(join(personaDir, 'hattie.yaml'),
    'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: hi\n');
  const db = openDb(join(dir, 'db.db'));

  const now = Date.now();
  const humanId = db.prepare("INSERT INTO users (email, friendly_name, color, created_at) VALUES ('h@x','H','#000',?) RETURNING id").get(now).id;

  const { orchestrator, personas } = bootAiSubsystem({
    db, sse: { broadcast: () => {} },
    llm: { send: async () => ({ text: '{"moveId":"x","banter":""}' }) },
    personaDir,
  });
  const botId = db.prepare("SELECT id FROM users WHERE is_bot=1").get().id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: humanId, friendlyName: 'H' }; req.authEmail = 'h@x'; next(); });
  const registry = buildRegistry({ cribbage: cribbagePlugin });
  mountRoutes(app, { db, registry, sse: { broadcast: () => {} }, ai: { orchestrator, personas } });
  mountPluginClients(app, { db, registry, ai: { orchestrator, personas } });

  const srv = http.createServer(app);
  await new Promise(r => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const create = await POST(port, '/api/games', { opponentId: botId, gameType: 'cribbage', personaId: 'hattie' });
    const html = (await GET(port, `/play/cribbage/${create.body.id}/`)).text;
    const m = html.match(/window\.__GAME__\s*=\s*(\{[^<]*\})/);
    assert.ok(m, 'ctx is injected');
    const ctx = JSON.parse(m[1]);
    assert.equal(ctx.opponentFriendlyName, 'Hattie');
    assert.equal(ctx.opponentColor, '#ec4899');
    assert.equal(ctx.opponentGlyph, '♡');
    assert.equal(ctx.opponentPersonaId, 'hattie');
  } finally {
    srv.close();
  }
});
