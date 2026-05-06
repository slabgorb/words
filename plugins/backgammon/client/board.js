import { layoutFor } from './layout.js';
import { createPointEl, createCheckerEl } from './point.js';
import { renderCube } from './cube.js';

// Render the 4 quadrants + bar + off-tray into root.
//   board: { points, barA, barB, bornOffA, bornOffB }
//   ui:    { selected, legalTargets:Set, showLegalDots, youAre }
//   cube:  { value, owner, pendingOffer }
export function renderBoard(root, board, ui, cube) {
  const { youAre = 'a', selected = null, legalTargets = new Set(), showLegalDots = true } = ui;
  const layout = layoutFor(youAre);

  root.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'board-wrap';
  const boardEl = document.createElement('div');
  boardEl.className = 'board';
  wrap.appendChild(boardEl);

  // Quadrants
  boardEl.appendChild(renderQuadrant({
    position: 'top',    side: 'left',  indices: layout.topLeft,
    board, ui, youAre, selected, legalTargets, showLegalDots,
  }));
  boardEl.appendChild(renderQuadrant({
    position: 'top',    side: 'right', indices: layout.topRight,
    board, ui, youAre, selected, legalTargets, showLegalDots,
  }));
  boardEl.appendChild(renderQuadrant({
    position: 'bottom', side: 'left',  indices: layout.botLeft,
    board, ui, youAre, selected, legalTargets, showLegalDots,
  }));
  boardEl.appendChild(renderQuadrant({
    position: 'bottom', side: 'right', indices: layout.botRight,
    board, ui, youAre, selected, legalTargets, showLegalDots,
  }));

  // Bar
  boardEl.appendChild(renderBar(board, ui));

  // Off-tray
  boardEl.appendChild(renderOffTray(board, youAre));

  // Cube (absolute-positioned inside .board)
  if (cube) boardEl.appendChild(renderCube(cube, youAre));

  // Dice mount point — renderDice() will populate this
  const diceMount = document.createElement('div');
  diceMount.id = 'dice-area';
  diceMount.className = 'dice-area';
  boardEl.appendChild(diceMount);

  root.appendChild(wrap);
}

function renderQuadrant({ position, side, indices, board, youAre, selected, legalTargets, showLegalDots }) {
  const q = document.createElement('div');
  q.className = `quad ${position[0]}${side[0]}`;
  indices.forEach((idx, col) => {
    const parity = (col % 2 === 0) === (position === 'top') ? 'light' : 'dark';
    const cell = board.points[idx];
    const isSelected = selected === idx;
    const isLegal = legalTargets.has(idx);
    q.appendChild(createPointEl({
      idx, position, parity, cell, youAre,
      selected: isSelected, isLegalTarget: isLegal, showLegalDots,
    }));
  });
  return q;
}

function renderBar(board, ui) {
  const { youAre = 'a', selected = null } = ui;
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.dataset.role = 'bar';

  // Top half = opponent's bar checkers (their side, visually opposite the viewer).
  // Bottom half = viewer's bar checkers.
  const oppSide = youAre === 'a' ? 'b' : 'a';
  const myBarCount  = youAre === 'a' ? board.barA : board.barB;
  const oppBarCount = youAre === 'a' ? board.barB : board.barA;

  const top = document.createElement('div');
  top.className = 'bar-half bar-top';
  for (let i = 0; i < oppBarCount; i++) {
    top.appendChild(createCheckerEl({ color: oppSide }));
  }
  bar.appendChild(top);

  const bottom = document.createElement('div');
  bottom.className = 'bar-half bar-bottom';
  bottom.dataset.role = 'bar-mine';
  for (let i = 0; i < myBarCount; i++) {
    const isTopOfStack = i === myBarCount - 1;
    bottom.appendChild(createCheckerEl({
      color: youAre,
      selected: selected === 'bar' && isTopOfStack,
    }));
  }
  bar.appendChild(bottom);

  return bar;
}

function renderOffTray(board, youAre) {
  const tray = document.createElement('div');
  tray.className = 'off-tray';

  const myCount  = youAre === 'a' ? board.bornOffA : board.bornOffB;
  const oppCount = youAre === 'a' ? board.bornOffB : board.bornOffA;
  const oppSide  = youAre === 'a' ? 'b' : 'a';

  const top = document.createElement('div');
  top.className = 'off-tray-half top';
  top.innerHTML = `<div class="off-tray-label">Opponent borne off</div>`;
  const oppStack = document.createElement('div');
  oppStack.className = 'off-stack';
  for (let i = 0; i < oppCount; i++) {
    const bar = document.createElement('div');
    bar.className = `off-bar ${oppSide}`;
    oppStack.appendChild(bar);
  }
  top.appendChild(oppStack);
  if (oppCount > 0) {
    const c = document.createElement('div');
    c.className = 'off-count';
    c.textContent = String(oppCount);
    top.appendChild(c);
  }
  tray.appendChild(top);

  const divider = document.createElement('div');
  divider.className = 'off-tray-divider';
  tray.appendChild(divider);

  const bottom = document.createElement('div');
  bottom.className = 'off-tray-half bottom';
  bottom.dataset.role = 'off-mine';
  bottom.innerHTML = `<div class="off-tray-label">You borne off</div>`;
  const myStack = document.createElement('div');
  myStack.className = 'off-stack';
  for (let i = 0; i < myCount; i++) {
    const bar = document.createElement('div');
    bar.className = `off-bar ${youAre}`;
    myStack.appendChild(bar);
  }
  bottom.appendChild(myStack);
  if (myCount > 0) {
    const c = document.createElement('div');
    c.className = 'off-count';
    c.textContent = String(myCount);
    bottom.appendChild(c);
  }
  tray.appendChild(bottom);

  return tray;
}
