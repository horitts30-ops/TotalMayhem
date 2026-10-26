// Placeholder sound effects, generated live with the browser's Web Audio API.
// No audio files needed. Later you can replace any of these with real recorded
// sounds by loading files instead - the rest of the game only calls sfx.jump(),
// sfx.hit() etc., so nothing else has to change.

let actx = null;
let master = null;
let muted = false;
try {
  muted = localStorage.getItem('tm_muted') === '1';
} catch (e) {
  /* storage can be blocked; that is fine */
}

function ensure() {
  if (!actx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(actx.destination);
    } catch (e) {
      return null;
    }
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}

// Browsers only allow sound after the player has clicked or pressed a key.
export function unlockAudio() {
  ensure();
}

export function isMuted() {
  return muted;
}

export function setMuted(v) {
  muted = !!v;
  try {
    localStorage.setItem('tm_muted', muted ? '1' : '0');
  } catch (e) {
    /* ignore */
  }
  if (master) master.gain.value = muted ? 0 : 0.9;
}

function tone(freq, dur, { type = 'square', vol = 0.07, to = null, delay = 0 } = {}) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, { vol = 0.1, freq = 1200, delay = 0, q = 1 } = {}) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0);
}

const lastPlayed = {};
function throttle(name, ms) {
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < ms) return false;
  lastPlayed[name] = now;
  return true;
}

export const sfx = {
  click() {
    tone(660, 0.07, { type: 'triangle', vol: 0.06 });
  },
  join() {
    tone(520, 0.08, { type: 'triangle' });
    tone(780, 0.1, { type: 'triangle', delay: 0.07 });
  },
  jump(v = 1) {
    tone(260, 0.16, { type: 'square', vol: 0.05 * v, to: 620 });
  },
  land(v = 1) {
    noise(0.08, { vol: 0.09 * v, freq: 320 });
  },
  shove() {
    noise(0.16, { vol: 0.1, freq: 1800, q: 0.7 });
    tone(300, 0.1, { type: 'sawtooth', vol: 0.03, to: 120 });
  },
  hit() {
    noise(0.1, { vol: 0.16, freq: 500 });
    tone(180, 0.14, { type: 'square', vol: 0.09, to: 70 });
  },
  crack() {
    if (!throttle('crack', 140)) return;
    noise(0.05, { vol: 0.07, freq: 2600, q: 2 });
    noise(0.04, { vol: 0.05, freq: 3400, q: 2, delay: 0.06 });
  },
  tileFall() {
    if (!throttle('tileFall', 90)) return;
    tone(420, 0.35, { type: 'triangle', vol: 0.04, to: 90 });
  },
  fall() {
    tone(560, 0.7, { type: 'sawtooth', vol: 0.06, to: 60 });
  },
  boo() {
    tone(330, 0.3, { type: 'sine', vol: 0.05, to: 220 });
  },
  ko() {
    tone(660, 0.1, { type: 'square', vol: 0.07 });
    tone(880, 0.1, { type: 'square', vol: 0.07, delay: 0.09 });
    tone(1320, 0.2, { type: 'square', vol: 0.07, delay: 0.18 });
  },
  puddle() {
    noise(0.18, { vol: 0.08, freq: 400, q: 0.6 });
    tone(200, 0.2, { type: 'sine', vol: 0.06, to: 120 });
  },
  slow() {
    tone(300, 0.25, { type: 'sine', vol: 0.07, to: 110 });
    noise(0.14, { vol: 0.07, freq: 500 });
  },
  deny() {
    tone(140, 0.18, { type: 'square', vol: 0.06 });
  },
  tick() {
    tone(520, 0.12, { type: 'triangle', vol: 0.09 });
  },
  go() {
    tone(784, 0.35, { type: 'square', vol: 0.08 });
    tone(1046, 0.35, { type: 'square', vol: 0.06, delay: 0.02 });
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, { type: 'square', vol: 0.07, delay: i * 0.1 }));
    tone(1318, 0.4, { type: 'triangle', vol: 0.08, delay: 0.42 });
  },
  coin(v = 1) {
    if (!throttle('coin', 40)) return;
    tone(988, 0.07, { type: 'square', vol: 0.05 * v });
    tone(1319, 0.14, { type: 'square', vol: 0.05 * v, delay: 0.06 });
  },
  jackpot() {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.1, { type: 'triangle', vol: 0.07, delay: i * 0.06 }));
  },
  drop() {
    tone(500, 0.18, { type: 'triangle', vol: 0.06, to: 220 });
    noise(0.1, { vol: 0.05, freq: 2600, q: 2 });
  },
  pass() {
    tone(330, 0.09, { type: 'square', vol: 0.07 });
    tone(660, 0.14, { type: 'square', vol: 0.07, delay: 0.08 });
  },
  boom() {
    noise(0.55, { vol: 0.28, freq: 260, q: 0.5 });
    tone(150, 0.5, { type: 'sawtooth', vol: 0.12, to: 40 });
  },
  fuse() {
    tone(1200, 0.05, { type: 'square', vol: 0.04 });
  },
  zone() {
    tone(220, 0.3, { type: 'sine', vol: 0.07, to: 440 });
  },
  lose() {
    tone(330, 0.2, { type: 'triangle', vol: 0.07 });
    tone(262, 0.3, { type: 'triangle', vol: 0.07, delay: 0.18 });
  },
};
