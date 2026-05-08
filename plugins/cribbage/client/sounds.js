// Lightweight SFX for cribbage. Mirrors the words plugin's pattern:
// one Audio per source, cloned on play() so overlapping triggers don't
// cut each other off.

const SRC = {
  click: 'sounds/click.mp3',
  swoosh: 'sounds/swoosh.mp3',
  'cheer-20': 'sounds/cheer-20.mp3',
  'cheer-30': 'sounds/cheer-30.mp3',
  'cheer-50': 'sounds/cheer-50.mp3',
  'cheer-100': 'sounds/cheer-100.mp3',
  'your-turn': 'sounds/your-turn.mp3',
};

const VOLUME = {
  click: 0.45,
  swoosh: 0.5,
  'cheer-20': 0.55,
  'cheer-30': 0.7,
  'cheer-50': 0.85,
  'cheer-100': 1.0,
  'your-turn': 0.55,
};

const MUTE_KEY = 'cribbage.muted';
let muted = localStorage.getItem(MUTE_KEY) === '1';
const cache = new Map();

function load(name) {
  const src = SRC[name];
  if (!src) return null;
  let a = cache.get(name);
  if (!a) {
    a = new Audio(src);
    a.preload = 'auto';
    cache.set(name, a);
  }
  return a;
}

export function play(name) {
  if (muted) return;
  const base = load(name);
  if (!base) return;
  const clip = base.cloneNode();
  clip.volume = VOLUME[name] ?? 1;
  clip.play().catch(() => { /* autoplay blocked until first interaction */ });
}

// Map a cribbage scoring delta to a tiered cheer.
//   1-2  pts → click (peg, last-card, fifteen-2)
//   3-5  pts → cheer-20 (single run, pair royal of 6)
//   6-12 pts → cheer-30 (long run, double-run, pair royal)
//   13+  pts → cheer-50 (huge crib, double pair royal)
export function playForScore(points) {
  if (points >= 13) play('cheer-50');
  else if (points >= 6) play('cheer-30');
  else if (points >= 3) play('cheer-20');
  else if (points >= 1) play('click');
}

export function isMuted() { return muted; }
export function toggleMuted() {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  return muted;
}

let primed = false;
export function primeAudio() {
  if (primed) return;
  primed = true;
  for (const name of Object.keys(SRC)) load(name);
}
