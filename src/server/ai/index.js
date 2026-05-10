import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadPersonaCatalog } from './persona-catalog.js';
import { createOrchestrator } from './orchestrator.js';
import { listStalledOrInFlight } from './agent-session.js';
import { ClaudeCliClient } from './llm-client.js';
import cribbagePlugin from '../../../plugins/cribbage/plugin.js';
import { chooseAction as cribbageChoose } from '../../../plugins/cribbage/server/ai/cribbage-player.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_PERSONA_DIR = resolve(PROJECT_ROOT, 'data', 'ai-personas');
const DEFAULT_BOT_EMAIL = 'ai+default@bot.local';
const DEFAULT_BOT_NAME = 'AI Opponent';

function ensureBotUser(db) {
  const existing = db.prepare("SELECT id FROM users WHERE is_bot = 1 LIMIT 1").get();
  if (existing) return existing.id;
  const now = Date.now();
  return db.prepare(`
    INSERT INTO users (email, friendly_name, color, glyph, is_bot, created_at)
    VALUES (?, ?, ?, ?, 1, ?) RETURNING id
  `).get(DEFAULT_BOT_EMAIL, DEFAULT_BOT_NAME, '#888888', '✦', now).id;
}

export function bootAiSubsystem({ db, sse, llm, personaDir = DEFAULT_PERSONA_DIR }) {
  if (!existsSync(personaDir)) {
    throw new Error(`AI persona directory not found: ${personaDir}`);
  }
  const catalog = loadPersonaCatalog(personaDir);
  if (catalog.size === 0) throw new Error(`No personas loaded from ${personaDir}`);
  ensureBotUser(db);

  const client = llm ?? new ClaudeCliClient({});
  const adapters = {
    cribbage: { plugin: cribbagePlugin, chooseAction: cribbageChoose },
  };
  const orchestrator = createOrchestrator({
    db, llm: client, sse, personas: catalog, adapters,
  });

  for (const sess of listStalledOrInFlight(db)) {
    orchestrator.scheduleTurn(sess.gameId);
  }

  return { orchestrator, personas: catalog };
}
