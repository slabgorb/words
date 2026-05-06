/* global React, ReactDOM, TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakToggle */
const { useState, useEffect, useMemo, useRef } = React;

// ============================================================
// Initial board state — taken directly from server/board.js
// indices: 0..23. A moves 0→23. B moves 23→0.
//   pts[0]  = A:2     pts[23] = B:2
//   pts[5]  = B:5     pts[7]  = B:3
//   pts[11] = A:5     pts[12] = B:5
//   pts[16] = A:3     pts[18] = A:5
// ============================================================

function initialPoints() {
  const pts = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  pts[0]  = { color: 'a', count: 2 };
  pts[11] = { color: 'a', count: 5 };
  pts[16] = { color: 'a', count: 3 };
  pts[18] = { color: 'a', count: 5 };
  pts[23] = { color: 'b', count: 2 };
  pts[12] = { color: 'b', count: 5 };
  pts[7]  = { color: 'b', count: 3 };
  pts[5]  = { color: 'b', count: 5 };
  return pts;
}

// A mid-game position to make the design feel real & interesting:
// - Some hits, a blot, a checker on the bar, some borne off
function midGameState() {
  const pts = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  // A's pieces (you, ivory, moving 0→23, home = 18..23)
  pts[0]  = { color: 'a', count: 1 };  // back checker (a blot)
  pts[8]  = { color: 'a', count: 3 };
  pts[12] = { color: 'a', count: 2 };
  pts[18] = { color: 'a', count: 3 };
  pts[19] = { color: 'a', count: 2 };
  pts[20] = { color: 'a', count: 2 };
  // B's pieces (Sam, walnut, moving 23→0, home = 0..5)
  pts[23] = { color: 'b', count: 1 };  // a blot
  pts[16] = { color: 'b', count: 2 };
  pts[12] = { color: 'b', count: 0 };  // (cleared above)
  pts[7]  = { color: 'b', count: 3 };
  pts[5]  = { color: 'b', count: 4 };
  pts[3]  = { color: 'b', count: 2 };
  pts[1]  = { color: 'b', count: 1 };  // a blot

  return {
    points: pts,
    barA: 1,
    barB: 0,
    bornOffA: 2,
    bornOffB: 0,
  };
}

// ============================================================
// Layout mapping
//
// Standard tournament layout (home = bottom-right for player A):
//
//   13 14 15 16 17 18 | 19 20 21 22 23 24       ← top row (B's outer | A's home, mirrored)
//   12 11 10  9  8  7 |  6  5  4  3  2  1       ← bottom row (A's outer | B's home, mirrored)
//
// In server-index terms, "point N" on a real board ≠ array index N.
// For player A (whose home is 18..23 = points 19..24),
// the **visual** layout is:
//
//   top-left quadrant    (cols 1..6 of top row)    = idx 12..17
//   top-right quadrant   (cols 1..6 of top row)    = idx 18..23   ← A's HOME
//   bot-left quadrant    (cols 1..6 of bot row)    = idx 11..6    (reversed)
//   bot-right quadrant   (cols 1..6 of bot row)    = idx  5..0    (reversed)
//
// Each cell is one "point" (a triangle).
// ============================================================

// Standard tournament layout, home bottom-right. Top row = points 13..24.
// Player A's home is bottom-right (their 1..6 points = idx 23..18).
// Top row, left→right reads:  13 14 15 16 17 18 | 19 20 21 22 23 24
// Bottom row, left→right reads: 12 11 10  9  8  7 |  6  5  4  3  2  1
// (label = 24 - idx)
const LAYOUT = {
  topLeft:  [11, 10, 9, 8, 7, 6],     // labels 13,14,15,16,17,18
  topRight: [5, 4, 3, 2, 1, 0],       // labels 19,20,21,22,23,24 — A's farthest from home
  botLeft:  [12, 13, 14, 15, 16, 17], // labels 12,11,10,9,8,7
  botRight: [18, 19, 20, 21, 22, 23], // labels 6,5,4,3,2,1 — A's HOME
};

// Standard backgammon point numbering shown to player A.
// Player A's 24-point is array idx 0; their 1-point is array idx 23.
// (A starts on the 24, races to bear off from the 1-point.)
//   idx 0 → label 24    idx 23 → label 1
//   idx 12 → label 12   idx 11 → label 13
function pointLabel(idx) {
  return 24 - idx;
}

