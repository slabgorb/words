import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPersonaCatalog } from '../src/server/ai/persona-catalog.js';

function makeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'personas-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test('loadPersonaCatalog: reads YAML files into a Map keyed by id', () => {
  const dir = makeDir({
    'hattie.yaml': 'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: hello\n',
  });
  const catalog = loadPersonaCatalog(dir);
  assert.equal(catalog.size, 1);
  const p = catalog.get('hattie');
  assert.equal(p.displayName, 'Hattie');
  assert.equal(p.color, '#ec4899');
  assert.equal(p.glyph, '♡');
  assert.equal(p.systemPrompt, 'hello');
});

test('loadPersonaCatalog: rejects file whose id mismatches filename', () => {
  const dir = makeDir({
    'wrong.yaml': 'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: x\n',
  });
  assert.throws(() => loadPersonaCatalog(dir), /id 'hattie' does not match filename 'wrong'/);
});

test('loadPersonaCatalog: rejects missing required field', () => {
  const dir = makeDir({
    'broken.yaml': 'id: broken\ndisplayName: Broken\n',
  });
  assert.throws(() => loadPersonaCatalog(dir), /missing required field/);
});

test('loadPersonaCatalog: ignores non-yaml files', () => {
  const dir = makeDir({
    'hattie.yaml': 'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\nsystemPrompt: x\n',
    'README.md': 'notes',
  });
  assert.equal(loadPersonaCatalog(dir).size, 1);
});

test('loadPersonaCatalog: rejects voiceExamples with non-string element', () => {
  const dir = makeDir({
    'bad.yaml': 'id: bad\ndisplayName: Bad\ncolor: "#000000"\nglyph: "x"\nsystemPrompt: x\nvoiceExamples:\n  - "ok"\n  - 123\n',
  });
  assert.throws(() => loadPersonaCatalog(dir), /voiceExamples must be/);
});

test('loadPersonaCatalog: reads optional games array', () => {
  const dir = makeDir({
    'hattie.yaml':
      'id: hattie\ndisplayName: Hattie\ncolor: "#ec4899"\nglyph: "♡"\n' +
      'systemPrompt: x\ngames:\n  - cribbage\n  - backgammon\n',
  });
  const p = loadPersonaCatalog(dir).get('hattie');
  assert.deepEqual(p.games, ['cribbage', 'backgammon']);
});

test('loadPersonaCatalog: defaults games to empty array when omitted', () => {
  const dir = makeDir({
    'omni.yaml':
      'id: omni\ndisplayName: Omni\ncolor: "#000000"\nglyph: "*"\nsystemPrompt: x\n',
  });
  assert.deepEqual(loadPersonaCatalog(dir).get('omni').games, []);
});

test('loadPersonaCatalog: rejects games with non-string element', () => {
  const dir = makeDir({
    'bad.yaml':
      'id: bad\ndisplayName: Bad\ncolor: "#000000"\nglyph: "x"\n' +
      'systemPrompt: x\ngames:\n  - cribbage\n  - 42\n',
  });
  assert.throws(() => loadPersonaCatalog(dir), /games must be/);
});

test('loadPersonaCatalog: rejects games when not an array', () => {
  const dir = makeDir({
    'bad.yaml':
      'id: bad\ndisplayName: Bad\ncolor: "#000000"\nglyph: "x"\n' +
      'systemPrompt: x\ngames: cribbage\n',
  });
  assert.throws(() => loadPersonaCatalog(dir), /games must be/);
});
