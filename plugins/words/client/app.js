import { ui, fetchState, loadTentative, saveTentative, clearTentative, initGameId, gameUrl } from './state.js';
import { renderBoard } from './board.js';
import { renderRack, shuffleRack } from './rack.js';
import { scheduleValidate } from './validator.js';
import { pickBlankLetter, pickSwapTiles, confirmAction, pickMoreActions } from './picker.js';
import { play, playForScore, primeAudio, isMuted, toggleMuted } from './sounds.js';
import { cycleTheme, getTheme } from './themes.js';
import { cycleFont, getFont, getFontLabel } from './fonts.js';
import { showMoveCallout, showPassCallout, showSwapCallout } from './callout.js';
import { loadHistory, toggleDrawer, closeDrawer, appendEntry } from './history.js';

const $ = (sel) => document.querySelector(sel);


let selectedRackIdx = null;
let lastValidation = null;

function historyNames() {
  // ui.server.opponent.friendlyName always names the opponent regardless of side.
  // Map by side: when user is 'a', side 'a' is the user, side 'b' is the opponent.
  return ui.server.you === 'a'
    ? { a: ui.server.yourFriendlyName, b: ui.server.opponent.friendlyName }
    : { a: ui.server.opponent.friendlyName, b: ui.server.yourFriendlyName };
}

function refresh() {
  const validation = lastValidation ? buildValidationPositions(lastValidation) : null;
  renderBoard($('#board'), {
    onCellClick: handleBoardClick,
    onCellDrop: handleCellDrop,
    validation,
  });
  renderRack($('#rack'), {
    onSlotClick: handleRackClick,
    onRecallDrop: handleRackRecall,
    onRackReorder: handleRackReorder,
  });
  const scores = ui.server.scores;
  const current = ui.server.currentTurn;
  const ended = ui.server.status === 'ended';

  const aFriendly = ui.server.you === 'a' ? ui.server.yourFriendlyName : ui.server.opponent.friendlyName;
  const bFriendly = ui.server.you === 'b' ? ui.server.yourFriendlyName : ui.server.opponent.friendlyName;
  const aEl = $('#score-a');
  const bEl = $('#score-b');
  setScoreCard(aEl, aFriendly, scores.a);
  setScoreCard(bEl, bFriendly, scores.b);
  aEl.classList.toggle('active', !ended && current === 'a');
  bEl.classList.toggle('active', !ended && current === 'b');

  const pill = $('#turn-pill');
  if (ended) {
    pill.textContent = 'Game over';
    pill.dataset.state = 'ended';
  } else {
    const isMyTurn = current === ui.server.you;
    pill.textContent = isMyTurn ? 'Your turn' : `${ui.server.opponent.friendlyName}'s turn`;
    pill.dataset.state = 'active';
  }
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');

  $('#bag-count').textContent = `bag ${ui.server.bag.length}`;
  const rackLeft = ui.server.racks?.[ui.server.you]?.length ?? 0;
  $('#rack-remaining').textContent = `${rackLeft} in rack`;
  const myTurn = current === ui.server.you;
  $('#btn-submit').disabled = !myTurn || !lastValidation?.valid;
  const statusEl = $('#status');
  statusEl.classList.remove('show', 'valid', 'invalid');
  let statusText = '';
  let statusClass = null;
  if (lastValidation) {
    if (lastValidation.valid) {
      statusText = `Words: ${lastValidation.words.map(w => w.word).join(', ')} — +${lastValidation.score}`;
      statusClass = 'valid';
    } else if (lastValidation.reason) {
      statusText = `Invalid: ${lastValidation.reason}`;
      statusClass = 'invalid';
    } else {
      const bad = lastValidation.words.filter(w => !w.ok).map(w => w.word).join(', ');
      statusText = `Not in dictionary: ${bad}`;
      statusClass = 'invalid';
    }
  } else if (ui.tentative.length) {
    statusText = '…';
  }
  statusEl.textContent = statusText;
  if (statusText) {
    statusEl.classList.add('show');
    if (statusClass) statusEl.classList.add(statusClass);
  }
  maybeOfferNewGame();
}

