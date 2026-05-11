import { canOffer } from '../cube.js';

function sideOf(botPlayerIdx) {
  return botPlayerIdx === 0 ? 'a' : 'b';
}

function preRollMoves(state, botSide) {
  const out = [{ id: 'roll', action: { type: 'roll' }, summary: 'Roll the dice' }];
  if (canOffer({ cube: state.cube, match: state.match }, botSide)) {
    const next = state.cube.value * 2;
    out.push({
      id: `offer-double:${next}`,
      action: { type: 'offer-double' },
      summary: `Offer to double the cube from ${state.cube.value} to ${next}`,
    });
  }
  return out;
}

function awaitingDoubleResponseMoves(state) {
  const cur = state.cube.value;
  const next = cur * 2;
  return [
    {
      id: 'accept-double',
      action: { type: 'accept-double' },
      summary: `Accept; cube to ${next}, you own it`,
    },
    {
      id: 'decline-double',
      action: { type: 'decline-double' },
      summary: `Decline; concede leg at cube=${cur}`,
    },
  ];
}

export function enumerateLegalMoves(state, botPlayerIdx) {
  const botSide = sideOf(botPlayerIdx);
  switch (state.turn.phase) {
    case 'initial-roll':
      return [{ id: 'roll-initial', action: { type: 'roll-initial' }, summary: 'Roll opening die' }];
    case 'pre-roll':
      return preRollMoves(state, botSide);
    case 'awaiting-double-response':
      return awaitingDoubleResponseMoves(state);
    case 'moving':
      return []; // implemented in Task 9
    default:
      return [];
  }
}
