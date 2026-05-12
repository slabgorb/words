function homeIndexBot(side, i) {
  // Map a state-index (0..23) to the bot's "player-relative" pip number (1..24).
  // For side A: pip = 24 - i ; A bears off from i=18..23 (pips 1..6).
  // For side B: pip = i + 1  ; B bears off from i=5..0  (pips 1..6).
  return side === 'a' ? 24 - i : i + 1;
}

// Returns state indices for the top row (pips 13..24 left-to-right) and
// bottom row (pips 12..1 left-to-right) from the bot's perspective.
function rowIndices(side) {
  if (side === 'a') {
    const top = [];    // pips 13..24 → state-indices 11..0
    for (let pip = 13; pip <= 24; pip++) top.push(24 - pip);
    const bot = [];    // pips 12..1 → state-indices 12..23
    for (let pip = 12; pip >= 1; pip--) bot.push(24 - pip);
    return { top, bot };
  }
  const top = [];      // pips 13..24 from B perspective → state-indices 12..23
  for (let pip = 13; pip <= 24; pip++) top.push(pip - 1);
  const bot = [];      // pips 12..1 from B perspective → state-indices 11..0
  for (let pip = 12; pip >= 1; pip--) bot.push(pip - 1);
  return { top, bot };
}

function cellGlyph(point, side) {
  if (point.count === 0) return ' ·';
  const symbol = point.color === side ? 'O' : 'X';
  return `${symbol}${point.count}`;
}

function padCell(s) {
  // Right-align width 3, e.g. " O5", "X15", " ·".
  return s.padStart(3, ' ');
}

function pipLabel(pip) {
  return String(pip).padStart(2, ' ');
}

function renderRow(stateIndices, board, side) {
  const left = stateIndices.slice(0, 6).map(i => padCell(cellGlyph(board.points[i], side))).join('');
  const right = stateIndices.slice(6).map(i => padCell(cellGlyph(board.points[i], side))).join('');
  return `${left} |${right}`;
}

function renderPipLabelRow(pipNumbers) {
  const left = pipNumbers.slice(0, 6).map(pipLabel).join(' ');
  const right = pipNumbers.slice(6).map(pipLabel).join(' ');
  return `${left} | ${right}`;
}

export function renderBoard(board, side) {
  const { top, bot } = rowIndices(side);
  const topPips = top.map(i => homeIndexBot(side, i));
  const botPips = bot.map(i => homeIndexBot(side, i));
  const youBar = side === 'a' ? board.barA : board.barB;
  const oppBar = side === 'a' ? board.barB : board.barA;
  const youOff = side === 'a' ? board.bornOffA : board.bornOffB;
  const oppOff = side === 'a' ? board.bornOffB : board.bornOffA;
  const lines = [
    renderPipLabelRow(topPips),
    `${renderRow(top, board, side)}     bar: you=${String(youBar).padEnd(2)} opp=${oppBar}`,
    `${' '.repeat(18)}|`,
    `${renderRow(bot, board, side)}     off: you=${String(youOff).padEnd(2)} opp=${oppOff}`,
    renderPipLabelRow(botPips),
  ];
  return lines.join('\n');
}

function header(state, botSide) {
  const sideLabel = botSide === 'a' ? 'side A (moving toward higher-indexed points)' : 'side B (moving toward lower-indexed points)';
  const oppSide = botSide === 'a' ? 'b' : 'a';
  const youScore = botSide === 'a' ? state.match.scoreA : state.match.scoreB;
  const oppScore = botSide === 'a' ? state.match.scoreB : state.match.scoreA;
  const cubeOwnerLabel = state.cube.owner == null
    ? 'unowned'
    : (state.cube.owner === botSide ? 'owned by you' : 'owned by opponent');
  const crawford = state.match.crawford
    ? 'Crawford: this is the Crawford leg (no doubling)'
    : 'Crawford: not yet';
  const youPip = pipCount(state.board, botSide);
  const oppPip = pipCount(state.board, oppSide);
  const diff = youPip - oppPip;
  const pipLine = diff === 0
    ? `Pip count — you: ${youPip}, opponent: ${oppPip}  (tied)`
    : diff < 0
      ? `Pip count — you: ${youPip}, opponent: ${oppPip}  (you lead by ${-diff})`
      : `Pip count — you: ${youPip}, opponent: ${oppPip}  (you trail by ${diff})`;
  return [
    `You are playing ${sideLabel}.`,
    `Match: ${youScore}–${oppScore} (target ${state.match.target}). Cube: ${state.cube.value}, ${cubeOwnerLabel}. ${crawford}.`,
    pipLine,
  ].join('\n');
}

