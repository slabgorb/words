import { pipValue, runValue } from '../cards.js';

const NUMBER_WORDS = {
  2:'two', 4:'four', 6:'six', 8:'eight', 10:'ten', 12:'twelve', 14:'fourteen',
  16:'sixteen', 18:'eighteen', 20:'twenty', 22:'twenty-two', 24:'twenty-four',
  26:'twenty-six', 28:'twenty-eight', 29:'twenty-nine',
};

/**
 * @param {Card[]} hand — 4 cards (or crib's 4)
 * @param {Card} starter
 * @param {{isCrib?: boolean}} opts
 */
export function scoreHand(hand, starter, { isCrib = false } = {}) {
  const five = [...hand, starter];
  const items = [];
  let running = 0;

  // 1. Fifteens — every subset summing to 15
  const fifteens = findSubsetsSummingTo(five, 15);
  for (const subset of fifteens) {
    running += 2;
    items.push({
      kind: 'fifteen',
      points: 2,
      cards: subset,
      say: `fifteen-${NUMBER_WORDS[running] ?? running}`,
    });
  }

  // 2. Pairs — emit one item per matching-rank group of size ≥ 2
  const byRank = {};
  for (const c of five) (byRank[c.rank] ??= []).push(c);
  for (const cards of Object.values(byRank)) {
    if (cards.length < 2) continue;
    const pts = { 2: 2, 3: 6, 4: 12 }[cards.length];
    running += pts;
    const label = { 2: 'a pair', 3: 'pair royal', 4: 'double pair royal' }[cards.length];
    items.push({
      kind: 'pair',
      points: pts,
      cards,
      say: `and ${label} makes ${NUMBER_WORDS[running] ?? running}`,
    });
  }

  // 3. Runs — find max-length runs with multiplicity
  const runs = findRunsWithMultiplicity(five);
  for (const r of runs) {
    running += r.length;
    items.push({
      kind: 'run',
      points: r.length,
      cards: r.cards,
      say: `run for ${NUMBER_WORDS[running] ?? running}`,
    });
  }

  // 4. Flush
  const handSuit = hand[0].suit;
  const handAllSame = hand.every(c => c.suit === handSuit);
  if (handAllSame) {
    if (isCrib) {
      if (starter.suit === handSuit) {
        running += 5;
        items.push({ kind: 'flush', points: 5, cards: five, say: `flush for ${running}` });
      }
    } else {
      const five_match = starter.suit === handSuit;
      const pts = five_match ? 5 : 4;
      running += pts;
      items.push({ kind: 'flush', points: pts, cards: five_match ? five : hand, say: `flush for ${running}` });
    }
  }

  // 5. Nobs — J in hand matching starter suit
  for (const c of hand) {
    if (c.rank === 'J' && c.suit === starter.suit) {
      running += 1;
      items.push({ kind: 'nobs', points: 1, cards: [c], say: `his nobs is ${running}` });
      break;
    }
  }

  return { items, total: running };
}

function findSubsetsSummingTo(cards, target) {
  const result = [];
  const rec = (start, picked, sum) => {
    if (sum === target && picked.length > 0) {
      result.push(picked.slice());
      return;
    }
    if (sum > target) return;
    for (let i = start; i < cards.length; i++) {
      picked.push(cards[i]);
      rec(i + 1, picked, sum + pipValue(cards[i]));
      picked.pop();
    }
  };
  rec(0, [], 0);
  return result;
}

function findRunsWithMultiplicity(cards) {
  // Bucket by runValue, find longest contiguous stretch ≥ 3.
  const byVal = {};
  for (const c of cards) (byVal[runValue(c)] ??= []).push(c);
  const vals = Object.keys(byVal).map(Number).sort((a, b) => a - b);
  let longest = [];
  for (let i = 0; i < vals.length; i++) {
    const stretch = [vals[i]];
    while (i + 1 < vals.length && vals[i + 1] === vals[i] + 1) {
      i++;
      stretch.push(vals[i]);
    }
    if (stretch.length > longest.length) longest = stretch;
  }
  if (longest.length < 3) return [];
  const buckets = longest.map(v => byVal[v]);
  const product = cartesian(buckets);
  return product.map(cards => ({ length: longest.length, cards }));
}

function cartesian(arrs) {
  return arrs.reduce(
    (acc, arr) => acc.flatMap(prev => arr.map(item => [...prev, item])),
    [[]],
  );
}