// ============================================================
// Components
// ============================================================

function Checker({ color, selected, onClick, badge }) {
  return (
    <div
      className={`checker color-${color}${selected ? ' selected' : ''}`}
      onClick={onClick}
    >
      {badge != null && <div className="stack-badge">×{badge}</div>}
    </div>
  );
}

function PointTri({ position, parity }) {
  // Point triangles drawn as SVG so they fit cell width perfectly.
  // `position` is "top" or "bottom".  `parity` is "light" or "dark".
  const fill = parity === 'light' ? 'var(--pt-light)' : 'var(--pt-dark)';
  const edge = 'var(--pt-edge)';
  const path = position === 'top'
    ? 'M0,0 L100,0 L50,100 Z'
    : 'M0,100 L100,100 L50,0 Z';
  return (
    <div className="point-tri">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`g-${position}-${parity}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity="1" />
            <stop offset="100%" stopColor={fill} stopOpacity="0.78" />
          </linearGradient>
        </defs>
        <path d={path} fill={`url(#g-${position}-${parity})`} stroke={edge} strokeWidth="0.6" />
        {/* subtle highlight along center for sheen */}
        <path
          d={position === 'top'
            ? 'M50,4 L52,4 L51,96 Z'
            : 'M50,96 L52,96 L51,4 Z'}
          fill="rgba(255,255,255,0.18)"
        />
      </svg>
    </div>
  );
}

function Point({ idx, position, parity, cell, isLegal, isSelected, onClickPoint, onClickChecker, showLegalDots }) {
  // Build the visible stack: up to 5 visible checkers + an optional badge.
  const count = cell.count;
  const visible = Math.min(count, 5);
  const overflow = count - visible;
  // Compress mode kicks in past 5; the badge shows actual count on the topmost.
  const compressed = count > 5;

  const stack = [];
  for (let i = 0; i < visible; i++) {
    const isTop = (position === 'top') ? (i === visible - 1) : (i === 0);
    const showBadge = isTop && overflow > 0 ? count : null;
    stack.push(
      <Checker
        key={i}
        color={cell.color}
        selected={isSelected && isTop}
        badge={showBadge}
        onClick={isTop ? () => onClickChecker(idx) : undefined}
      />
    );
  }

  return (
    <div
      className={`point ${position} ${cell.color ? 'movable' : ''}`}
      onClick={() => onClickPoint(idx)}
    >
      <PointTri position={position} parity={parity} />
      <div className="point-num">{pointLabel(idx)}</div>
      <div className={`point-stack${compressed ? ' compressed' : ''}`}>
        {stack}
      </div>
      {showLegalDots && isLegal && cell.count === 0 && <div className="legal-target" />}
    </div>
  );
}

function Quadrant({ position, side, indices, selectedIdx, legalIdxs, board, onClickPoint, onClickChecker, showLegalDots }) {
  // Top quadrants: triangles point DOWN (position=top)
  // Bottom quadrants: triangles point UP (position=bottom)
  return (
    <div className={`quad ${position[0]}${side[0]}`}>
      {indices.map((idx, col) => {
        // Alternating triangle colors. col 0,2,4 = light; 1,3,5 = dark
        // (varies between top and bottom row in real boards; matched by traditional pattern)
        const parity = (col % 2 === 0) === (position === 'top') ? 'light' : 'dark';
        return (
          <Point
            key={idx}
            idx={idx}
            position={position}
            parity={parity}
            cell={board.points[idx]}
            isLegal={legalIdxs.has(idx)}
            isSelected={selectedIdx === idx}
            onClickPoint={onClickPoint}
            onClickChecker={onClickChecker}
            showLegalDots={showLegalDots}
          />
        );
      })}
    </div>
  );
}

function Bar({ board, onClickChecker, selected }) {
  // barA: A's checkers waiting to enter (rendered top half)
  // barB: B's checkers waiting to enter (rendered bottom half)
  // Convention: A's bar is up top because A has to enter into B's home (idx 0..5),
  // which lives in the BOTTOM-right; A enters from the bar going DOWN. We mirror
  // visually by putting A's bar checkers on the TOP half (closer to where they go).
  // Actually the cleanest convention is "your bar checker sits on YOUR side of the bar."
  // For player A (perspective owner), A's bar checkers stack on the bottom half.
  // We'll do that.

  const aOnBar = [];
  for (let i = 0; i < board.barA; i++) {
    aOnBar.push(
      <Checker
        key={`a${i}`}
        color="a"
        selected={selected === 'bar-a' && i === board.barA - 1}
        onClick={i === board.barA - 1 ? () => onClickChecker('bar-a') : undefined}
      />
    );
  }
  const bOnBar = [];
  for (let i = 0; i < board.barB; i++) {
    bOnBar.push(
      <Checker
        key={`b${i}`}
        color="b"
        selected={selected === 'bar-b' && i === board.barB - 1}
        onClick={i === board.barB - 1 ? () => onClickChecker('bar-b') : undefined}
      />
    );
  }

  return (
    <div className="bar">
      <div className="bar-half bar-top">{bOnBar}</div>
      <div className="bar-half bar-bottom">{aOnBar}</div>
    </div>
  );
}

function OffTray({ board }) {
  // top: A's borne-off (home top-right neighbour); bottom: B's
  // We render small bars to represent stacked checkers (saves space and reads cleanly).
  const aBars = Array.from({ length: board.bornOffA }, (_, i) => (
    <div key={i} className="off-bar a" />
  ));
  const bBars = Array.from({ length: board.bornOffB }, (_, i) => (
    <div key={i} className="off-bar b" />
  ));
  return (
    <div className="off-tray">
      <div className="off-tray-half top">
        <div className="off-tray-label">B borne off</div>
        <div className="off-stack">{bBars}</div>
        {board.bornOffB > 0 && <div className="off-count">{board.bornOffB}</div>}
      </div>
      <div className="off-tray-divider" />
      <div className="off-tray-half bottom">
        <div className="off-tray-label">You borne off</div>
        <div className="off-stack">{aBars}</div>
        {board.bornOffA > 0 && <div className="off-count">{board.bornOffA}</div>}
      </div>
    </div>
  );
}

function DiePlaceholder({ value }) {
  // Simple pip layout for a 6-sided die.
  const positions = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  }[value] || [];
  // Map slot 1..9 to a 3x3 grid (row-major).
  return (
    <div className="die-placeholder">
      {Array.from({ length: 9 }, (_, i) => {
        const slot = i + 1;
        return (
          <div key={i} style={{ visibility: positions.includes(slot) ? 'visible' : 'hidden' }} className="pip" />
        );
      })}
    </div>
  );
}

