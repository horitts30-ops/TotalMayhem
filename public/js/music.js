// ---------------------------------------------------------------------------
// music.js - background music, composed by code. There are NO audio files: every
// note is synthesized live with the browser's Web Audio API, like the sound effects.
//
// The file has two halves:
//   1. PURE MUSIC DATA (no browser needed, so it is easy to test): each "style"
//      describes a little band (tempo, key, chords, bass, drums, arpeggio, melody)
//      and eventsAt(style, step) says which notes play on a given 16th note.
//      The melody is generated from a fixed seed, so a style always sounds the same.
//   2. A PLAYER that schedules those notes a fraction of a second ahead and
//      cross-fades when the scene changes (menu -> intro -> a minigame -> results...).
//
// All tunes are original: simple chord loops written for this game.
// ---------------------------------------------------------------------------

import { getAudio, isMuted } from './audio.js';

// ------------------------------------------------------------------ pure data
const SCALES = {
  maj: [0, 2, 4, 5, 7, 9, 11],
  min: [0, 2, 3, 5, 7, 8, 10],
  dor: [0, 2, 3, 5, 7, 9, 10],
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const stepSeconds = (bpm) => 60 / bpm / 4; // one 16th note

// A scale degree (0 = tonic, 7 = the tonic one octave up, -1 = the note below...) to a MIDI note.
export function degreeToMidi(style, degree, octave = 0) {
  const sc = SCALES[style.mode];
  const n = sc.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return style.root + sc[idx] + 12 * (oct + octave);
}

const x = (s) => [...s].map((c, i) => (c === 'x' ? i : -1)).filter((i) => i >= 0);

// Drum patterns: which of the 16 steps in a bar each drum plays on.
const DRUMS = {
  four: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], hatSoft: [0, 4, 8, 12] },
  half: { kick: [0, 10], snare: [8], hat: [2, 6, 10, 14], hatSoft: [] },
  stomp: { kick: [0, 8], snare: [4, 12, 15], hat: [2, 6, 10, 14], hatSoft: [] },
  shuffle: { kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14], hatSoft: [3, 11] },
  tick: { kick: [0, 8], snare: [], hat: [4, 12], hatSoft: [2, 6, 10, 14] },
  none: { kick: [], snare: [], hat: [], hatSoft: [] },
};

const DEFAULT_MIX = { bass: 0.2, pad: 0.05, arp: 0.045, lead: 0.07, drums: 1 };