function setScoreCard(el, name, score) {
  el.textContent = '';
  const n = document.createElement('span');
  n.className = 'player-name';
  n.textContent = name;
  const s = document.createElement('span');
  s.className = 'player-score';
  s.textContent = score;
  el.append(n, s);
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
  $('#status').classList.add('show');
}

async function placeFromRack(r, c, idx) {
  if (ui.tentative.some(t => t.fromRackIdx === idx)) return;
  let letter = ui.rackOrder[idx];
  if (letter == null) return;
  let blank = false;
  if (letter === '_') {
    const chosen = await pickBlankLetter();
    if (chosen == null) return;
    blank = true;
    letter = chosen;
    // Re-check the destination after the async wait — server state or
    // tentative list may have changed while the picker was open.
    if (ui.server.board[r][c] !== null) return;
    if (ui.tentative.some(t => t.r === r && t.c === c)) return;
  }
  ui.tentative.push({ r, c, letter, fromRackIdx: idx, blank });
  selectedRackIdx = null;
  saveTentative();
  lastValidation = null;
  play('click');
  refresh();
  scheduleValidate((result) => { lastValidation = result; refresh(); });
}

async function handleBoardClick(r, c) {
  // Click a tentative tile to recall it back to the rack.
  const tentIdx = ui.tentative.findIndex(t => t.r === r && t.c === c);
  if (tentIdx !== -1) {
    ui.tentative.splice(tentIdx, 1);
    saveTentative();
    lastValidation = null;
    play('swoosh');
    refresh();
    if (ui.tentative.length) {
      scheduleValidate((result) => { lastValidation = result; refresh(); });
    }
    return;
  }
  if (selectedRackIdx === null) return;
  if (ui.server.board[r][c] !== null) return;
  await placeFromRack(r, c, selectedRackIdx);
}

async function handleCellDrop(r, c, payload) {
  if (ui.server.board[r][c] !== null) return;
  if (ui.tentative.some(t => t.r === r && t.c === c)) return;

  if (payload.startsWith('rack:')) {
    const idx = Number(payload.slice(5));
    if (Number.isNaN(idx)) return;
    await placeFromRack(r, c, idx);
    return;
  }
  if (payload.startsWith('cell:')) {
    const [, fromR, fromC] = payload.split(':').map(Number);
    const t = ui.tentative.find(x => x.r === fromR && x.c === fromC);
    if (!t) return;
    t.r = r;
    t.c = c;
    selectedRackIdx = null;
    saveTentative();
    lastValidation = null;
    play('click');
    refresh();
    scheduleValidate((result) => { lastValidation = result; refresh(); });
  }
}

function handleRackReorder(fromIdx, toIdx) {
  const a = ui.rackOrder.slice();
  [a[fromIdx], a[toIdx]] = [a[toIdx], a[fromIdx]];
  ui.rackOrder = a;
  play('click');
  refresh();
}

function handleRackRecall(r, c) {
  const idx = ui.tentative.findIndex(t => t.r === r && t.c === c);
  if (idx === -1) return;
  ui.tentative.splice(idx, 1);
  saveTentative();
  lastValidation = null;
  play('swoosh');
  refresh();
  if (ui.tentative.length) {
    scheduleValidate((result) => { lastValidation = result; refresh(); });
  }
}

function recall() {
  if (ui.tentative.length) play('swoosh');
  clearTentative();
  lastValidation = null;
  refresh();
}

async function submitMove() {
  if (!lastValidation?.valid) return;
  const r = await fetch(window.__GAME__?.actionUrl ?? gameUrl('action'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'move',
      payload: { placement: ui.tentative.map(t => ({ r: t.r, c: t.c, letter: t.letter, blank: !!t.blank })) }
    })
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    $('#status').textContent = `Server rejected: ${body.error || r.status}`;
    $('#status').classList.add('show');
    return;
  }
  const score = lastValidation?.score ?? 0;
  playForScore(score);
  clearTentative();
  lastValidation = null;
  await fetchState();
  // refresh rack-order to reflect new rack from server
  ui.rackOrder = ui.server.racks[ui.server.you].slice();
  refresh();
}

