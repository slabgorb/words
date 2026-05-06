import { pipCount } from './pip.js';

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function show(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('hidden', !on);
}

function turnPillText(state) {
  const me = state.youAre;
  const opp = me === 'a' ? 'b' : 'a';
  const phase = state.turn?.phase;
  const active = state.turn?.activePlayer;
  const offerFrom = state.cube?.pendingOffer?.from;
  switch (phase) {
    case 'initial-roll': {
      const myValue = state.initialRoll?.[me];
      if (myValue === null || myValue === undefined) return 'Roll for first move';
      const oppValue = state.initialRoll?.[opp];
      if (oppValue === null || oppValue === undefined) return 'Waiting for opponent…';
      return 'Comparing rolls…';
    }
    case 'pre-roll':
      return active === me ? 'Your turn' : "Opponent's turn";
    case 'moving':
      return active === me ? 'Your move' : 'Opponent moving…';
    case 'awaiting-double-response':
      return offerFrom === me ? 'Waiting for response' : 'Opponent doubled — accept?';
    default:
      return '';
  }
}

export function renderScoreboard(state, ctx) {
  if (!state) return;
  const me = state.youAre;
  const myFriendly = ctx?.yourFriendlyName ?? 'You';
  const oppFriendly = ctx?.opponentFriendlyName ?? 'Opponent';

  // Who is on the LEFT (.score-a)? The viewer.
  setText('name-a', myFriendly);
  setText('name-b', oppFriendly);

  setText('match-target', state.match.target);
  setText('target-a', state.match.target);
  setText('target-b', state.match.target);
  setText('game-no', `Game ${state.match.gameNumber}`);

  const myScore  = me === 'a' ? state.match.scoreA : state.match.scoreB;
  const oppScore = me === 'a' ? state.match.scoreB : state.match.scoreA;
  setText('score-a', myScore);
  setText('score-b', oppScore);

  setText('pip-a', pipCount(state.board, me));
  setText('pip-b', pipCount(state.board, me === 'a' ? 'b' : 'a'));

  const crawford = state.match.crawford === true;
  show('crawford-dot', crawford);
  // The crawford-indicator span shares the .hidden toggle.
  const ind = document.querySelector('.crawford-indicator');
  if (ind) ind.classList.toggle('hidden', !crawford);

  setText('turn-pill', turnPillText(state));
}
