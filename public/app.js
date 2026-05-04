import { ui, fetchState, loadTentative, saveTentative, clearTentative } from './state.js';
import { renderBoard } from './board.js';
import { renderRack, shuffleRack } from './rack.js';
import { scheduleValidate } from './validator.js';

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
let lastValidation = null;

function refresh() {
  const validation = lastValidation ? buildValidationPositions(lastValidation) : null;
  renderBoard($('#board'), { onCellClick: handleBoardClick, validation });
  renderRack($('#rack'), { onSlotClick: handleRackClick });
  $('#score-keith').textContent = `Keith: ${ui.server.scores.keith}`;
  $('#score-sonia').textContent = `Sonia: ${ui.server.scores.sonia}`;
  $('#bag-count').textContent = `bag: ${ui.server.bag.length}`;
  const myTurn = ui.server.currentTurn === ui.server.you;
  $('#turn-indicator').textContent = myTurn ? 'Your turn' : `${ui.server.currentTurn}'s turn`;
  $('#btn-submit').disabled = !myTurn || !lastValidation?.valid;
  if (lastValidation) {
    if (lastValidation.valid) {
      $('#status').textContent = `Words: ${lastValidation.words.map(w => w.word).join(', ')} — +${lastValidation.score}`;
    } else if (lastValidation.reason) {
      $('#status').textContent = `Invalid: ${lastValidation.reason}`;
    } else {
      const bad = lastValidation.words.filter(w => !w.ok).map(w => w.word).join(', ');
      $('#status').textContent = `Not in dictionary: ${bad}`;
    }
  } else {
    $('#status').textContent = ui.tentative.length ? '...' : '';
  }
}

function buildValidationPositions(v) {
  // Mark tentative cells as valid/invalid based on whether all words involving them are ok.
  const validPositions = new Set();
  const invalidPositions = new Set();
  for (const t of ui.tentative) {
    const k = `${t.r},${t.c}`;
    if (v.valid) validPositions.add(k);
    else invalidPositions.add(k);
  }
  return { validPositions, invalidPositions };
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
  scheduleValidate((result) => { lastValidation = result; refresh(); });
}

function recall() {
  clearTentative();
  lastValidation = null;
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
