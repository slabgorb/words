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
