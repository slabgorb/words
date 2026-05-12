import { canOffer } from '../cube.js';
import { enumerateLegalMoves as legalSingleMoves, legalFirstMoves, maxConsumableDice } from '../validate.js';
import { applyMove, enterFromBar, bearOff } from '../board.js';

function sideOf(botPlayerIdx) {
  return botPlayerIdx === 0 ? 'a' : 'b';
}

function preRollMoves(state, botSide) {
  const out = [{ id: 'roll', action: { type: 'roll' }, summary: 'Roll the dice' }];
  if (canOffer({ cube: state.cube, match: state.match }, botSide)) {
    const next = state.cube.value * 2;
    out.push({
      id: `offer-double:${next}`,
      action: { type: 'offer-double' },
      summary: `Offer to double the cube from ${state.cube.value} to ${next}`,
    });
  }
  return out;
}

function awaitingDoubleResponseMoves(state) {
  const cur = state.cube.value;
  const next = cur * 2;
  return [
    {
      id: 'accept-double',
      action: { type: 'accept-double' },
      summary: `Accept; cube to ${next}, you own it`,
    },
    {
      id: 'decline-double',
      action: { type: 'decline-double' },
      summary: `Decline; concede leg at cube=${cur}`,
    },
  ];
}

function applyMoveOrEnter(board, side, m) {
  if (m.from === 'bar') return enterFromBar(board, side, m.to);
  if (m.to === 'off')   return bearOff(board, side, m.from);
  return applyMove(board, side, m.from, m.to);
}

function removeOneDie(dice, value) {
  const idx = dice.indexOf(value);
  if (idx < 0) return dice.slice();
  return [...dice.slice(0, idx), ...dice.slice(idx + 1)];
}

function canonicalSig(b) {
  const pts = b.points.map(p => `${p.color ?? '·'}${p.count}`).join('|');
  return `${pts}|A:${b.barA}/${b.bornOffA}|B:${b.barB}/${b.bornOffB}`;
}

// Returns an array of full-turn sequences. Each sequence is an array of
// raw move objects {from, to, die}. Sequences are deduplicated by their
// resulting (canonical) board signature so we don't show the LLM two
// menu items that produce the same outcome.
function enumerateSequences(board, dice, side) {
  const target = maxConsumableDice(board, dice, side);
  if (target === 0) return [];
  const out = [];
  const seen = new Set();
  function dfs(b, remaining, path) {
    if (path.length === target) {
      const sig = canonicalSig(b);
      if (!seen.has(sig)) { seen.add(sig); out.push(path.slice()); }
      return;
    }
    const moves = path.length === 0
      ? legalFirstMoves(b, remaining, side)
      : legalSingleMoves(b, remaining, side);
    if (moves.length === 0) return;
    for (const m of moves) {
      path.push(m);
      dfs(applyMoveOrEnter(b, side, m), removeOneDie(remaining, m.die), path);
      path.pop();
    }
  }
  dfs(board, dice, []);
  return out;
}

function pointLabel(i, side) {
  if (i === 'bar') return 'bar';
  if (i === 'off') return 'off';
  return String(side === 'a' ? 24 - i : i + 1);
}

// Standard backgammon notation: collapse single-chequer paths
// (`13/11 11/9 9/7 7/5` → `13/5`) and group identical moves with `(n)`
// (`6/4 6/4 6/4 6/4` → `6/4(4)`). The LLM reads this much faster and the
// format matches written backgammon books.
export function formatSequence(seq, side) {
  // 1. Chain consecutive same-chequer hops by raw board index.
  const rem = seq.map(m => ({ from: m.from, to: m.to }));
  const trains = [];
  while (rem.length) {
    const t = rem.shift();
    while (true) {
      const idx = rem.findIndex(m => m.from === t.to);
      if (idx < 0) break;
      t.to = rem[idx].to;
      rem.splice(idx, 1);
    }
    trains.push(t);
  }
  // 2. Bucket identical trains; preserve first-seen order.
  const order = [];
  const counts = new Map();
  for (const t of trains) {
    const key = `${t.from}|${t.to}`;
    if (!counts.has(key)) { counts.set(key, { ...t, count: 0 }); order.push(key); }
    counts.get(key).count++;
  }
  return order.map(k => {
    const b = counts.get(k);
    const s = `${pointLabel(b.from, side)}/${pointLabel(b.to, side)}`;
    return b.count > 1 ? `${s}(${b.count})` : s;
  }).join(' ');
}

function movingMoves(state, botSide) {
  const dice = state.turn.dice.remaining;
  const seqs = enumerateSequences(state.board, dice, botSide);
  if (seqs.length === 0) {
    return [{ id: 'pass-turn', action: { type: 'pass-turn' }, summary: 'No legal moves — pass the turn' }];
  }
  return seqs.map((seq, i) => {
    const [head, ...tail] = seq;
    return {
      id: `seq:${i + 1}`,
      action: { type: 'move', payload: { from: head.from, to: head.to, die: head.die } },
      sequenceTail: tail.map(m => ({ type: 'move', payload: { from: m.from, to: m.to, die: m.die } })),
      summary: formatSequence(seq, botSide),
    };
  });
}

export function enumerateLegalMoves(state, botPlayerIdx) {
  const botSide = sideOf(botPlayerIdx);
  switch (state.turn.phase) {
    case 'initial-roll':
      return [{ id: 'roll-initial', action: { type: 'roll-initial' }, summary: 'Roll opening die' }];
    case 'pre-roll':
      return preRollMoves(state, botSide);
    case 'awaiting-double-response':
      return awaitingDoubleResponseMoves(state);
    case 'moving':
      return movingMoves(state, botSide);
    default:
      return [];
  }
}
