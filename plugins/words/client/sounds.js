// Lightweight SFX player. One Audio per source; clones per play() so
// overlapping triggers don't cut each other off.

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
  click: 0.5,
  swoosh: 0.45,
  'cheer-20': 0.6,
  'cheer-30': 0.7,
  'cheer-50': 0.85,
  'cheer-100': 1.0,
  'your-turn': 0.6,
};

const MUTE_KEY = 'words.muted';
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

// Pick the right cheer for a move's score. Below 20: a soft click,
// no applause. Tiers ascend at >=20, >=30, >=50, >=100.
export function playForScore(score) {
  if (score >= 100) play('cheer-100');
  else if (score >= 50) play('cheer-50');
  else if (score >= 30) play('cheer-30');
  else if (score >= 20) play('cheer-20');
  else play('click');
}

export function isMuted() { return muted; }
export function toggleMuted() {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  return muted;
}

// Warm the audio cache on first user interaction so later plays don't
// race against the autoplay policy.
let primed = false;
export function primeAudio() {
  if (primed) return;
  primed = true;
  for (const name of Object.keys(SRC)) load(name);
}
