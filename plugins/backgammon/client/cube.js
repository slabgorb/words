// Render the doubling cube. Returns a fresh element each call (renderBoard
// recreates its subtree on every render).
//   cube:  state.cube { value, owner: 'a'|'b'|null, pendingOffer: null | { from } }
//   youAre: 'a' | 'b' — viewer side
export function renderCube(cube, youAre) {
  const el = document.createElement('div');
  el.className = 'cube';
  el.title = `Doubling cube — ${cube.value}`;
  if (cube.owner === youAre) el.classList.add('owned-a');
  else if (cube.owner != null) el.classList.add('owned-b');

  const v = document.createElement('span');
  v.className = 'cube-value';
  v.textContent = String(cube.value);
  el.appendChild(v);

  if (cube.pendingOffer) {
    const tag = document.createElement('div');
    tag.className = 'cube-pending';
    tag.textContent = 'DOUBLE?';
    el.appendChild(tag);
  }
  return el;
}