// `prog` = the chord (as a scale degree) of each bar. `lead` = the melody's rhythm for each bar
// ('x' = a note starts there); the melody notes themselves are generated from `seed`.
export const STYLES = {
  menu: {
    bpm: 112, root: 60, mode: 'maj', prog: [0, 5, 3, 4], seed: 11, vol: 0.85, swing: 0.12,
    bass: 'eighths', drums: DRUMS.half, pad: true, arp: 'updown', arpRate: 2, arpWave: 'triangle',
    leadWave: 'triangle', lead: ['x..x..x...x.x...', 'x.x...x..x......'], rest: 0.18,
  },
  intro: {
    bpm: 120, root: 62, mode: 'dor', prog: [0, 0, 3, 4], seed: 23, vol: 0.8, swing: 0,
    bass: 'pulse', drums: DRUMS.tick, pad: true, arp: 'up', arpRate: 1, arpWave: 'square',
    leadWave: 'triangle', lead: ['x.......x.......', 'x...x...x...x...'], rest: 0.1,
  },
  crumbleFloor: {
    bpm: 140, root: 57, mode: 'min', prog: [0, 5, 2, 6], seed: 31, vol: 0.9, swing: 0,
    bass: 'eighths', drums: DRUMS.four, pad: false, arp: 'up', arpRate: 1, arpWave: 'square', arpOct: 1,
    leadWave: 'square', lead: ['x..x..x.x..x.x..', 'x.x..x..x.x...x.'], rest: 0.2,
    mix: { bass: 0.22, pad: 0.05, arp: 0.03, lead: 0.05, drums: 1 },
  },
  goldGrab: {
    bpm: 128, root: 64, mode: 'maj', prog: [0, 3, 4, 3], seed: 41, vol: 0.9, swing: 0.1,
    bass: 'offbeat', drums: DRUMS.four, pad: false, arp: 'updown', arpRate: 1, arpWave: 'triangle', arpOct: 1,
    leadWave: 'square', lead: ['x.x.x..x..x.x...', 'x..x.x..x.x..x..'], rest: 0.15,
    mix: { bass: 0.2, pad: 0.05, arp: 0.045, lead: 0.05, drums: 0.9 },
  },
  hotPotato: {
    bpm: 152, root: 59, mode: 'min', prog: [0, 6, 5, 1], seed: 53, vol: 0.9, swing: 0,
    bass: 'eighths', drums: DRUMS.four, pad: false, arp: 'up', arpRate: 1, arpWave: 'square', arpOct: 1,
    leadWave: 'square', lead: ['x.x.x.x.x.x.x.xx', 'x..xx..xx..x.x.x'], rest: 0.12,
    mix: { bass: 0.22, pad: 0.05, arp: 0.035, lead: 0.045, drums: 1 },
  },
  hillHustle: {
    bpm: 124, root: 55, mode: 'maj', prog: [0, 0, 3, 4], seed: 61, vol: 0.9, swing: 0,
    bass: 'walk', drums: DRUMS.stomp, pad: true, arp: 'none', arpRate: 2, arpWave: 'triangle',
    leadWave: 'square', lead: ['x..xx.x.x..xx.x.', 'x.x.x...x..x....'], rest: 0.1,
    mix: { bass: 0.24, pad: 0.05, arp: 0.04, lead: 0.06, drums: 1 },
  },
  propHunt: {
    bpm: 100, root: 52, mode: 'min', prog: [0, 0, 5, 4], seed: 71, vol: 0.85, swing: 0.2,
    bass: 'pulse', drums: DRUMS.tick, pad: false, arp: 'up', arpRate: 2, arpWave: 'triangle', arpOct: 1,
    leadWave: 'sine', lead: ['x...x...x..x....', '..x...x.x.......'], rest: 0.35,
    mix: { bass: 0.22, pad: 0.05, arp: 0.05, lead: 0.08, drums: 0.8 },
  },
  meteorMayhem: {
    bpm: 126, root: 62, mode: 'dor', prog: [0, 2, 3, 0], seed: 83, vol: 0.85, swing: 0,
    bass: 'pulse', drums: DRUMS.half, pad: true, arp: 'updown', arpRate: 1, arpWave: 'sine', arpOct: 1,
    leadWave: 'triangle', lead: ['x.......x...x...', 'x...x.......x.x.'], rest: 0.2,
    mix: { bass: 0.2, pad: 0.07, arp: 0.05, lead: 0.07, drums: 0.9 },
  },
  crownChaos: {
    bpm: 136, root: 60, mode: 'maj', prog: [0, 4, 5, 3], seed: 97, vol: 0.9, swing: 0,
    bass: 'walk', drums: DRUMS.four, pad: true, arp: 'up', arpRate: 2, arpWave: 'triangle', arpOct: 1,
    leadWave: 'square', lead: ['x..x..x.x.x.x...', 'xx.x..x.x...x.x.'], rest: 0.1,
    mix: { bass: 0.22, pad: 0.05, arp: 0.04, lead: 0.06, drums: 1 },
  },
  paintPanic: {
    bpm: 132, root: 62, mode: 'maj', prog: [0, 4, 5, 3], seed: 131, vol: 0.9, swing: 0.08,
    bass: 'offbeat', drums: DRUMS.four, pad: false, arp: 'up', arpRate: 2, arpWave: 'triangle', arpOct: 1,
    leadWave: 'square', lead: ['x.x..x.x..x.x...', 'x..x.x.x.x..x.x.'], rest: 0.12,
    mix: { bass: 0.2, pad: 0.05, arp: 0.04, lead: 0.055, drums: 0.95 },
  },
  colorCall: {
    bpm: 118, root: 60, mode: 'dor', prog: [0, 3, 4, 0], seed: 137, vol: 0.85, swing: 0,
    bass: 'pulse', drums: DRUMS.tick, pad: true, arp: 'updown', arpRate: 1, arpWave: 'sine', arpOct: 1,
    leadWave: 'triangle', lead: ['x...x...x.x.....', 'x.x...x...x...x.'], rest: 0.25,
    mix: { bass: 0.2, pad: 0.06, arp: 0.05, lead: 0.07, drums: 0.85 },
  },
  jumpRope: {
    bpm: 144, root: 57, mode: 'min', prog: [0, 0, 3, 4], seed: 149, vol: 0.9, swing: 0.15,
    bass: 'walk', drums: DRUMS.stomp, pad: false, arp: 'up', arpRate: 2, arpWave: 'square', arpOct: 1,
    leadWave: 'square', lead: ['x..x..x.x..x..x.', 'x.x.x..x..x.x...'], rest: 0.1,
    mix: { bass: 0.22, pad: 0.05, arp: 0.03, lead: 0.05, drums: 1 },
  },
  lapDash: {
    bpm: 150, root: 59, mode: 'maj', prog: [0, 5, 3, 4], seed: 151, vol: 0.9, swing: 0,
    bass: 'eighths', drums: DRUMS.four, pad: false, arp: 'updown', arpRate: 2, arpWave: 'square', arpOct: 1,
    leadWave: 'square', lead: ['x.x.x.x.x.xx.x..', 'x.xx.x.x.x.x.xx.'], rest: 0.08,
    mix: { bass: 0.22, pad: 0.05, arp: 0.035, lead: 0.05, drums: 1 },
  },
  digDash: {
    bpm: 104, root: 55, mode: 'dor', prog: [0, 0, 5, 4], seed: 157, vol: 0.85, swing: 0.2,
    bass: 'walk', drums: DRUMS.shuffle, pad: true, arp: 'up', arpRate: 2, arpWave: 'triangle', arpOct: 1,
    leadWave: 'triangle', lead: ['x..x....x.x.....', '..x..x..x.......'], rest: 0.3,
    mix: { bass: 0.22, pad: 0.06, arp: 0.045, lead: 0.07, drums: 0.8 },
  },
  moleStomp: {
    bpm: 138, root: 64, mode: 'maj', prog: [0, 2, 3, 4], seed: 163, vol: 0.9, swing: 0.12,
    bass: 'offbeat', drums: DRUMS.half, pad: false, arp: 'updown', arpRate: 2, arpWave: 'triangle', arpOct: 1,
    leadWave: 'square', lead: ['x.x..x..x.x..x..', 'x..x.xx.x...x.x.'], rest: 0.14,
    mix: { bass: 0.2, pad: 0.05, arp: 0.045, lead: 0.055, drums: 0.9 },
  },
  pitstop: {
    bpm: 96, root: 65, mode: 'maj', prog: [1, 4, 0, 0], seed: 107, vol: 0.85, swing: 0.28,
    bass: 'walk', drums: DRUMS.shuffle, pad: true, arp: 'none', arpRate: 2, arpWave: 'triangle',
    leadWave: 'triangle', lead: ['x..x..x...x.....', 'x.x.....x..x.x..'], rest: 0.25,
    mix: { bass: 0.22, pad: 0.06, arp: 0.04, lead: 0.07, drums: 0.8 },
  },
  results: {
    bpm: 124, root: 60, mode: 'maj', prog: [3, 4, 0, 0], seed: 113, vol: 0.85, swing: 0,
    bass: 'offbeat', drums: DRUMS.four, pad: true, arp: 'up', arpRate: 2, arpWave: 'triangle', arpOct: 1,
    leadWave: 'square', lead: ['x.x.x.x.x...x...', 'x..x.x..x.......'], rest: 0.1,
    mix: { bass: 0.2, pad: 0.05, arp: 0.04, lead: 0.06, drums: 0.9 },
  },
  final: {
    bpm: 112, root: 60, mode: 'maj', prog: [0, 3, 4, 0], seed: 127, vol: 0.9, swing: 0.1,
    bass: 'walk', drums: DRUMS.half, pad: true, arp: 'updown', arpRate: 2, arpWave: 'triangle', arpOct: 1,
    leadWave: 'square', lead: ['x..x..x.x.......', 'x.x.x...x.x.....'], rest: 0.08,
    mix: { bass: 0.22, pad: 0.06, arp: 0.04, lead: 0.07, drums: 0.9 },
  },
};

