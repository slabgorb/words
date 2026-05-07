import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

for (const f of ['index.html', 'style.css', 'app.js']) {
  test(`cribbage client has ${f}`, () => {
    assert.ok(existsSync(resolve(root, 'plugins/cribbage/client', f)), `missing ${f}`);
  });
}
