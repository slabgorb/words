import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPersonaCatalog } from '../src/server/ai/persona-catalog.js';

// Lightweight assembly mirroring how src/server/routes.js mounts the personas route.
function mountPersonasRoute({ ai }) {
  const app = express();
  app.use((req, _res, next) => { req.user = { id: 1, email: 'h@x' }; next(); });
  app.get('/api/ai/personas', (req, res) => {
    if (!ai) return res.json({ personas: [] });
    const game = typeof req.query.game === 'string' ? req.query.game : null;
    const out = [];
    for (const p of ai.personas.values()) {
      if (game && p.games.length > 0 && !p.games.includes(game)) continue;
      out.push({ id: p.id, displayName: p.displayName, color: p.color, glyph: p.glyph, games: p.games });
    }
    res.json({ personas: out });
  });
  return app;
}

function makeCatalog(files) {
  const dir = mkdtempSync(join(tmpdir(), 'personas-route-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return loadPersonaCatalog(dir);
}

async function fetchPersonas(app, qs = '') {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/ai/personas${qs}`);
    return await res.json();
  } finally {
    server.close();
  }
}

test('personas route: returns all personas when no game param', async () => {
  const personas = makeCatalog({
    'hattie.yaml':     'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: x\ngames:\n  - cribbage\n',
    'colonel-pip.yaml':'id: colonel-pip\ndisplayName: Colonel Pip\ncolor: "#445566"\nglyph: "▲"\nsystemPrompt: x\ngames:\n  - backgammon\n',
    'omni.yaml':       'id: omni\ndisplayName: Omni\ncolor: "#000000"\nglyph: "*"\nsystemPrompt: x\n',
  });
  const app = mountPersonasRoute({ ai: { personas } });
  const body = await fetchPersonas(app);
  assert.equal(body.personas.length, 3);
});

test('personas route: filters by ?game=backgammon', async () => {
  const personas = makeCatalog({
    'hattie.yaml':     'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: x\ngames:\n  - cribbage\n',
    'colonel-pip.yaml':'id: colonel-pip\ndisplayName: Colonel Pip\ncolor: "#445566"\nglyph: "▲"\nsystemPrompt: x\ngames:\n  - backgammon\n',
    'omni.yaml':       'id: omni\ndisplayName: Omni\ncolor: "#000000"\nglyph: "*"\nsystemPrompt: x\n',
  });
  const app = mountPersonasRoute({ ai: { personas } });
  const body = await fetchPersonas(app, '?game=backgammon');
  const ids = body.personas.map(p => p.id).sort();
  assert.deepEqual(ids, ['colonel-pip', 'omni']);
});

test('GET /api/ai/personas?game=words returns only words-scoped personas', async () => {
  const personas = makeCatalog({
    'samantha.yaml':   'id: samantha\ndisplayName: Samantha\ncolor: "#ec4899"\nglyph: "S"\nsystemPrompt: x\ngames:\n  - words\n',
    'suzie.yaml':      'id: suzie\ndisplayName: Suzie\ncolor: "#10b981"\nglyph: "Z"\nsystemPrompt: x\ngames:\n  - words\n',
    'kurt.yaml':       'id: kurt\ndisplayName: Kurt\ncolor: "#f59e0b"\nglyph: "K"\nsystemPrompt: x\ngames:\n  - words\n',
    'hattie.yaml':     'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: x\ngames:\n  - cribbage\n',
    'mr-snake.yaml':   'id: mr-snake\ndisplayName: Mr. Snake\ncolor: "#22c55e"\nglyph: "~"\nsystemPrompt: x\ngames:\n  - cribbage\n',
    'colonel-pip.yaml':'id: colonel-pip\ndisplayName: Colonel Pip\ncolor: "#445566"\nglyph: "▲"\nsystemPrompt: x\ngames:\n  - backgammon\n',
    'aunt-irene.yaml': 'id: aunt-irene\ndisplayName: Aunt Irene\ncolor: "#a855f7"\nglyph: "I"\nsystemPrompt: x\ngames:\n  - backgammon\n',
  });
  const app = mountPersonasRoute({ ai: { personas } });
  const body = await fetchPersonas(app, '?game=words');
  const ids = body.personas.map(p => p.id).sort();
  // The three words personas should all appear; no cribbage/backgammon
  // personas should leak through.
  for (const id of ['samantha', 'suzie', 'kurt']) {
    assert.ok(ids.includes(id), `expected '${id}' in ${ids.join(',')}`);
  }
  for (const id of ['hattie', 'mr-snake', 'colonel-pip', 'aunt-irene']) {
    assert.equal(ids.includes(id), false, `'${id}' should not appear in words scope`);
  }
});

test('personas route: empty when AI not booted', async () => {
  const app = mountPersonasRoute({ ai: null });
  const body = await fetchPersonas(app);
  assert.deepEqual(body.personas, []);
});