// Which style plays for what is on screen. `null` = silence (the 3-2-1 countdown, so
// the countdown ticks can be heard).
export function sceneFor({ phase, gid, t }) {
  switch (phase) {
    case 'playing':
      if (typeof t === 'number' && t < 0) return null;
      return STYLES[gid] ? gid : 'crumbleFloor';
    case 'intro':
      return 'intro';
    case 'pitstop':
      return 'pitstop';
    case 'results':
      return 'results';
    case 'final':
      return 'final';
    default:
      return 'menu'; // title screen and lobby
  }
}

const chordDegrees = (deg) => [deg, deg + 2, deg + 4];

function nearestChordTone(d, chord) {
  let best = d;
  let bestDist = Infinity;
  for (let c = d - 3; c <= d + 3; c++) {
    const rel = (((c - chord[0]) % 7) + 7) % 7;
    if (rel === 0 || rel === 2 || rel === 4) {
      const dist = Math.abs(c - d);
      if (dist < bestDist) {
        best = c;
        bestDist = dist;
      }
    }
  }
  return best;
}

// The melody for a whole cycle (two passes of the chord loop), built once per style.
const leadCache = new Map();
function melodyFor(style) {
  if (leadCache.has(style)) return leadCache.get(style);
  const rng = mulberry32(style.seed);
  const bars = style.prog.length * 2;
  const out = [];
  let prev = 4;
  for (let bar = 0; bar < bars; bar++) {
    const deg = style.prog[bar % style.prog.length];
    const chord = chordDegrees(deg);
    const hits = x(style.lead[bar % style.lead.length]);
    const notes = [];
    hits.forEach((s, i) => {
      const r1 = rng();
      const r2 = rng();
      if (r1 < style.rest) return;
      const moves = [-2, -1, -1, 0, 1, 1, 2];
      let d = prev + moves[Math.floor(r2 * moves.length)];
      d = Math.min(11, Math.max(2, d));
      const lastOfCycle = bar === bars - 1 && i === hits.length - 1;
      if (s % 4 === 0 || lastOfCycle) d = nearestChordTone(d, chord);
      prev = d;
      const next = i + 1 < hits.length ? hits[i + 1] : 16;
      notes.push({ s, deg: d, steps: Math.min(4, next - s) });
    });
    out.push(notes);
  }
  leadCache.set(style, out);
  return out;
}

