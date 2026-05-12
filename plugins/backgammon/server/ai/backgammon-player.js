import { enumerateLegalMoves } from './legal-moves.js';
import { buildTurnPrompt, parseLlmResponse } from './prompts.js';
import { evaluateBoard } from './board-eval.js';
import { InvalidLlmResponse, InvalidLlmMove } from '../../../../src/server/ai/errors.js';

export { InvalidLlmResponse, InvalidLlmMove };

const MAX_SHORTLIST = 4;

export async function chooseAction({ llm, persona, sessionId, state, botPlayerIdx, rng }) {
  const legalMoves = enumerateLegalMoves(state, botPlayerIdx);
  if (legalMoves.length === 0) {
    throw new Error(`no legal moves for phase '${state.turn?.phase}'`);
  }

  // Moving phase: pre-score by board evaluation and keep only the top N.
  // Other phases (initial-roll, pre-roll, awaiting-double-response) have
  // very few options and are scored directly by the LLM.
  let shortlist = legalMoves;
  if (state.turn?.phase === 'moving' && legalMoves.length > 1) {
    const botSide = botPlayerIdx === 0 ? 'a' : 'b';
    const baseScore = evaluateBoard(state.board, botSide).total;
    shortlist = legalMoves
      .map(m => {
        if (!m.endBoard) return { ...m, evalDelta: 0 };
        const after = evaluateBoard(m.endBoard, botSide);
        return { ...m, evalDelta: after.total - baseScore, evalBreakdown: after };
      })
      .sort((a, b) => (b.evalDelta ?? 0) - (a.evalDelta ?? 0))
      .slice(0, MAX_SHORTLIST);
  }

  const prompt = buildTurnPrompt({ state, legalMoves: shortlist, botPlayerIdx });

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