function diceLine(dice) {
  if (!dice) return 'Dice: not yet rolled.';
  const arr = Array.isArray(dice) ? dice : (dice.remaining ?? dice.values ?? []);
  if (arr.length === 4) return `Dice: ${arr[0]}-${arr[0]} (doubles, four moves)`;
  if (arr.length === 2) return `Dice: ${arr[0]} and ${arr[1]}`;
  if (arr.length === 1) return `Dice: ${arr[0]} (one die remaining)`;
  return 'Dice: not yet rolled.';
}

function phaseBlock(state, botSide) {
  switch (state.turn.phase) {
    case 'initial-roll':
      return 'Opening roll. No decisions to make.';
    case 'pre-roll':
      return [
        diceLine(state.turn.dice),
        'You may roll, or offer the cube if eligible.',
      ].join('\n');
    case 'moving': {
      const bar = botSide === 'a' ? state.board.barA : state.board.barB;
      const lines = [diceLine(state.turn.dice)];
      if (bar > 0) lines.push(`You have ${bar} checker(s) on the bar — must re-enter before any other move.`);
      return lines.join('\n');
    }
    case 'awaiting-double-response': {
      const offerer = state.cube.pendingOffer?.from === botSide ? 'you' : 'Your opponent';
      const cur = state.cube.value;
      const next = cur * 2;
      return [
        `${offerer} has offered to double the cube.`,
        `If you accept, the cube would go from ${cur} to ${next} and you would own it.`,
        `If you decline you pay ${cur} points and the leg ends.`,
      ].join('\n');
    }
    default:
      return '';
  }
}

function rationaleFor(m) {
  if (!m.evalBreakdown) return '';
  const bits = [];
  if (m.evalBreakdown.hitBonus > 0) bits.push(`hits ${m.evalBreakdown.hitBonus / 8}`);
  if (m.evalBreakdown.primeBonus >= 10) bits.push('extends prime');
  if (m.evalBreakdown.blotPenalty <= -4) bits.push('leaves blot(s)');
  if (m.evalBreakdown.homeBoardBonus >= 9) bits.push('builds home');
  return bits.length > 0 ? ` — ${bits.join(', ')}` : '';
}

function legalMovesBlock(legalMoves) {
  // If we've been handed a pre-scored shortlist, surface the eval delta
  // and a one-line rationale so the LLM picks for style not arithmetic.
  const scored = legalMoves.some(m => typeof m.evalDelta === 'number');
  const heading = scored
    ? 'Top candidate moves (pre-scored by board evaluation — pick the one that fits your style):'
    : 'Legal moves:';
  const lines = legalMoves.map(m => {
    if (typeof m.evalDelta !== 'number') return `  - ${m.id}: ${m.summary}`;
    const d = m.evalDelta;
    const sign = d >= 0 ? '+' : '';
    return `  - ${m.id}: ${m.summary} (Δ ${sign}${d.toFixed(1)})${rationaleFor(m)}`;
  });
  return `${heading}\n${lines.join('\n')}`;
}

const RESPONSE_FOOTER = 'Respond with a single JSON object (and nothing else): {"moveId": "<one of the legal move ids above>", "banter": "<short in-character line, may be empty>"}';

export function buildTurnPrompt({ state, legalMoves, botPlayerIdx }) {
  const botSide = botPlayerIdx === 0 ? 'a' : 'b';
  return [
    header(state, botSide),
    renderBoard(state.board, botSide),
    phaseBlock(state, botSide),
    legalMovesBlock(legalMoves),
    RESPONSE_FOOTER,
  ].join('\n\n');
}

function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  throw new Error('no JSON object found in response');
}

export function parseLlmResponse(text) {
  const json = extractJson(text);
  let parsed;
  try { parsed = JSON.parse(json); }
  catch (e) { throw new Error(`response is not valid JSON: ${e.message}`); }
  if (typeof parsed.moveId !== 'string') throw new Error('response missing moveId');
  return {
    moveId: parsed.moveId,
    banter: typeof parsed.banter === 'string' ? parsed.banter : '',
  };
}

export function pipCount(board, side) {
  // Pip = sum over all your checkers of "how far they have to travel to bear off".
  // For A: bearing off from pips 1..6 (state-indices 18..23); a checker at state
  // index i contributes (24 - i) pips.
  // For B: a checker at state index i contributes (i + 1) pips.
  let pips = 0;
  for (let i = 0; i < 24; i++) {
    const cell = board.points[i];
    if (cell.color !== side) continue;
    const dist = side === 'a' ? (24 - i) : (i + 1);
    pips += cell.count * dist;
  }
  // Bar checkers travel 25 pips (must re-enter on opponent's home).
  pips += (side === 'a' ? board.barA : board.barB) * 25;
  return pips;
}
