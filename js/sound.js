// ── Notification sounds (user 2026-10-20) ──
// Two single notes, made here with Web Audio (no file to load), quiet and
// plain — a notification, not a game:
//   action — a clear, bell-like ding: something needs you.
//   all    — a softer, lower tone: something new happened.
// Browsers only let a page make sound once someone has clicked or typed on
// it, so the sound is switched on by the first click or key.
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

// [frequency, loudness] partials, the peak, and how long it rings.
const TONES = {
  // E6 with a faint bell overtone: bright enough to notice, short and soft.
  action: { partials: [[1318.5, 1], [2637, 0.12], [3955.5, 0.04]], peak: 0.2, ring: 1.1 },
  // G5, pure and lower, dies away quickly.
  all: { partials: [[783.99, 1], [1567.98, 0.06]], peak: 0.12, ring: 0.55 },
};

export function chime(kind = 'action') {
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  const tone = TONES[kind] ?? TONES.action;
  const t0 = ac.currentTime + 0.02;
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(tone.peak, t0 + 0.012);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.ring);
  out.connect(ac.destination);
  for (const [freq, level] of tone.partials) {
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = level;
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + tone.ring + 0.05);
  }
}