// ============================================================
// Main app
// ============================================================

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "walnut",
  "showLegalDots": true
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply theme to body
  useEffect(() => {
    document.body.dataset.theme = tweaks.theme;
  }, [tweaks.theme]);

  // Mid-game state (a snapshot, not a live engine)
  const [board] = useState(() => midGameState());
  // Selection: a point idx, "bar-a", "bar-b", or null
  const [selected, setSelected] = useState(null);
  // Player A is the viewer. Active player A. Dice = [4, 2].
  const dice = [4, 2];
  const activePlayer = 'a';

  // Compute legal targets for the selected source.
  // Simplified: A moves +die, blocked if opp has 2+. We don't enforce
  // must-use-both for the visual mock. Bar must enter first.
  const legalIdxs = useMemo(() => {
    if (selected === null) return new Set();
    const targets = new Set();
    const isBar = selected === 'bar-a' || selected === 'bar-b';
    const player = isBar ? selected.slice(-1) : board.points[selected]?.color;
    if (!player) return targets;
    if (player !== activePlayer) return targets;

    // If A has bar checkers, must move from bar first
    if (board.barA > 0 && selected !== 'bar-a' && player === 'a') return targets;
    if (board.barB > 0 && selected !== 'bar-b' && player === 'b') return targets;

    for (const die of dice) {
      let to;
      if (isBar) {
        to = player === 'a' ? die - 1 : 24 - die;
      } else {
        to = player === 'a' ? selected + die : selected - die;
      }
      if (to < 0 || to > 23) continue;
      const dest = board.points[to];
      if (dest.color && dest.color !== player && dest.count >= 2) continue;
      targets.add(to);
    }
    return targets;
  }, [selected, board, activePlayer]);

  function clickChecker(loc) {
    // loc is either an idx or "bar-a"/"bar-b"
    if (loc === selected) { setSelected(null); return; }
    // Only let user pick checkers belonging to the active player
    if (loc === 'bar-a' || loc === 'bar-b') {
      if (loc.slice(-1) !== activePlayer) return;
      setSelected(loc);
      return;
    }
    const cell = board.points[loc];
    if (!cell || cell.color !== activePlayer) return;
    setSelected(loc);
  }

  function clickPoint(idx) {
    // For the visual mock, do nothing on point clicks (we just toggle the source).
    // Real engine would call applyMove here.
  }

  return (
    <div className="board-wrap">
      <div className="board">
        <Quadrant
          position="top" side="left"
          indices={LAYOUT.topLeft}
          board={board}
          legalIdxs={legalIdxs}
          selectedIdx={selected}
          onClickChecker={clickChecker}
          onClickPoint={clickPoint}
          showLegalDots={tweaks.showLegalDots}
        />
        <Quadrant
          position="top" side="right"
          indices={LAYOUT.topRight}
          board={board}
          legalIdxs={legalIdxs}
          selectedIdx={selected}
          onClickChecker={clickChecker}
          onClickPoint={clickPoint}
          showLegalDots={tweaks.showLegalDots}
        />
        <Quadrant
          position="bottom" side="left"
          indices={LAYOUT.botLeft}
          board={board}
          legalIdxs={legalIdxs}
          selectedIdx={selected}
          onClickChecker={clickChecker}
          onClickPoint={clickPoint}
          showLegalDots={tweaks.showLegalDots}
        />
        <Quadrant
          position="bottom" side="right"
          indices={LAYOUT.botRight}
          board={board}
          legalIdxs={legalIdxs}
          selectedIdx={selected}
          onClickChecker={clickChecker}
          onClickPoint={clickPoint}
          showLegalDots={tweaks.showLegalDots}
        />
        <Bar board={board} onClickChecker={clickChecker} selected={selected} />
        <OffTray board={board} />
        {/* Doubling cube — currently centered on bar (no owner) */}
        <Cube />
        {/* Dice placeholder — sits in active player's outer board (left side, bottom) */}
        <DiceArea dice={dice} />
      </div>
      <TweaksHost tweaks={tweaks} setTweak={setTweak} />
    </div>
  );
}

