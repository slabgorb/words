// Downloads ENABLE2K word list to data/enable2k.txt.
// Source: dwyl/english-words "words_alpha.txt" mirror is convenient and stable;
// for a true ENABLE2K we use the canonical file from the official mirror.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, '..', 'data', 'enable2k.txt');
// Canonical ENABLE2K mirror (public domain).
const url = 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt';

if (existsSync(target)) {
  console.log(`Dictionary already present at ${target}; skipping.`);
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true });
console.log(`Fetching ${url} ...`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`Fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const text = await res.text();
const words = text.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(w => w.length > 0);
writeFileSync(target, words.join('\n') + '\n', 'utf8');
console.log(`Wrote ${words.length} words to ${target}`);
