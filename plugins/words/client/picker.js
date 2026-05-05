import { POINTS } from './board.js';
import { applyTileTexture } from './themes.js';

let modalCount = 0;

// Shared modal scaffolding: builds backdrop+panel, sets ARIA roles, traps Tab,
// restores focus on close, and wires Escape/backdrop cancellation. The caller
// supplies `build({ panel, titleId, close })` and may add its own keydown
// behavior via the returned `panel` (call close(value) to dismiss).
function mountModal({ titleText, build, ariaLabel }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const titleId = `modal-title-${++modalCount}`;

    const backdrop = document.createElement('div');
    backdrop.className = 'picker-backdrop';

    const panel = document.createElement('div');
    panel.className = 'picker-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    if (titleText) {
      panel.setAttribute('aria-labelledby', titleId);
    } else if (ariaLabel) {
      panel.setAttribute('aria-label', ariaLabel);
    }
    panel.tabIndex = -1;

    if (titleText) {
      const title = document.createElement('div');
      title.className = 'picker-title';
      title.id = titleId;
      title.textContent = titleText;
      panel.appendChild(title);
    }

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    function close(value) {
      document.removeEventListener('keydown', onKeyTrap);
      backdrop.remove();
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
      resolve(value);
    }

    function focusables() {
      return Array.from(panel.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
    }

    function onKeyTrap(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
        return;
      }
      if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) { e.preventDefault(); panel.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyTrap);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });

    build({ panel, close });

    // Move focus inside the modal — first focusable, or the panel itself.
    const items = focusables();
    (items[0] ?? panel).focus();
  });
}

// Promise-based modal for choosing what letter a blank tile represents.
// Resolves to the chosen uppercase letter, or null if cancelled.
export function pickBlankLetter() {
  return mountModal({
    titleText: 'Choose a letter for the blank',
    build: ({ panel, close }) => {
      const grid = document.createElement('div');
      grid.className = 'picker-grid';
      for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'picker-btn';
        btn.textContent = letter;
        btn.setAttribute('aria-label', `Letter ${letter}`);
        applyTileTexture(btn, `pk:${letter}`);
        btn.addEventListener('click', () => close(letter));
        grid.appendChild(btn);
      }
      panel.appendChild(grid);

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'picker-cancel';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => close(null));
      panel.appendChild(cancel);

      // Letter shortcut: A–Z keys pick instantly.
      panel.addEventListener('keydown', (e) => {
        if (e.key.length !== 1) return;
        const k = e.key.toUpperCase();
        if (/^[A-Z]$/.test(k)) { e.preventDefault(); close(k); }
      });
    },
  });
}

