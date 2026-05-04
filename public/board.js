import { ui } from './state.js';

// WwF premium-square layout — duplicated client-side for rendering only.
const TW = new Set(['0,3','0,11','3,0','3,14','11,0','11,14','14,3','14,11']);
const DW = new Set(['1,5','1,9','5,1','5,13','9,1','9,13','13,5','13,9','7,7']);
const TL = new Set(['0,6','0,8','3,3','3,11','6,0','6,14','8,0','8,14','11,3','11,11','14,6','14,8']);
const DL = new Set(['1,2','1,12','2,1','2,4','2,10','2,13','4,2','4,6','4,8','4,12','6,4','6,10','8,4','8,10','10,2','10,6','10,8','10,12','12,1','12,4','12,10','12,13','13,2','13,12']);

export function renderBoard(root, { onCellClick, validation } = {}) {
  root.innerHTML = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r; cell.dataset.c = c;
      const k = `${r},${c}`;
      if (TW.has(k)) cell.classList.add('tw');
      else if (DW.has(k)) { cell.classList.add('dw'); if (k === '7,7') cell.classList.add('star'); }
      else if (TL.has(k)) cell.classList.add('tl');
      else if (DL.has(k)) cell.classList.add('dl');

      const placed = ui.server.board[r][c];
      const tentative = ui.tentative.find(t => t.r === r && t.c === c);
      if (placed) {
        const t = document.createElement('div');
        t.className = 'tile';
        t.textContent = placed.letter;
        cell.appendChild(t);
      } else if (tentative) {
        const t = document.createElement('div');
        t.className = 'tile';
        t.textContent = tentative.letter;
        cell.classList.add('placed');
        if (validation) {
          if (validation.invalidPositions?.has(k)) cell.classList.add('invalid');
          else if (validation.validPositions?.has(k)) cell.classList.add('valid');
        }
        cell.appendChild(t);
      }
      if (onCellClick) cell.addEventListener('click', () => onCellClick(r, c));
      root.appendChild(cell);
    }
  }
}
