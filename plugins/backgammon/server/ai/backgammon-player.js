import { enumerateLegalMoves } from './legal-moves.js';
import { buildTurnPrompt, parseLlmResponse } from './prompts.js';
import { InvalidLlmResponse, InvalidLlmMove } from '../../../../src/server/ai/errors.js';

export { InvalidLlmResponse, InvalidLlmMove };

export async function chooseAction({ llm, persona, sessionId, state, botPlayerIdx, rng }) {
  const legalMoves = enumerateLegalMoves(state, botPlayerIdx);
  if (legalMoves.length === 0) {
    throw new Error(`no legal moves for phase '${state.turn?.phase}'`);
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

  // The legal-moves enumerator emits 'roll' as a bare intent — the engine
  // requires actual dice values (and a throwParams array for the 3D physics
  // replay on clients; bots have none). Materialize here using the rng.
  let action = match.action;
  if (action.type === 'roll' && !action.payload) {
    const d = () => Math.floor(rng() * 6) + 1;
    action = { type: 'roll', payload: { values: [d(), d()], throwParams: [] } };
  }

  return {
    action,
    banter: parsed.banter,
    sessionId: r.sessionId,
    sequenceTail: Array.isArray(match.sequenceTail) ? match.sequenceTail : [],
  };
}
