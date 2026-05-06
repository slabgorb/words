import { CUBE_CAP } from './constants.js';

export function canOffer({ cube, match }, offerer) {
  if (cube.pendingOffer) return false;
  if (cube.value >= CUBE_CAP) return false;
  if (match.crawford) return false;
  if (cube.owner !== null && cube.owner !== offerer) return false;
  return true;
}

export function applyOffer(cube, offerer) {
  return { ...cube, pendingOffer: { from: offerer } };
}

export function applyAccept(cube, acceptor) {
  return {
    value: cube.value * 2,
    owner: acceptor,
    pendingOffer: null,
  };
}

export function applyDecline(cube) {
  return {
    awardedToOfferer: cube.value,
    offerer: cube.pendingOffer.from,
  };
}
