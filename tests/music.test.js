'use strict';

// Tests for the background music (public/js/music.js). The tunes are made of data,
// so we can check them without a speaker: every note in range, every style complete,
// the same style always gives the same notes, and every scene has music.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { GAMES } = require('../server/games');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'music.js')).href);
const VOICES = ['bass', 'pad', 'arp', 'lead', 'kick', 'snare', 'hat'];

test('music: every style has a sensible tempo, key, chords and drums', async () => {
  const M = await load();
  const ids = Object.keys(M.STYLES);
  assert.ok(ids.length >= 12);
  for (const id of ids) {
    const s = M.STYLES[id];
    assert.ok(s.bpm >= 90 && s.bpm <= 160, `${id} bpm ${s.bpm}`);
    assert.ok(Number.isInteger(s.root) && s.root >= 48 && s.root <= 70, `${id} root`);
    assert.ok(['maj', 'min', 'dor'].includes(s.mode), `${id} mode`);
    assert.ok(s.prog.length >= 2 && s.prog.every((d) => Number.isInteger(d) && d >= 0 && d < 7), `${id} chords`);
    assert.ok(s.vol > 0 && s.vol <= 1, `${id} volume`);
    assert.ok(s.lead.length >= 1 && s.lead.every((p) => /^[x.]{16}$/.test(p)), `${id} melody rhythm is 16 steps`);
    for (const part of ['kick', 'snare', 'hat', 'hatSoft']) {
      assert.ok(s.drums[part].every((n) => Number.isInteger(n) && n >= 0 && n < 16), `${id} drums ${part}`);
    }
    assert.ok(['sine', 'triangle', 'square'].includes(s.leadWave), `${id} lead wave`);
    assert.ok(['sine', 'triangle', 'square'].includes(s.arpWave), `${id} arp wave`);
  }
});

test('music: every note is in a comfortable range, on time and not silent (several full cycles of every style)', async () => {
  const M = await load();
  for (const [id, style] of Object.entries(M.STYLES)) {
    const total = M.cycleSteps(style) * 3;
    let notes = 0;
    for (let step = 0; step < total; step++) {
      for (const ev of M.eventsAt(style, step)) {
        assert.ok(VOICES.includes(ev.voice), `${id} voice ${ev.voice}`);
        assert.ok(ev.steps > 0 && ev.steps <= 16 && Number.isFinite(ev.steps), `${id} length`);
        assert.ok(ev.vol > 0 && ev.vol <= 0.7, `${id} ${ev.voice} loudness ${ev.vol}`);
        if (ev.midi !== undefined) {
          assert.ok(Number.isInteger(ev.midi) && ev.midi >= 28 && ev.midi <= 100, `${id} ${ev.voice} note ${ev.midi}`);
          const f = M.midiToFreq(ev.midi);
          assert.ok(f > 40 && f < 3000, `${id} frequency ${f}`);
          notes++;
        }
      }
    }
    assert.ok(notes > 100, `${id} actually plays notes`);
  }
});

test('music: the melody is the same every time and repeats after one cycle', async () => {
  const M = await load();
  for (const [id, style] of Object.entries(M.STYLES)) {
    const cyc = M.cycleSteps(style);
    for (let step = 0; step < cyc; step += 1) {
      const a = JSON.stringify(M.eventsAt(style, step));
      assert.equal(JSON.stringify(M.eventsAt(style, step)), a, `${id} deterministic`);
      assert.equal(JSON.stringify(M.eventsAt(style, step + cyc)), a, `${id} loops`);
    }
  }
});

