import { ui, fetchState, loadTentative, saveTentative, clearTentative } from './state.js';
import { renderBoard } from './board.js';
import { renderRack, shuffleRack } from './rack.js';

const $ = (sel) => document.querySelector(sel);

async function whoami() {
  const r = await fetch('/api/whoami');
  return (await r.json()).playerId;
}

async function chooseIdentity(id) {
  await fetch('/api/whoami', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: id })
  });
}

let selectedRackIdx = null;

function refresh() {
  renderBoard($('#board'), { onCellClick: handleBoardClick });
  renderRack($('#rack'), { onSlotClick: handleRackClick });
  $('#score-keith').textContent = `Keith: ${ui.server.scores.keith}`;
  $('#score-sonia').textContent = `Sonia: ${ui.server.scores.sonia}`;
  $('#bag-count').textContent = `bag: ${ui.server.bag.length}`;
  const myTurn = ui.server.currentTurn === ui.server.you;
  $('#turn-indicator').textContent = myTurn ? 'Your turn' : `${ui.server.currentTurn}'s turn`;
}

function handleRackClick(idx, _letter) {
  selectedRackIdx = idx;
  $('#status').textContent = `Selected rack tile ${idx} — click a board cell to place.`;
}

function handleBoardClick(r, c) {
  if (selectedRackIdx === null) return;
  if (ui.server.board[r][c] !== null) return;
  if (ui.tentative.some(t => t.r === r && t.c === c)) return;
  const letter = ui.rackOrder[selectedRackIdx];
  ui.tentative.push({ r, c, letter, fromRackIdx: selectedRackIdx, blank: letter === '_' });
  selectedRackIdx = null;
  saveTentative();
  refresh();
}

function recall() {
  clearTentative();
  refresh();
}

async function init() {
  const id = await whoami();
  if (!id) {
    $('#identity-picker').hidden = false;
    $('#identity-picker').addEventListener('click', async (e) => {
      const t = e.target;
      if (!(t instanceof HTMLButtonElement)) return;
      await chooseIdentity(t.dataset.id);
      location.reload();
    });
    return;
  }
  $('#game').hidden = false;
  loadTentative();
  await fetchState();
  refresh();

  $('#btn-recall').addEventListener('click', recall);
  $('#btn-shuffle').addEventListener('click', () => { shuffleRack(); refresh(); });
}

init();
