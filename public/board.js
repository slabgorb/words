import { ui } from './state.js';
import { applyTileTexture } from './themes.js';

// WwF premium-square layout — duplicated client-side for rendering only.
const TW = new Set(['0,3','0,11','3,0','3,14','11,0','11,14','14,3','14,11']);
const DW = new Set(['1,5','1,9','5,1','5,13','9,1','9,13','13,5','13,9','7,7']);
const TL = new Set(['0,6','0,8','3,3','3,11','6,0','6,14','8,0','8,14','11,3','11,11','14,6','14,8']);
const DL = new Set(['1,2','1,12','2,1','2,4','2,10','2,13','4,2','4,6','4,8','4,12','6,4','6,10','8,4','8,10','10,2','10,6','10,8','10,12','12,1','12,4','12,10','12,13','13,2','13,12']);

// "Library" premium glyphs: lozenge for word multipliers, star for letter multipliers.
const PREMIUMS = {
  tw: { sym: '◈', kind: 'WORD'   },
  dw: { sym: '◇', kind: 'WORD'   },
  tl: { sym: '✦', kind: 'LETTER' },
  dl: { sym: '✧', kind: 'LETTER' },
};

// Letter point values (used for the small corner number on each placed tile).
export const POINTS = {
  A:1,B:4,C:4,D:2,E:1,F:4,G:3,H:3,I:1,J:10,K:5,L:2,M:4,
  N:2,O:1,P:4,Q:10,R:1,S:1,T:1,U:2,V:5,W:4,X:8,Y:3,Z:10,'_':0
};

function makeTile(letter, blank, key) {
  const t = document.createElement('div');
  t.className = 'tile';
  const isPlaceholder = letter === '_';
  const isBlank = blank || isPlaceholder;
  if (isBlank) t.classList.add('blank');
  const lt = document.createElement('span');
  lt.className = 'tile-letter';
  lt.textContent = isPlaceholder ? '' : letter;
  t.appendChild(lt);
  if (!isBlank) {
    const pt = document.createElement('span');
    pt.className = 'tile-points';
    pt.textContent = POINTS[letter] ?? '';
    t.appendChild(pt);
  }
  applyTileTexture(t, key);
  return t;
}

export function renderBoard(root, { onCellClick, onCellDrop, onTentativeDragStart, validation } = {}) {
  root.innerHTML = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r; cell.dataset.c = c;
      const k = `${r},${c}`;

      let kind = null;
      if (TW.has(k)) kind = 'tw';
      else if (DW.has(k)) kind = (k === '7,7') ? 'star' : 'dw';
      else if (TL.has(k)) kind = 'tl';
      else if (DL.has(k)) kind = 'dl';

      if (kind) cell.classList.add(kind);

      const placed = ui.server.board[r][c];
      const tentative = ui.tentative.find(t => t.r === r && t.c === c);

      if (placed) {
        cell.appendChild(makeTile(placed.letter, placed.blank, `b:${r},${c},${placed.letter}`));
      } else if (tentative) {
        cell.classList.add('placed');
        const tile = makeTile(tentative.letter, tentative.blank, `t:${tentative.fromRackIdx},${tentative.letter}`);
        tile.draggable = true;
        tile.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `cell:${r}:${c}`);
          tile.classList.add('dragging');
          if (onTentativeDragStart) onTentativeDragStart({ r, c });
        });
        tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
        cell.appendChild(tile);
        if (validation) {
          if (validation.invalidPositions?.has(k)) cell.classList.add('invalid');
          else if (validation.validPositions?.has(k)) cell.classList.add('valid');
        }
      } else if (kind === 'star') {
        // Center star — open lozenge ring
        const s = document.createElement('div');
        s.className = 'premium-star';
        s.innerHTML = '<svg viewBox="0 0 24 24" width="62%" height="62%"><path d="M12 3l1.8 5.7H19.6l-4.7 3.5 1.8 5.7L12 14.4l-4.7 3.5 1.8-5.7L4.4 8.7h5.8z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
        cell.appendChild(s);
      } else if (PREMIUMS[kind]) {
        // Premium decoration: double-rule + glyph + label
        const rule = document.createElement('div');
        rule.className = 'premium-rule';
        cell.appendChild(rule);
        const wrap = document.createElement('div');
        wrap.className = 'premium';
        const sym = document.createElement('div');
        sym.className = 'premium-sym';
        sym.textContent = PREMIUMS[kind].sym;
        wrap.appendChild(sym);
        const lbl = document.createElement('div');
        lbl.className = 'premium-kind';
        lbl.textContent = PREMIUMS[kind].kind;
        wrap.appendChild(lbl);
        cell.appendChild(wrap);
      }

      if (onCellClick) cell.addEventListener('click', () => onCellClick(r, c));

      // Empty, server-vacant cells are drop targets (placed cells are not).
      const isEmpty = !placed && !tentative;
      if (isEmpty && onCellDrop) {
        cell.addEventListener('dragover', (e) => {
          const types = e.dataTransfer.types;
          if (!types || !types.includes('text/plain')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          cell.classList.add('drop-target');
        });
        cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
        cell.addEventListener('drop', (e) => {
          e.preventDefault();
          cell.classList.remove('drop-target');
          const payload = e.dataTransfer.getData('text/plain');
          if (!payload) return;
          onCellDrop(r, c, payload);
        });
      }

      root.appendChild(cell);
    }
  }
}
