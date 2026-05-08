import { runValue } from '../values.js';

/**
 * Score events triggered by the most recent play.
 * @param {Card[]} history — cards played in the current run, in play order
 * @param {number} running — current running total (already includes the last play)
 * @returns {ScoreItem[]}
 */
export function scorePeggingPlay(history, running) {
  const items = [];

  if (running === 31) {
    items.push({ kind: 'thirty-one', points: 2, cards: history.slice(), say: '31 for two' });
  } else if (running === 15) {
    items.push({ kind: 'fifteen', points: 2, cards: history.slice(), say: 'fifteen-two' });
  }

  const last = history[history.length - 1];
  let n = 1;
  for (let i = history.length - 2; i >= 0 && history[i].rank === last.rank; i--) n++;
  if (n >= 2) {
    const pts = { 2: 2, 3: 6, 4: 12 }[n];
    const say = { 2: 'and a pair makes two', 3: 'pair royal for six', 4: 'double pair royal for twelve' }[n];
    items.push({ kind: 'pair-pegging', points: pts, cards: history.slice(-n), say });
  }

  for (let len = history.length; len >= 3; len--) {
    const tail = history.slice(-len);
    const vals = tail.map(runValue).sort((a, b) => a - b);
    const unique = new Set(vals).size === vals.length;
    if (!unique) continue;
    let consec = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[i - 1] + 1) { consec = false; break; }
    }
    if (consec) {
      items.push({ kind: 'run', points: len, cards: tail.slice(), say: `run for ${len}` });
      break;
    }
  }

  return items;
}
