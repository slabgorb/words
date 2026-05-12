import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Trie } from '@kamilmielnik/trie';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENABLE_PATH = resolve(__dirname, '..', '..', '..', '..', 'data', 'enable2k.txt');

let _trie = null;

export function getEnableTrie() {
  if (_trie) return _trie;
  const t = new Trie();
  const raw = readFileSync(ENABLE_PATH, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const w = line.trim().toUpperCase();
    if (w.length >= 2) t.add(w);
  }
  _trie = t;
  return _trie;
}