function Cube() {
  // Cube at value 2, owned by you (A) — sits on bottom-half of bar
  return (
    <div className="cube owned-a" title="Doubling cube — you own at 2">
      <span className="cube-value">2</span>
    </div>
  );
}

function DiceArea({ dice }) {
  // Sits in the player's outer board (bottom-left quadrant per tournament convention).
  return (
    <div className="dice-area" style={{
      position: 'absolute',
      left: '24%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    }}>
      <div style={{ position: 'relative' }}>
        <div className="dice-area-label">dice (placeholder)</div>
        <div style={{ display: 'flex', gap: 14 }}>
          {dice.map((v, i) => <DiePlaceholder key={i} value={v} />)}
        </div>
      </div>
    </div>
  );
}

function TweaksHost({ tweaks, setTweak }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="Theme">
        <TweakRadio
          label="Surface"
          value={tweaks.theme}
          options={[
            { value: 'walnut', label: 'Walnut' },
            { value: 'marble', label: 'Marble' },
            { value: 'jade', label: 'Jade' },
            { value: 'leather', label: 'Leather' },
          ]}
          onChange={(v) => setTweak('theme', v)}
        />
      </TweakSection>
      <TweakSection title="Affordances">
        <TweakToggle
          label="Show legal-move dots"
          value={tweaks.showLegalDots}
          onChange={(v) => setTweak('showLegalDots', v)}
        />
      </TweakSection>
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

// Wire up the gear button as a tweaks toggle.
document.getElementById('btn-tweaks-toggle')?.addEventListener('click', () => {
  // The TweaksPanel listens for parent toggle messages; we simulate by
  // dispatching a window message that mimics the host activation.
  // Simplest: dispatch a custom event the panel can listen for, OR just
  // toggle a class — but the cleanest is to post the message.
  window.postMessage({ type: '__activate_edit_mode' }, '*');
});