export function cycleSteps(style) {
  return style.prog.length * 2 * 16;
}

// Everything that plays on one 16th note. voice: bass | pad | arp | lead | kick | snare | hat
// steps = how long it lasts (in 16ths), vol = loudness (before the style's own volume).
export function eventsAt(style, step) {
  const mix = { ...DEFAULT_MIX, ...(style.mix || {}) };
  const bar = Math.floor(step / 16);
  const s = step % 16;
  const deg = style.prog[bar % style.prog.length];
  const ev = [];

  // bass
  const bassMidi = (d) => degreeToMidi(style, d, -2);
  if (style.bass === 'eighths' && s % 2 === 0) {
    const note = s === 6 || s === 14 ? bassMidi(deg) + 12 : s === 10 ? bassMidi(deg + 4) : bassMidi(deg);
    ev.push({ voice: 'bass', midi: note, steps: 1.6, vol: mix.bass });
  } else if (style.bass === 'offbeat' && s % 4 === 2) {
    ev.push({ voice: 'bass', midi: bassMidi(deg), steps: 2.4, vol: mix.bass });
  } else if (style.bass === 'walk' && s % 4 === 0) {
    const walk = [0, 4, 2, 4][s / 4];
    ev.push({ voice: 'bass', midi: bassMidi(deg + walk), steps: 3.4, vol: mix.bass });
  } else if (style.bass === 'pulse') {
    if (s === 0) ev.push({ voice: 'bass', midi: bassMidi(deg), steps: 7, vol: mix.bass });
    if (s === 8) ev.push({ voice: 'bass', midi: bassMidi(deg), steps: 5, vol: mix.bass * 0.85 });
    if (s === 14) ev.push({ voice: 'bass', midi: bassMidi(deg + 4), steps: 2, vol: mix.bass * 0.7 });
  }

  // pad: one soft chord per bar
  if (style.pad && s === 0) {
    for (const d of chordDegrees(deg)) ev.push({ voice: 'pad', midi: degreeToMidi(style, d, -1), steps: 16, vol: mix.pad });
  }

  // arpeggio
  if (style.arp !== 'none' && s % style.arpRate === 0) {
    const tones = chordDegrees(deg).map((d) => degreeToMidi(style, d, style.arpOct || 1));
    tones.push(tones[0] + 12);
    const n = s / style.arpRate;
    const order = style.arp === 'updown' ? [0, 1, 2, 3, 2, 1] : [0, 1, 2, 3];
    ev.push({ voice: 'arp', midi: tones[order[n % order.length]], steps: style.arpRate * 0.8, vol: mix.arp });
  }

  // melody
  const notes = melodyFor(style)[bar % (style.prog.length * 2)];
  for (const nt of notes) {
    if (nt.s === s) ev.push({ voice: 'lead', midi: degreeToMidi(style, nt.deg, 0), steps: nt.steps * 0.9, vol: mix.lead });
  }

  // drums
  const d = style.drums;
  if (d.kick.includes(s)) ev.push({ voice: 'kick', steps: 1, vol: 0.5 * mix.drums });
  if (d.snare.includes(s)) ev.push({ voice: 'snare', steps: 1, vol: 0.2 * mix.drums });
  if (d.hat.includes(s)) ev.push({ voice: 'hat', steps: 0.5, vol: 0.07 * mix.drums });
  if (d.hatSoft.includes(s)) ev.push({ voice: 'hat', steps: 0.5, vol: 0.035 * mix.drums });
  return ev;
}

