import { postAction } from './actions.js';

const CUBE_CAP = 64;

function showBtn(id, on) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !on);
}

// Same as engine's cube.canOffer({ cube, match }, side) — kept inline so the
// client can decide button visibility without an engine import. Mirror of
// plugins/backgammon/server/cube.js#canOffer.
function canOffer(state, side) {
  const cube = state.cube;
  const match = state.match;
  if (cube.value >= CUBE_CAP) return false;
  if (cube.pendingOffer) return false;
  if (match.crawford) return false;
  if (match.target === 1) return false;
  if (cube.owner != null && cube.owner !== side) return false;
  return true;
}

export function renderActionBar(state) {
  const bar = document.getElementById('action-bar');
  if (!bar) return;
  if (!state || !state.turn) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  const me = state.youAre;
  const phase = state.turn.phase;
  const active = state.turn.activePlayer;
  const offerFrom = state.cube?.pendingOffer?.from;

  // Default: hide all secondary buttons; resign is the only always-visible.
  showBtn('btn-roll', false);
  showBtn('btn-double', false);
  showBtn('btn-accept', false);
  showBtn('btn-decline', false);
  showBtn('btn-resign', phase !== 'awaiting-double-response');

  if (phase === 'pre-roll' && active === me) {
    // Roll button is fallback only — dice tray normally drives the roll.
    // Show only if dice-tray bundle hasn't loaded.
    if (!customElements.get('dice-tray')) showBtn('btn-roll', true);
    showBtn('btn-double', canOffer(state, me));
  }
  if (phase === 'awaiting-double-response' && offerFrom !== me) {
    showBtn('btn-accept', true);
    showBtn('btn-decline', true);
  }
}

// One-time wiring for static button click handlers. Called once from app.js.
export function wireActionBar() {
  document.getElementById('btn-roll')?.addEventListener('click', () => {
    // Fallback only. Random values; throwParams empty.
    const v1 = 1 + Math.floor(Math.random() * 6);
    const v2 = 1 + Math.floor(Math.random() * 6);
    postAction('roll', { values: [v1, v2], throwParams: [] });
  });
  document.getElementById('btn-double')?.addEventListener('click', () => {
    postAction('offer-double', {});
  });
  document.getElementById('btn-accept')?.addEventListener('click', () => {
    postAction('accept-double', {});
  });
  document.getElementById('btn-decline')?.addEventListener('click', () => {
    postAction('decline-double', {});
  });
  document.getElementById('btn-resign')?.addEventListener('click', () => {
    if (!confirm('Resign this leg?')) return;
    postAction('resign', {});
  });
}
