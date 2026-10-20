// ── Notification sounds (user 2026-10-20) ──
// A new stock request in the Office Queue, and a new outside-lens order for
// the handler, chime. The notes are made here (Web Audio), so there is no file
// to load. Browsers only let a page make sound once someone has clicked or
// typed on it, so the sound is switched on by the first click or key.
let ctx = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Once, on the first click or key anywhere.
export function armSound() {
  const go = () => { audio(); removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); };
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
}

// The two sounds: a stock request is a two-note "ding-dong"; outside lenses
// a quick three notes going up — different enough to tell apart unseen.
const TUNES = {
  stock:   [[784, 0], [523.25, 0.22]],
  outside: [[659.25, 0], [880, 0.14], [1174.66, 0.28]],
};

export function chime(kind = 'stock') {
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const t0 = ac.currentTime + 0.02;
  for (const [freq, at] of TUNES[kind] ?? TUNES.stock) {
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.6);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.65);
  }
}
