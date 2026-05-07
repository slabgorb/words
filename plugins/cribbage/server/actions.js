import { playerIndex } from './state.js';
import { applyDiscard } from './phases/discard.js';
import { applyCut } from './phases/cut.js';

const HANDLERS = {
  'discard:discard': applyDiscard,
  'cut:cut': applyCut,
};

export function registerPhaseHandler(phase, type, fn) {
  HANDLERS[`${phase}:${type}`] = fn;
}

registerPhaseHandler('pegging', 'play', () => ({ error: 'play handler not implemented' }));

export function applyCribbageAction({ state, action, actorId, rng }) {
  const player = playerIndex(state, actorId);
  if (player < 0) return { error: 'not a participant' };
  const handler = HANDLERS[`${state.phase}:${action.type}`];
  if (!handler) {
    if (Object.keys(HANDLERS).some(k => k.endsWith(`:${action.type}`))) {
      return { error: `action '${action.type}' not allowed in phase '${state.phase}'` };
    }
    return { error: `unknown action: ${action.type}` };
  }
  return handler({ state, action, player, rng });
}