// ------------------------------------------------------------------ the player
const MUSIC_VOLUME = 0.42; // music is kept well below the sound effects
const LOOKAHEAD = 0.28; // seconds of notes scheduled ahead of the clock
const TICK_MS = 70;
const FADE = 0.4;

let enabled = true;
try {
  enabled = localStorage.getItem('tm_music') !== '0';
} catch (e) {
  /* storage can be blocked; that is fine */
}

let wanted = null; // style id the game asked for
let active = null; // style id that is playing right now
let scene = null; // { gain } for the active scene
let step = 0;
let nextTime = 0;
let timer = null;
let noiseBuf = null;

function noiseBuffer(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function playTone(ctx, dest, freq, t, dur, type, vol, attack = 0.012, release = 0.06) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.setValueAtTime(Math.max(0.0002, vol), t + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function playNoise(ctx, dest, t, dur, vol, filterType, freq, q) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function playEvent(ctx, dest, style, ev, t, stepDur) {
  const dur = Math.max(0.05, ev.steps * stepDur);
  switch (ev.voice) {
    case 'bass':
      playTone(ctx, dest, midiToFreq(ev.midi), t, dur, 'triangle', ev.vol * 1.6, 0.01, 0.05);
      break;
    case 'pad':
      playTone(ctx, dest, midiToFreq(ev.midi), t, dur, 'sine', ev.vol * 1.3, 0.35, 0.5);
      break;
    case 'arp':
      playTone(ctx, dest, midiToFreq(ev.midi), t, dur, style.arpWave, ev.vol, 0.008, 0.04);
      break;
    case 'lead':
      playTone(ctx, dest, midiToFreq(ev.midi), t, dur, style.leadWave, ev.vol, 0.015, 0.08);
      break;
    case 'kick': {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      g.gain.setValueAtTime(ev.vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(g);
      g.connect(dest);
      osc.start(t);
      osc.stop(t + 0.22);
      break;
    }
    case 'snare':
      playNoise(ctx, dest, t, 0.12, ev.vol, 'bandpass', 1900, 0.8);
      playTone(ctx, dest, 190, t, 0.08, 'triangle', ev.vol * 0.5, 0.004, 0.05);
      break;
    case 'hat':
      playNoise(ctx, dest, t, 0.04 + ev.steps * 0.02, ev.vol, 'highpass', 7000, 0.7);
      break;
    default:
      break;
  }
}

function fadeOutScene(sc, ctx) {
  if (!sc) return;
  try {
    const now = ctx.currentTime;
    sc.gain.gain.cancelScheduledValues(now);
    sc.gain.gain.setValueAtTime(sc.gain.gain.value, now);
    sc.gain.gain.linearRampToValueAtTime(0.0001, now + 0.3);
  } catch (e) {
    /* ignore */
  }
  setTimeout(() => {
    try {
      sc.gain.disconnect();
    } catch (e) {
      /* ignore */
    }
  }, 700);
}

function pump() {
  const a = getAudio();
  if (!a) return; // sound is not unlocked yet (the browser wants a click first)
  const { ctx, master } = a;
  const silent = !enabled || isMuted() || (typeof document !== 'undefined' && document.hidden);
  const target = silent ? null : wanted;

  if (target !== active) {
    fadeOutScene(scene, ctx);
    scene = null;
    active = target;
    if (active) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(MUSIC_VOLUME * STYLES[active].vol, ctx.currentTime + FADE);
      gain.connect(master);
      scene = { gain };
      step = 0;
      nextTime = ctx.currentTime + 0.06;
    }
  }
  if (!active || !scene) return;

  const style = STYLES[active];
  const stepDur = stepSeconds(style.bpm);
  if (nextTime < ctx.currentTime - 0.1) nextTime = ctx.currentTime + 0.05; // do not "catch up" after a stall
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    const swing = step % 2 === 1 ? (style.swing || 0) * stepDur : 0;
    for (const ev of eventsAt(style, step)) playEvent(ctx, scene.gain, style, ev, nextTime + swing, stepDur);
    nextTime += stepDur;
    step += 1;
  }
}

function ensureTimer() {
  if (!timer && typeof setInterval === 'function') {
    timer = setInterval(pump, TICK_MS);
    if (timer && typeof timer.unref === 'function') timer.unref(); // (only matters in Node tests)
  }
}

export const music = {
  // Ask for a style (a key of STYLES) or null for silence. Safe to call every frame.
  setScene(id) {
    wanted = id && STYLES[id] ? id : null;
    ensureTimer();
  },
  isEnabled() {
    return enabled;
  },
  setEnabled(v) {
    enabled = !!v;
    try {
      localStorage.setItem('tm_music', enabled ? '1' : '0');
    } catch (e) {
      /* ignore */
    }
    ensureTimer();
    pump();
  },
};
