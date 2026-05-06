export function backgammonPublicView({ state, viewerId }) {
  let youAre = null;
  if (state.sides?.a === viewerId) youAre = 'a';
  else if (state.sides?.b === viewerId) youAre = 'b';
  return { ...state, youAre };
}
