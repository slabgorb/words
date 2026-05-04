import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dirname, '..', '..', 'data', 'enable2k.txt');

export function loadDictionary(path = DEFAULT_PATH) {
  if (!existsSync(path)) {
    throw new Error(`Dictionary file missing: ${path}. Run \`npm run fetch-dict\` first.`);
  }
  const raw = readFileSync(path, 'utf8');
  const set = new Set(raw.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(Boolean));
  return {
    size: set.size,
    isWord: (s) => set.has(String(s).toUpperCase())
  };
}
