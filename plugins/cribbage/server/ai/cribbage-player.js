import { enumerateLegalMoves } from './legal-moves.js';
import { buildTurnPrompt, parseLlmResponse, buildBanterPrompt, parseBanterOnly } from './prompts.js';
import { InvalidLlmResponse, InvalidLlmMove } from '../../../../src/server/ai/errors.js';

export { InvalidLlmResponse, InvalidLlmMove };

export async function chooseAction({ llm, persona, sessionId, state, botPlayerIdx }) {
  const legalMoves = enumerateLegalMoves(state, botPlayerIdx);
  if (legalMoves.length === 0) {
    throw new Error(`no legal moves for phase '${state.phase}'`);
  }
  const prompt = buildTurnPrompt({ state, legalMoves, botPlayerIdx });

  const r = await llm.send({
    prompt,
    sessionId,
    systemPrompt: sessionId ? null : persona.systemPrompt,
  });

  let parsed;
  try { parsed = parseLlmResponse(r.text); }
  catch (e) { throw new InvalidLlmResponse(e.message); }

  const match = legalMoves.find(m => m.id === parsed.moveId);
  if (!match) throw new InvalidLlmMove(parsed.moveId, legalMoves.map(m => m.id));

  return {
    action: match.action,
    banter: parsed.banter,
    sessionId: r.sessionId,
  };
}

// Banter-only side-call: invoked by the orchestrator after a mechanical
// auto-action (e.g. 'show' acknowledge) so the bot can still chirp without
// blocking the user on a full chooseAction round trip. Failures are
// caught by the caller and logged — never user-visible.
export async function chooseBanter({ llm, persona, state, botPlayerIdx, hint }) {
  const prompt = buildBanterPrompt({ state, botPlayerIdx, hint });
  const r = await llm.send({
    prompt,
    sessionId: null,
    systemPrompt: persona.systemPrompt,
  });
  return { banter: parseBanterOnly(r.text) };
}
