// Standard 121-hole cribbage board, two pegs per player.
//
// Position 0     — start hole (peg lifted off, "in the gate")
// Position 1..60 — outer track, left → right
// Position 61..120 — inner track, right → left
// Position 121   — game hole, shared at the right end
//
// Front peg sits at the player's current score, back peg sits at the
// score the front peg occupied immediately before the most recent
// scoring event (server captures that in state.prevScores).

const HOLES_PER_GROUP = 5;
const GROUPS_PER_ROW = 12;        // 5 × 12 = 60 holes per row
const HOLES_PER_ROW = HOLES_PER_GROUP * GROUPS_PER_ROW;
const HOLE_PX = 9;
const HOLE_GAP_PX = 4;            // gap inside a 5-hole group
const GROUP_GAP_PX = 9;           // gap between groups
const ROW_GAP_PX = 6;             // between a player's outer/inner row
const PLAYER_GAP_PX = 14;         // between the two players' lanes
const SIDE_PAD_PX = 18;           // padding before start hole / after last hole
const PEG_PX = 13;                // pegs sit on top of holes
const SKUNK_AT = 91;              // < 91 = skunked

function holeXOffsetWithinRow(holeIndex) {
  // holeIndex 0..59 → x position within a row of 60 holes
  const groupIdx = Math.floor(holeIndex / HOLES_PER_GROUP);
  const inGroup = holeIndex % HOLES_PER_GROUP;
  return groupIdx * (HOLES_PER_GROUP * HOLE_PX + (HOLES_PER_GROUP - 1) * HOLE_GAP_PX + GROUP_GAP_PX) +
         inGroup * (HOLE_PX + HOLE_GAP_PX);
}

function rowWidth() {
  return GROUPS_PER_ROW * HOLES_PER_GROUP * HOLE_PX +
         GROUPS_PER_ROW * (HOLES_PER_GROUP - 1) * HOLE_GAP_PX +
         (GROUPS_PER_ROW - 1) * GROUP_GAP_PX;
}

// Returns { x, y } in board-pixel coordinates for a given player + score.
// playerLaneTop is the y of the player's outer-row top edge.
function pegPosition(score, playerLaneTop) {
  const outerY = playerLaneTop + HOLE_PX / 2;
  const innerY = playerLaneTop + HOLE_PX + ROW_GAP_PX + HOLE_PX / 2;

  if (score <= 0) {
    // Start hole sits at left edge of outer row, before hole 0
    return { x: SIDE_PAD_PX - HOLE_PX - HOLE_GAP_PX, y: outerY };
  }
  if (score >= 121) {
    // Game hole sits at far right between the two rows
    return { x: SIDE_PAD_PX + rowWidth() + HOLE_GAP_PX + HOLE_PX, y: (outerY + innerY) / 2 };
  }
  if (score <= 60) {
    return { x: SIDE_PAD_PX + holeXOffsetWithinRow(score - 1) + HOLE_PX / 2, y: outerY };
  }
  // 61..120 on inner row, right → left
  const innerHole = 120 - score; // score 61 → innerHole 59 (rightmost), score 120 → innerHole 0 (leftmost)
  return { x: SIDE_PAD_PX + holeXOffsetWithinRow(innerHole) + HOLE_PX / 2, y: innerY };
}

function makeHoleRow(yTop) {
  const row = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  for (let i = 0; i < HOLES_PER_ROW; i++) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', SIDE_PAD_PX + holeXOffsetWithinRow(i) + HOLE_PX / 2);
    c.setAttribute('cy', yTop + HOLE_PX / 2);
    c.setAttribute('r', HOLE_PX / 2 - 1);
    c.setAttribute('class', 'peg-hole');
    row.appendChild(c);
  }
  return row;
}

function makeStartHole(yTop) {
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('cx', SIDE_PAD_PX - HOLE_PX - HOLE_GAP_PX);
  c.setAttribute('cy', yTop + HOLE_PX / 2);
  c.setAttribute('r', HOLE_PX / 2 - 1);
  c.setAttribute('class', 'peg-hole peg-hole--start');
  return c;
}