async function passTurn() {
  if (ui.server.status === 'ended') {
    await confirmNewGame();
    return;
  }
  const ok = await confirmAction({
    title: 'Pass your turn?',
    body: 'You will skip without scoring. Two passes in a row by both players ends the game.',
    confirmText: 'Pass turn',
    cancelText: 'Keep playing',
  });
  if (!ok) return;
  const r = await fetch(window.__GAME__?.actionUrl ?? gameUrl('action'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'pass' })
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    $('#status').textContent = `Pass failed: ${b.error || r.status}`;
    $('#status').classList.add('show');
    return;
  }
  await fetchState(); refresh();
}

async function confirmNewGame() {
  // Derive opponentId from the current game state
  const opponentSide = ui.server.you === 'a' ? 'b' : 'a';
  const opponentId = ui.server.sides?.[opponentSide] ?? null;
  const r = await fetch('/api/games', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ opponentId, gameType: 'words' })
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    $('#status').textContent = `New game failed: ${b.error || r.status}`;
    $('#status').classList.add('show');
    return;
  }
  const body = await r.json();
  if (body.id) location.href = `/play/${body.gameType ?? 'words'}/${body.id}/`;
}

async function swapTiles() {
  const disabledIdx = new Set(ui.tentative.map(t => t.fromRackIdx));
  const tiles = await pickSwapTiles({ rackOrder: ui.rackOrder, disabledIdx });
  if (!tiles || tiles.length === 0) return;
  const r = await fetch(window.__GAME__?.actionUrl ?? gameUrl('action'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'swap', payload: { tiles } })
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    $('#status').textContent = `Swap failed: ${b.error || r.status}`;
    $('#status').classList.add('show');
    return;
  }
  await fetchState();
  ui.rackOrder = ui.server.racks[ui.server.you].slice();
  refresh();
}

async function resign() {
  const ok = await confirmAction({
    title: 'Resign this game?',
    body: 'Your opponent wins. This cannot be undone.',
    confirmText: 'Resign',
    cancelText: 'Keep playing',
    danger: true,
  });
  if (!ok) return;
  const r = await fetch(window.__GAME__?.actionUrl ?? gameUrl('action'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'resign' })
  });
  if (r.ok) { await fetchState(); refresh(); }
}

function maybeOfferNewGame() {
  const btn = $('#btn-pass');
  if (ui.server.status !== 'ended') {
    btn.textContent = 'Pass';
    return;
  }
  let winnerName = 'tie';
  if (ui.server.winner === ui.server.you) winnerName = ui.server.yourFriendlyName;
  else if (ui.server.winner) winnerName = ui.server.opponent.friendlyName;
  $('#status').textContent = `Game ended (${ui.server.endedReason}) — winner: ${winnerName}. Click "Confirm new game" (both players must click).`;
  $('#status').classList.add('show');
  btn.textContent = 'Confirm new game';
}

function parsePayload(e) {
  try { return JSON.parse(e.data); } catch { return {}; }
}

// Returns a function that, when called after fetchState, plays the
// "your turn" chime if the turn just flipped to the local player.
function captureTurnTransition() {
  const wasMyTurn = ui.server?.currentTurn === ui.server?.you;
  return () => {
    const isMyTurn = ui.server?.currentTurn === ui.server?.you;
    const active = ui.server?.status !== 'ended';
    if (active && isMyTurn && !wasMyTurn) play('your-turn');
  };
}

function startSSE() {
  const es = new EventSource(gameUrl('events'));
  es.addEventListener('move', async (e) => {
    const p = parsePayload(e);
    const checkTurn = captureTurnTransition();
    await fetchState();
    ui.rackOrder = ui.server.racks[ui.server.you].slice();
    refresh();
    // Only react to the opponent's move — your own callout/cheer fired in submitMove.
    if (p.by && p.by !== ui.server.you) {
      showMoveCallout(p);
      playForScore(p.score ?? 0);
      checkTurn();
    }
  });
  es.addEventListener('pass', async (e) => {
    const p = parsePayload(e);
    const checkTurn = captureTurnTransition();
    await fetchState();
    refresh();
    if (p.by && p.by !== ui.server.you) {
      showPassCallout(p);
      checkTurn();
    }
  });
  es.addEventListener('swap', async (e) => {
    const p = parsePayload(e);
    const checkTurn = captureTurnTransition();
    await fetchState();
    ui.rackOrder = ui.server.racks[ui.server.you].slice();
    refresh();
    if (p.by && p.by !== ui.server.you) {
      showSwapCallout(p);
      checkTurn();
    }
  });
  es.addEventListener('resign', async () => { await fetchState(); refresh(); });
  es.onerror = () => { /* browser auto-reconnects */ };
}

