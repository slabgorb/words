import { sideOf } from './state.js';
import { applyDraw } from './phases/draw.js';
import { applyMeldCreate, applyMeldExtend, applyMeldReplaceWild } from './phases/meld.js';
import { applyDiscard } from './phases/discard.js';
import { applyDealEnd } from './phases/deal-end.js';

export function applyBuracoAction({ state, action, actorId, rng }) {
  const side = sideOf(state, actorId);
  if (!side) return { error: 'not a participant' };
  if (side !== state.currentTurn) return { error: 'not your turn' };

  let result;
  switch (action?.type) {
    case 'draw':
      result = applyDraw(state, action.payload, side);
      break;
    case 'meld':
      switch (action?.payload?.op) {
        case 'create':
          result = applyMeldCreate(state, action.payload, side);
          break;
        case 'extend':
          result = applyMeldExtend(state, action.payload, side);
          break;
        case 'replaceWild':
          result = applyMeldReplaceWild(state, action.payload, side);
          break;
        default:
          return { error: `unknown meld op: ${action?.payload?.op}` };
      }
      break;
    case 'discard':
      result = applyDiscard(state, action.payload, side);
      break;
    default:
      return { error: `unknown action: ${action?.type}` };
  }

  if (result.error) return result;
  let next = result.state;

  if (next.phase === 'deal-end') {
    const dealEnd = applyDealEnd(next, rng);
    next = dealEnd.state;
  }

  return { state: next, ended: next.phase === 'game-end' };
}
