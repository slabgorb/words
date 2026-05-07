import { playerIndex } from './state.js';

const HANDLERS = {}; // populated by phase modules in later tasks

export function registerPhaseHandler(phase, type, fn) {
  HANDLERS[`${phase}:${type}`] = fn;
}

// Stub registration so the dispatcher can distinguish "unknown action" from
// "wrong phase for this action" before later tasks register real handlers.
// Later tasks (pegging phase) will overwrite this with the real handler.
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
