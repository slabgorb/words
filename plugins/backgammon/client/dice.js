// Render the dice area inside the board. Phase-driven:
//   initial-roll, viewer not yet rolled  → <dice-tray dice="1d6" mode="active">
//   pre-roll, viewer active              → <dice-tray dice="2d6" mode="active">
//   moving                               → static pip-grid showing turn.dice.values
//   awaiting-double-response             → hidden (cube has the user's attention)
//   anything else                        → empty
//
// On dice-settle, calls onRoll({ values, throwParams }).

const PIP_LAYOUT = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

function staticDie(value) {
  const slots = PIP_LAYOUT[value] || [];
  const die = document.createElement('div');
  die.className = 'die-placeholder';
  for (let i = 0; i < 9; i++) {
    const slot = i + 1;
    const pip = document.createElement('div');
    pip.className = 'pip';
    pip.style.visibility = slots.includes(slot) ? 'visible' : 'hidden';
    die.appendChild(pip);
  }
  return die;
}

function staticDiceRow(values) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = '14px';
  for (const v of values) wrap.appendChild(staticDie(v));
  return wrap;
}

// Wraps the active <dice-tray> so we can attach listeners and forward roll events.
function activeDiceTray({ count, themeKey, onRoll }) {
  const tray = document.createElement('dice-tray');
  tray.setAttribute('dice', `${count}d6`);
  tray.setAttribute('mode', 'active');
  tray.setAttribute('theme', themeKey);
  // The bundled <dice-tray> renders its 3D scene with minHeight: 240 internally;
  // tray must be at least that tall or the scene gets cropped and the dice
  // don't paint until they're thrown. Width drives the throw surface area.
  tray.style.width = '320px';
  tray.style.height = '260px';
  tray.addEventListener('dice-settle', (e) => {
    const detail = e.detail || {};
    if (!Array.isArray(detail.values) || detail.values.length === 0) return;
    onRoll({ values: detail.values, throwParams: detail.throwParams || [] });
  });
  return tray;
}

export function renderDice(state, ctx, onRoll) {
  const mount = document.getElementById('dice-area');
  if (!mount) return;
  mount.textContent = '';

  const me = state.youAre;
  const phase = state.turn?.phase;
  const active = state.turn?.activePlayer;
  const themeKey = document.body.dataset.theme === 'inlay-noir' ? 'obsidian' : 'ivory';

  // Position dice on the active player's side. During initial-roll the
  // active player is undecided, so anchor to the viewer's own die.
  mount.classList.remove('top', 'bottom');
  const ownerSide = phase === 'initial-roll' ? me : active;
  if (ownerSide === me) mount.classList.add('bottom');
  else if (ownerSide) mount.classList.add('top');

  if (phase === 'initial-roll') {
    const myValue = state.initialRoll?.[me];
    if (myValue == null) {
      mount.appendChild(activeDiceTray({
        count: 1, themeKey,
        onRoll: ({ values, throwParams }) => onRoll('roll-initial', { value: values[0], throwParams }),
      }));
    } else {
      // Already rolled this leg; show static.
      mount.appendChild(staticDiceRow([myValue]));
    }
    return;
  }

  if (phase === 'pre-roll') {
    if (active === me) {
      mount.appendChild(activeDiceTray({
        count: 2, themeKey,
        onRoll: ({ values, throwParams }) => onRoll('roll', { values, throwParams }),
      }));
    }
    return;
  }

  if (phase === 'moving') {
    const values = state.turn?.dice?.values;
    if (Array.isArray(values) && values.length > 0) {
      mount.appendChild(staticDiceRow(values));
    }
    return;
  }

  // awaiting-double-response or other → empty
}