function makeGameHole(laneTop) {
  const outerY = laneTop + HOLE_PX / 2;
  const innerY = laneTop + HOLE_PX + ROW_GAP_PX + HOLE_PX / 2;
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('cx', SIDE_PAD_PX + rowWidth() + HOLE_GAP_PX + HOLE_PX);
  c.setAttribute('cy', (outerY + innerY) / 2);
  c.setAttribute('r', HOLE_PX / 2 + 1);
  c.setAttribute('class', 'peg-hole peg-hole--game');
  return c;
}

function makeSkunkLine(yTop) {
  // Skunk line falls at score 91 — peg at or past 91 is "out of skunk".
  // In the standard layout that's the 30th hole on the inner row (since
  // 121 - 91 = 30). Render a faint vertical tick across both rows.
  const innerHole = 120 - SKUNK_AT;
  const x = SIDE_PAD_PX + holeXOffsetWithinRow(innerHole) - HOLE_GAP_PX / 2;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x);
  line.setAttribute('x2', x);
  line.setAttribute('y1', yTop - 2);
  line.setAttribute('y2', yTop + HOLE_PX * 2 + ROW_GAP_PX + 2);
  line.setAttribute('class', 'peg-skunk');
  return line;
}

function makePeg(color, kind) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', `peg peg--${kind}`);
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  head.setAttribute('r', PEG_PX / 2);
  head.setAttribute('fill', color);
  head.setAttribute('class', 'peg-head');
  g.appendChild(head);
  return g;
}

function placePeg(g, x, y) {
  g.setAttribute('transform', `translate(${x.toFixed(2)}, ${y.toFixed(2)})`);
}

function buildLane(laneTop) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.appendChild(makeHoleRow(laneTop));
  g.appendChild(makeHoleRow(laneTop + HOLE_PX + ROW_GAP_PX));
  g.appendChild(makeStartHole(laneTop));
  g.appendChild(makeSkunkLine(laneTop));
  return g;
}

function laneTopForPlayer(playerIdx) {
  return playerIdx === 0
    ? 0
    : HOLE_PX * 2 + ROW_GAP_PX + PLAYER_GAP_PX;
}

function totalHeight() {
  return 2 * (HOLE_PX * 2 + ROW_GAP_PX) + PLAYER_GAP_PX;
}

function totalWidth() {
  return SIDE_PAD_PX * 2 + rowWidth() + HOLE_PX * 2 + HOLE_GAP_PX;
}

export function renderPegBoard(container, state, ctx) {
  if (!state) return;
  container.innerHTML = '';

  const w = totalWidth();
  const h = totalHeight();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'peg-board-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Cribbage peg board. Score ${state.scores[0]} to ${state.scores[1]} of ${state.matchTarget ?? 121}.`);

  const myUserId = ctx.userId;
  const mySide = state.sides.a === myUserId ? 0 : 1;
  const colorBySide = {
    0: state.sides.a === myUserId ? (ctx.yourColor ?? '#3b82f6') : (ctx.opponentColor ?? '#f59e0b'),
    1: state.sides.b === myUserId ? (ctx.yourColor ?? '#3b82f6') : (ctx.opponentColor ?? '#f59e0b'),
  };

  // Lanes — render mySide on top so user's eye lands on their pegs first.
  const topPlayer = mySide;
  const bottomPlayer = 1 - mySide;

  svg.appendChild(buildLane(laneTopForPlayer(0)));
  svg.appendChild(buildLane(laneTopForPlayer(1)));
  svg.appendChild(makeGameHole(0)); // single shared game hole at right edge

  const scores = state.scores;
  const prevScores = state.prevScores ?? [0, 0];

  for (const [laneIdx, side] of [[0, topPlayer], [1, bottomPlayer]]) {
    const laneTop = laneTopForPlayer(laneIdx);
    const back = makePeg(colorBySide[side], 'back');
    const front = makePeg(colorBySide[side], 'front');
    const backPos = pegPosition(prevScores[side], laneTop);
    const frontPos = pegPosition(scores[side], laneTop);
    placePeg(back, backPos.x, backPos.y);
    placePeg(front, frontPos.x, frontPos.y);
    svg.appendChild(back);
    svg.appendChild(front);
  }

  container.appendChild(svg);
}
