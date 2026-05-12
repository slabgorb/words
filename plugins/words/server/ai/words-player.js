import { buildShortlist } from './shortlist.js';
import { buildTurnPrompt, parseLlmResponse } from './prompts.js';
import { InvalidLlmResponse, InvalidLlmMove } from '../../../../src/server/ai/errors.js';

export { InvalidLlmResponse, InvalidLlmMove };

export async function chooseAction({ llm, persona, sessionId, state, botPlayerIdx }) {
  const botSide = botPlayerIdx === 0 ? 'a' : 'b';
  const shortlist = buildShortlist(state, botSide);
  if (shortlist.length === 0) {
    // Defensive: shortlist always returns at least pass when no plays exist.
    throw new Error(`no legal moves for words bot`);
  }

  const prompt = buildTurnPrompt({ state, shortlist, botSide });
  const r = await llm.send({
    prompt,
    sessionId,
    systemPrompt: sessionId ? null : persona.systemPrompt,
  });

  let parsed;
  try { parsed = parseLlmResponse(r.text); }
  catch (e) { throw new InvalidLlmResponse(e.message); }

  const match = shortlist.find(m => m.id === parsed.moveId);
  if (!match) throw new InvalidLlmMove(parsed.moveId, shortlist.map(m => m.id));

  return {
    action: match.action,
    banter: parsed.banter,
    sessionId: r.sessionId,
  };
}
