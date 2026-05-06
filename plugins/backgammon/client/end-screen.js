// End-of-leg toast (transient) + end-of-match overlay (persistent).

let lastShownGameNumber = null;

export function renderEndScreen(state, ctx) {
  if (!state) return;
  const me = state.youAre;
  const myScore  = me === 'a' ? state.match.scoreA : state.match.scoreB;
  const oppScore = me === 'a' ? state.match.scoreB : state.match.scoreA;
  const target = state.match.target;
  const matchOver = myScore >= target || oppScore >= target;

  const overlay = document.getElementById('end-screen');
  const headline = document.getElementById('end-headline');
  const summary = document.getElementById('end-summary');
  const newBtn = document.getElementById('btn-new');

  if (matchOver) {
    if (overlay) overlay.classList.remove('hidden');
    if (headline) headline.textContent = myScore > oppScore ? 'You won the match!' : 'Match lost.';
    if (summary) summary.textContent = `Final: ${myScore}–${oppScore} (race to ${target})`;
    if (newBtn) {
      newBtn.classList.remove('hidden');
      newBtn.onclick = () => { window.location.href = '/'; };
    }
  } else {
    if (overlay) overlay.classList.add('hidden');
  }
}

// Called from the SSE 'turn' event when summary.kind === 'leg-end'.
export function flashLegEnd(entry, ctx, state) {
  const s = entry.summary || {};
  const me = state?.youAre ?? 'a';
  const winner = s.winner;
  const myWin = winner === me;
  const winnerName = myWin
    ? (ctx?.yourFriendlyName ?? 'You')
    : (ctx?.opponentFriendlyName ?? 'Opponent');
  const points = s.points ?? '';
  const type = s.type ? ` (${s.type})` : '';
  const text = `${winnerName} won the leg${points ? ` +${points}` : ''}${type}`;

  // Avoid double-toasting the same leg if we re-receive the event.
  const gn = state?.match?.gameNumber;
  if (gn != null && gn === lastShownGameNumber) return;
  lastShownGameNumber = gn;

  const toast = document.createElement('div');
  toast.className = 'leg-toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3000);
}