test('music: every style has a melody, a bass and drums, and the styles do not all sound alike', async () => {
  const M = await load();
  const fingerprints = new Set();
  for (const [id, style] of Object.entries(M.STYLES)) {
    const seen = new Set();
    const melody = [];
    for (let step = 0; step < M.cycleSteps(style); step++) {
      for (const ev of M.eventsAt(style, step)) {
        seen.add(ev.voice);
        if (ev.voice === 'lead') melody.push(ev.midi);
      }
    }
    for (const v of ['bass', 'lead', 'kick']) assert.ok(seen.has(v), `${id} has ${v}`);
    assert.ok(new Set(melody).size >= 3, `${id} melody uses at least 3 different notes`);
    fingerprints.add(`${style.bpm}|${style.root}|${style.mode}|${style.prog}|${melody.join(',')}`);
  }
  assert.equal(fingerprints.size, Object.keys(M.STYLES).length, 'every style is its own tune');
});

test('music: the melody stays in key (every melody note belongs to the style\'s scale)', async () => {
  const M = await load();
  const SC = { maj: [0, 2, 4, 5, 7, 9, 11], min: [0, 2, 3, 5, 7, 8, 10], dor: [0, 2, 3, 5, 7, 9, 10] };
  for (const [id, style] of Object.entries(M.STYLES)) {
    for (let step = 0; step < M.cycleSteps(style); step++) {
      for (const ev of M.eventsAt(style, step)) {
        if (ev.voice !== 'lead') continue;
        const pc = (((ev.midi - style.root) % 12) + 12) % 12;
        assert.ok(SC[style.mode].includes(pc), `${id}: note ${ev.midi} is out of key`);
      }
    }
  }
});

test('music: tempo maths and degree-to-note maths', async () => {
  const M = await load();
  assert.ok(Math.abs(M.stepSeconds(120) - 0.125) < 1e-9);
  assert.ok(Math.abs(M.midiToFreq(69) - 440) < 1e-9);
  assert.ok(Math.abs(M.midiToFreq(81) - 880) < 1e-9);
  const major = { root: 60, mode: 'maj' };
  assert.equal(M.degreeToMidi(major, 0), 60);
  assert.equal(M.degreeToMidi(major, 4), 67);
  assert.equal(M.degreeToMidi(major, 7), 72, 'degree 7 is the next octave');
  assert.equal(M.degreeToMidi(major, -1), 59, 'below the tonic');
  assert.equal(M.degreeToMidi({ root: 57, mode: 'min' }, 2), 60);
  assert.equal(M.degreeToMidi(major, 0, -2), 36);
});

test('music: every screen and every minigame has its own music; the countdown is silent', async () => {
  const M = await load();
  for (const phase of ['title', 'lobby', 'intro', 'pitstop', 'results', 'final']) {
    const id = M.sceneFor({ phase });
    assert.ok(M.STYLES[id], `${phase} -> ${id}`);
  }
  assert.equal(M.sceneFor({ phase: 'title' }), 'menu');
  assert.equal(M.sceneFor({ phase: 'lobby' }), 'menu');
  for (const gid of Object.keys(GAMES)) {
    assert.equal(M.sceneFor({ phase: 'playing', gid, t: 3 }), gid, `${gid} has its own tune`);
    assert.equal(M.sceneFor({ phase: 'playing', gid, t: -2 }), null, 'silent during 3-2-1 so the ticks are heard');
  }
  assert.equal(M.sceneFor({ phase: 'playing', gid: undefined, t: 5 }), 'crumbleFloor');
  assert.equal(M.sceneFor({ phase: 'playing', gid: 'nonsense', t: 5 }), 'crumbleFloor');
});

test('music: the player is safe to call before the browser has unlocked sound', async () => {
  const M = await load();
  // No browser here: no audio context exists, so nothing may throw and nothing may start.
  assert.doesNotThrow(() => M.music.setScene('menu'));
  assert.doesNotThrow(() => M.music.setScene('not-a-style'));
  assert.doesNotThrow(() => M.music.setScene(null));
  assert.equal(M.music.isEnabled(), true, 'music is on by default');
  assert.doesNotThrow(() => M.music.setEnabled(false));
  assert.equal(M.music.isEnabled(), false);
  M.music.setEnabled(true);
  // stop the repeating timer so the test process can end
  M.music.setScene(null);
});