async function init() {
  initGameId();
  const state = await fetchState();
  if (!state) return; // fetchState already redirected (lockout / home)
  $('#game').hidden = false;
  loadTentative();
  refresh();

  document.getElementById('btn-history').addEventListener('click', () => {
    toggleDrawer();
    loadHistory(historyNames);
  });
  document.getElementById('btn-history-close').addEventListener('click', closeDrawer);

  $('#btn-recall').addEventListener('click', recall);
  $('#btn-shuffle').addEventListener('click', () => { play('swoosh'); shuffleRack(); refresh(); });
  $('#btn-submit').addEventListener('click', submitMove);
  $('#btn-pass').addEventListener('click', passTurn);
  $('#btn-swap').addEventListener('click', swapTiles);
  $('#btn-resign').addEventListener('click', resign);
  $('#btn-more').addEventListener('click', async () => {
    const btn = $('#btn-more');
    btn.setAttribute('aria-expanded', 'true');
    const choice = await pickMoreActions();
    btn.setAttribute('aria-expanded', 'false');
    if (choice === 'pass') passTurn();
    else if (choice === 'swap') swapTiles();
    else if (choice === 'resign') resign();
  });

  setupMuteToggle();
  setupThemeToggle();
  setupFontToggle();
  // Browsers gate Audio.play() until the user interacts. Prime the cache on
  // the first pointer/keyboard event so the SSE-driven applause for the
  // opponent's move actually plays.
  const primer = () => {
    primeAudio();
    document.removeEventListener('pointerdown', primer);
    document.removeEventListener('keydown', primer);
  };
  document.addEventListener('pointerdown', primer);
  document.addEventListener('keydown', primer);

  maybeOfferNewGame();
  startSSE();
}

function setupMuteToggle() {
  const btn = document.createElement('button');
  btn.id = 'btn-mute';
  btn.type = 'button';
  btn.title = 'Toggle sound';
  btn.setAttribute('aria-label', isMuted() ? 'Unmute sound' : 'Mute sound');
  const sync = () => {
    btn.textContent = isMuted() ? '🔇' : '🔊';
    btn.setAttribute('aria-label', isMuted() ? 'Unmute sound' : 'Mute sound');
  };
  sync();
  btn.addEventListener('click', () => { toggleMuted(); sync(); if (!isMuted()) play('click'); });
  document.body.appendChild(btn);
}

function setupThemeToggle() {
  const btn = document.createElement('button');
  btn.id = 'btn-theme';
  btn.type = 'button';
  const sync = () => {
    const t = getTheme();
    btn.title = `Theme: ${t} (click to cycle)`;
    btn.setAttribute('aria-label', `Cycle tile theme — current: ${t}`);
    btn.textContent = t[0].toUpperCase();
  };
  sync();
  btn.addEventListener('click', () => {
    cycleTheme();
    sync();
    refresh();
    play('click');
  });
  document.body.appendChild(btn);
}

function setupFontToggle() {
  const btn = document.createElement('button');
  btn.id = 'btn-font';
  btn.type = 'button';
  const sync = () => {
    const f = getFont();
    btn.title = `Font: ${getFontLabel()} (click to cycle)`;
    btn.setAttribute('aria-label', `Cycle display font — current: ${getFontLabel()}`);
    btn.textContent = 'Aa';
  };
  sync();
  btn.addEventListener('click', () => {
    cycleFont();
    sync();
    play('click');
  });
  document.body.appendChild(btn);
}

init();
