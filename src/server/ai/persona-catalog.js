import { readdirSync, readFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import yaml from 'js-yaml';

const REQUIRED = ['id', 'displayName', 'color', 'glyph', 'systemPrompt'];

export function loadPersonaCatalog(dir) {
  const out = new Map();
  for (const file of readdirSync(dir)) {
    if (extname(file) !== '.yaml') continue;
    const expectedId = basename(file, '.yaml');
    const raw = yaml.load(readFileSync(join(dir, file), 'utf8'));
    if (!raw || typeof raw !== 'object') {
      throw new Error(`persona ${file}: not an object`);
    }
    for (const field of REQUIRED) {
      if (typeof raw[field] !== 'string' || raw[field].length === 0) {
        throw new Error(`persona ${file}: missing required field '${field}'`);
      }
    }
    if (raw.id !== expectedId) {
      throw new Error(`persona ${file}: id '${raw.id}' does not match filename '${expectedId}'`);
    }
    if (raw.voiceExamples !== undefined) {
      if (!Array.isArray(raw.voiceExamples) || raw.voiceExamples.some(v => typeof v !== 'string' || v.length === 0)) {
        throw new Error(`persona ${file}: voiceExamples must be an array of non-empty strings`);
      }
    }
    if (raw.games !== undefined) {
      if (!Array.isArray(raw.games) || raw.games.some(g => typeof g !== 'string' || g.length === 0)) {
        throw new Error(`persona ${file}: games must be an array of non-empty strings`);
      }
    }
    out.set(raw.id, {
      id: raw.id,
      displayName: raw.displayName,
      color: raw.color,
      glyph: raw.glyph,
      systemPrompt: raw.systemPrompt,
      voiceExamples: Array.isArray(raw.voiceExamples) ? raw.voiceExamples : [],
      games: Array.isArray(raw.games) ? raw.games : [],
    });
  }
  return out;
}