// Promise-based modal for choosing which rack tiles to swap.
// `rackOrder`: array of letter chars (incl. '_').
// `disabledIdx`: Set<number> of indices that are in-use (tentative on board).
// Resolves to an array of letter chars to swap, or null if cancelled.
export function pickSwapTiles({ rackOrder, disabledIdx }) {
  return mountModal({
    titleText: 'Pick tiles to swap',
    build: ({ panel, close }) => {
      const subtitle = document.createElement('div');
      subtitle.className = 'picker-subtitle';
      subtitle.textContent = 'Click to toggle. Swap costs your turn.';
      panel.appendChild(subtitle);

      panel.classList.add('swap-panel');

      const tray = document.createElement('div');
      tray.className = 'swap-tray';
      const selected = new Set();

      rackOrder.forEach((letter, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swap-tile';
        btn.dataset.idx = idx;

        const blank = letter === '_';
        const lt = document.createElement('span');
        lt.className = 'tile-letter';
        lt.textContent = blank ? '·' : letter;
        btn.appendChild(lt);
        if (!blank) {
          const pt = document.createElement('span');
          pt.className = 'tile-points';
          pt.textContent = POINTS[letter] ?? '';
          btn.appendChild(pt);
        }
        if (blank) btn.classList.add('blank');
        btn.setAttribute('aria-label', blank ? 'Blank tile' : `Letter ${letter}`);
        btn.setAttribute('aria-pressed', 'false');
        applyTileTexture(btn, `sw:${idx}:${letter}`);

        if (disabledIdx && disabledIdx.has(idx)) {
          btn.disabled = true;
          btn.classList.add('in-use');
          btn.title = 'On the board — recall first to swap';
          btn.setAttribute('aria-label', `${btn.getAttribute('aria-label')} (on the board)`);
        } else {
          btn.addEventListener('click', () => {
            if (selected.has(idx)) {
              selected.delete(idx);
              btn.classList.remove('selected');
              btn.setAttribute('aria-pressed', 'false');
            } else {
              selected.add(idx);
              btn.classList.add('selected');
              btn.setAttribute('aria-pressed', 'true');
            }
            updateConfirm();
          });
        }
        tray.appendChild(btn);
      });
      panel.appendChild(tray);

      const actions = document.createElement('div');
      actions.className = 'picker-actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'picker-cancel';
      cancel.textContent = 'Cancel';
      cancel.addEventListener('click', () => close(null));
      actions.appendChild(cancel);

      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'picker-confirm';
      confirm.textContent = 'Swap (0)';
      confirm.disabled = true;
      confirm.addEventListener('click', () => {
        const letters = [...selected].map(i => rackOrder[i]);
        close(letters);
      });
      actions.appendChild(confirm);

      panel.appendChild(actions);

      function updateConfirm() {
        confirm.textContent = `Swap (${selected.size})`;
        confirm.disabled = selected.size === 0;
      }

      // Enter confirms when at least one tile is selected.
      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && selected.size > 0) {
          e.preventDefault();
          const letters = [...selected].map(i => rackOrder[i]);
          close(letters);
        }
      });
    },
  });
}

/**
 * Show the mobile "more actions" sheet.
 * Resolves to 'pass' | 'swap' | 'resign' | null (cancelled).
 */
export function pickMoreActions() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'picker-backdrop';
    const panel = document.createElement('div');
    panel.className = 'picker-panel confirm-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'picker-title';
    title.textContent = 'More actions';
    panel.appendChild(title);

    const actions = [
      { id: 'pass', label: 'Pass turn' },
      { id: 'swap', label: 'Swap tiles…' },
      { id: 'resign', label: 'Resign', danger: true },
    ];
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    list.style.margin = '8px 0 12px';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'picker-confirm' + (a.danger ? ' picker-danger' : '');
      btn.style.width = '100%';
      btn.textContent = a.label;
      btn.addEventListener('click', () => { close(a.id); });
      list.appendChild(btn);
    }
    panel.appendChild(list);

    const cancel = document.createElement('button');
    cancel.className = 'picker-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => close(null));
    panel.appendChild(cancel);

    backdrop.appendChild(panel);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.body.appendChild(backdrop);

    function close(result) {
      backdrop.remove();
      resolve(result);
    }
  });
}

// In-aesthetic confirmation modal. Resolves true if confirmed, false otherwise.
// `danger: true` styles the confirm button as a destructive action.
export function confirmAction({ title, body, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return mountModal({
    titleText: title,
    build: ({ panel, close }) => {
      panel.classList.add('confirm-panel');

      if (body) {
        const p = document.createElement('div');
        p.className = 'confirm-body';
        p.textContent = body;
        panel.appendChild(p);
      }

      const actions = document.createElement('div');
      actions.className = 'picker-actions';

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'picker-cancel';
      cancel.textContent = cancelText;
      cancel.addEventListener('click', () => close(false));
      actions.appendChild(cancel);

      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = danger ? 'picker-confirm picker-danger' : 'picker-confirm';
      ok.textContent = confirmText;
      ok.addEventListener('click', () => close(true));
      actions.appendChild(ok);

      panel.appendChild(actions);

      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); close(true); }
      });
    },
  }).then(v => v === true);
}
