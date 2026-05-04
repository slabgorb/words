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
  maybeOfferNewGame();
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

function nonce() {
  return crypto.randomUUID();
}

async function submitMove() {
  if (!lastValidation?.valid) return;
  const r = await fetch('/api/move', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      placement: ui.tentative.map(t => ({ r: t.r, c: t.c, letter: t.letter, blank: !!t.blank })),
      clientNonce: nonce()
    })
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    $('#status').textContent = `Server rejected: ${body.error || r.status}`;
    return;
  }
  clearTentative();
  lastValidation = null;
  await fetchState();
  // refresh rack-order to reflect new rack from server
  ui.rackOrder = ui.server.racks[ui.server.you].slice();
  refresh();
}

async function passTurn() {
  if (!confirm('Pass your turn?')) return;
  const r = await fetch('/api/pass', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientNonce: nonce() })
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    $('#status').textContent = `Pass failed: ${b.error || r.status}`;
    return;
  }
  await fetchState(); refresh();
}

async function swapTiles() {
  const which = prompt('Type the rack letters to swap (e.g. ABC):');
  if (!which) return;
  const tiles = which.toUpperCase().split('').filter(Boolean);
  const r = await fetch('/api/swap', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tiles, clientNonce: nonce() })
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    $('#status').textContent = `Swap failed: ${b.error || r.status}`;
    return;
  }
  await fetchState();
  ui.rackOrder = ui.server.racks[ui.server.you].slice();
  refresh();
}

async function resign() {
  if (!confirm('Resign and lose this game?')) return;
  const r = await fetch('/api/resign', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientNonce: nonce() })
  });
  if (r.ok) { await fetchState(); refresh(); }
}

async function maybeOfferNewGame() {
  if (ui.server.status !== 'ended') return;
  const winner = ui.server.winner ?? 'tie';
  $('#status').textContent = `Game ended (${ui.server.endedReason}) — winner: ${winner}. Click "Pass" to confirm a new game (both players must click).`;
  // Repurpose the pass button while game is ended → New Game confirm
  const btn = $('#btn-pass');
  btn.textContent = 'Confirm new game';
  btn.onclick = async () => {
    const r = await fetch('/api/new-game', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    if (r.ok) {
      const body = await r.json();
      if (body.started) location.reload();
      else $('#status').textContent = `Waiting for ${body.waitingFor} to confirm...`;
    }
  };
}

function startSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('move', async () => { await fetchState(); ui.rackOrder = ui.server.racks[ui.server.you].slice(); refresh(); });
  es.addEventListener('pass', async () => { await fetchState(); refresh(); });
  es.addEventListener('swap', async () => { await fetchState(); ui.rackOrder = ui.server.racks[ui.server.you].slice(); refresh(); });
  es.addEventListener('resign', async () => { await fetchState(); refresh(); });
  es.addEventListener('new-game', () => location.reload());
  es.onerror = () => { /* browser auto-reconnects */ };
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
  $('#btn-submit').addEventListener('click', submitMove);
  $('#btn-pass').addEventListener('click', passTurn);
  $('#btn-swap').addEventListener('click', swapTiles);
  $('#btn-resign').addEventListener('click', resign);
  await maybeOfferNewGame();
  startSSE();
}

init();
