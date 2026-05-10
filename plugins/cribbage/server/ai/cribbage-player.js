import { enumerateLegalMoves } from './legal-moves.js';
import { buildTurnPrompt, parseLlmResponse } from './prompts.js';

export class InvalidLlmResponse extends Error {
  constructor(detail) { super(`LLM response invalid: ${detail}`); this.name = 'InvalidLlmResponse'; }
}
export class InvalidLlmMove extends Error {
  constructor(moveId, legalIds) {
    super(`LLM picked moveId '${moveId}' not in legal set [${legalIds.join(', ')}]`);
    this.name = 'InvalidLlmMove';
  }
}

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
