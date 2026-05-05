import { ui } from './state.js';

let timer = null;
let inflight = 0;

export function scheduleValidate(callback) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (ui.tentative.length === 0) { callback(null); return; }
    const myInflight = ++inflight;
    try {
      const r = await fetch(`/api/games/${ui.gameId}/validate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ placement: ui.tentative.map(t => ({ r: t.r, c: t.c, letter: t.letter, blank: !!t.blank })) })
      });
      if (myInflight !== inflight) return; // stale response
      const body = await r.json();
      // Normalize points→score for backwards compat with app.js consumer
      if (body.points !== undefined && body.score === undefined) body.score = body.points;
      callback(body);
    } catch (e) {
      console.error('validate failed', e);
      callback({ valid: false, words: [], score: 0, reason: 'network' });
    }
  }, 150);
}
