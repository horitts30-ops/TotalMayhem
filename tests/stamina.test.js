'use strict';

// Tests for STAMINA (jump + shove share one bar), the bigger shove reach, and the
// two stamina power-ups ("Big Lungs" and "Second Wind"). Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { STAMINA } = require('../server/stamina');
const powerups = require('../server/powerups');
const CrumbleFloor = require('../server/games/crumbleFloor');
const GoldGrab = require('../server/games/goldGrab');
const PropHunt = require('../server/games/propHunt');
const ArenaGame = require('../server/games/arenaBase');

const DT = 1 / 30;
const GAMES = [CrumbleFloor, GoldGrab];

function make(Game, n = 2, mods = {}) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push({ id: `p${i + 1}`, name: `P${i + 1}` });
  const g = new Game(parts, 'classic', { mods });
  g.time = 0.5;
  return g;
}
const run = (g, s) => {
  for (let i = 0, n = Math.round(s / DT); i < n; i++) g.tick(DT);
};
function place(p, x, y, fx = 1, fy = 0) {
  p.x = x;
  p.y = y;
  p.z = 0;
  p.vx = p.vy = p.kx = p.ky = p.vz = 0;
  p.fx = fx;
  p.fy = fy;
}
const press = (g, id, input) => g.setInput(id, { mx: 0, my: 0, jump: false, shove: false, ...input });
const tap = (g, id, key) => {
  press(g, id, { [key]: true });
  g.tick(DT);
  press(g, id, {});
  g.tick(DT);
};
// Waits until the player is on the ground again and the shove cooldown is over.
const settle = (g, p) => {
  for (let i = 0; i < 90 && (p.z > 0 || p.shoveCd > 0); i++) g.tick(DT);
};

test('stamina: everybody starts full, and jumping and shoving both spend from the SAME bar', () => {
  for (const Game of GAMES) {
    const g = make(Game, 2);
    const p = g.players.get('p1');
    place(p, 300, 288);
    place(g.players.get('p2'), 700, 288);
    assert.equal(p.stamina, STAMINA.max, `${Game.name}: starts full`);
    tap(g, 'p1', 'jump');
    assert.ok(p.stamina < STAMINA.max - STAMINA.jumpCost + 3, `${Game.name}: a jump costs ${STAMINA.jumpCost} (now ${p.stamina.toFixed(1)})`);
    const afterJump = p.stamina;
    settle(g, p);
    p.staminaWait = 0;
    p.stamina = afterJump; // pin the bar so we measure exactly one shove
    tap(g, 'p1', 'shove');
    assert.ok(p.stamina < afterJump - STAMINA.shoveCost + 3, `${Game.name}: a shove costs ${STAMINA.shoveCost} (now ${p.stamina.toFixed(1)})`);
    assert.equal(p.shoves, 1);
  }
});

test('stamina: when you are too tired, the jump or shove does not happen and you are told', () => {
  for (const Game of GAMES) {
    const g = make(Game, 2);
    const p = g.players.get('p1');
    place(p, 300, 288);
    place(g.players.get('p2'), 700, 288);
    p.stamina = 10;
    p.staminaWait = 5; // no refill during this test
    g.events = [];
    tap(g, 'p1', 'jump');
    assert.equal(p.jumps, 0, `${Game.name}: no jump`);
    assert.equal(p.z, 0, `${Game.name}: still on the ground`);
    tap(g, 'p1', 'shove');
    assert.equal(p.shoves, 0, `${Game.name}: no shove`);
    assert.equal(p.stamina, 10, `${Game.name}: nothing was spent`);
    const tired = g.events.filter((e) => e.k === 'tired' && e.id === 'p1');
    assert.ok(tired.length >= 1, `${Game.name}: a "tired" event was sent`);
    assert.ok(tired.length <= 3, `${Game.name}: ...but not one every tick (${tired.length})`);
  }
});

test('stamina: it refills by itself, but only after a short pause, and never above the maximum', () => {
  for (const Game of GAMES) {
    const g = make(Game, 2);
    const p = g.players.get('p1');
    place(p, 300, 288);
    place(g.players.get('p2'), 700, 288);
    p.stamina = 0;
    p.staminaWait = STAMINA.regenDelay;
    run(g, STAMINA.regenDelay - 0.1);
    assert.equal(p.stamina, 0, `${Game.name}: still paused`);
    run(g, 1.0 + 0.1);
    assert.ok(p.stamina > STAMINA.regen * 0.8 && p.stamina < STAMINA.regen * 1.3, `${Game.name}: about ${STAMINA.regen} per second (${p.stamina.toFixed(1)})`);
    run(g, 20);
    assert.equal(p.stamina, p.staminaMax, `${Game.name}: capped at the maximum`);
  }
});

test('stamina: a jump pressed just before enough has come back still works (small grace)', () => {
  const g = make(GoldGrab, 2);
  const p = g.players.get('p1');
  place(p, 300, 288);
  place(g.players.get('p2'), 700, 288);
  p.stamina = STAMINA.jumpCost - 0.2;
  p.staminaWait = 0;
  press(g, 'p1', { jump: true });
  run(g, 0.1);
  assert.equal(p.jumps, 1, 'it went through once the stamina arrived');
});

test('stamina: you cannot jump or shove non-stop - a full bar gives a few moves, then you have to wait', () => {
  for (const Game of GAMES) {
    const g = make(Game, 2);
    const p = g.players.get('p1');
    place(p, 300, 288);
    place(g.players.get('p2'), 700, 288);
    // Mash both buttons for 4 seconds.
    let jumpPress = false;
    for (let i = 0; i < Math.round(4 / DT); i++) {
      jumpPress = !jumpPress;
      press(g, 'p1', { jump: jumpPress, shove: jumpPress });
      g.tick(DT);
    }
    const spent = p.jumps * STAMINA.jumpCost + p.shoves * STAMINA.shoveCost;
    const budget = STAMINA.max + STAMINA.regen * 4;
    assert.ok(spent <= budget + 1, `${Game.name}: spent ${spent} but only ${budget} was ever available`);
    assert.ok(p.jumps + p.shoves >= 4, `${Game.name}: you still get a decent number of moves (${p.jumps} jumps, ${p.shoves} shoves)`);
  }
});

test('shove reach: it is now 115 pixels (was 80) and still has a cone and a limit', () => {
  assert.equal(ArenaGame.TUNING.shoveRange, 115);
  for (const Game of GAMES) {
    const hit = (dist, fx = 1, fy = 0) => {
      const g = make(Game, 3);
      place(g.players.get('p1'), 300, 288, fx, fy);
      place(g.players.get('p2'), 300 + dist, 288);
      place(g.players.get('p3'), 300, 100);
      tap(g, 'p1', 'shove');
      return g.players.get('p2').hitsTaken;
    };
    assert.equal(hit(100), 1, `${Game.name}: 100 px is now in reach`);
    assert.equal(hit(112), 1, `${Game.name}: 112 px is in reach`);
    assert.equal(hit(125), 0, `${Game.name}: 125 px is still out of reach`);
    assert.equal(hit(100, -1, 0), 0, `${Game.name}: behind you is not hit`);
  }
});

test('stamina power-ups: Big Lungs gives a bigger bar, Second Wind refills faster', () => {
  assert.equal(powerups.getPowerup('lungs').mods.stamina, 1.4);
  assert.equal(powerups.getPowerup('wind').mods.regen, 1.5);
  for (const Game of GAMES) {
    const big = make(Game, 2, { p1: powerups.combine(['lungs']) });
    assert.equal(big.players.get('p1').staminaMax, STAMINA.max * 1.4, `${Game.name}: 140 capacity`);
    assert.equal(big.players.get('p1').stamina, STAMINA.max * 1.4, `${Game.name}: starts full`);
    assert.equal(big.players.get('p2').staminaMax, STAMINA.max, `${Game.name}: others are unchanged`);

    const rate = (mods) => {
      const g = make(Game, 2, mods);
      const p = g.players.get('p1');
      place(p, 300, 288);
      place(g.players.get('p2'), 700, 288);
      p.stamina = 0;
      p.staminaWait = 0;
      run(g, 1);
      return p.stamina;
    };
    const plain = rate({});
    const wind = rate({ p1: powerups.combine(['wind']) });
    assert.ok(Math.abs(wind / plain - 1.5) < 0.05, `${Game.name}: ${wind.toFixed(1)} vs ${plain.toFixed(1)}`);
  }
});

test('stamina power-ups: junk values are clamped, and the stamina boosts cannot be stacked past the two-slot limit', () => {
  const m = powerups.normalizeMods({ stamina: 100, regen: -5 });
  assert.equal(m.stamina, 1.6);
  assert.equal(m.regen, 0.5);
  const g = make(GoldGrab, 2, { p1: { stamina: 'lots', regen: NaN } });
  assert.equal(g.players.get('p1').staminaMax, STAMINA.max);
  // At most two can be carried, so the very best a player can reach is both stamina boosts:
  assert.equal(powerups.MAX_SLOTS, 2);
  const both = powerups.combine(['lungs', 'wind']);
  assert.ok(both.stamina <= 1.6 && both.regen <= 1.8);
});

test('stamina is in the snapshot (current and maximum) and the arena tells the client the prices', () => {
  for (const Game of GAMES) {
    const g = make(Game, 2, { p1: powerups.combine(['lungs']) });
    place(g.players.get('p1'), 300, 288);
    tap(g, 'p1', 'jump');
    const snap = g.snapshot();
    const mine = snap.ps.find((p) => p.id === 'p1');
    assert.equal(mine.sm, 140, `${Game.name}: max`);
    assert.ok(mine.sp < 140 && mine.sp > 0, `${Game.name}: current (${mine.sp})`);
    assert.equal(Game.arena.jumpCost, STAMINA.jumpCost);
    assert.equal(Game.arena.shoveCost, STAMINA.shoveCost);
  }
});

test('Prop Hunt: turning into a prop is free; only a real smack costs stamina', () => {
  const parts = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }];
  const g = new PropHunt(parts, 'classic', {});
  g.time = 20; // past the hiding countdown
  const hider = [...g.players.values()].find((p) => p.role === 'hider');
  const seeker = [...g.players.values()].find((p) => p.role === 'seeker');
  place(hider, 300, 288);
  place(seeker, 700, 400);
  hider.stamina = 0;
  hider.staminaWait = 5;
  tap(g, hider.id, 'shove');
  assert.equal(hider.disguised, true, 'a hider with an empty bar can still disguise');
  seeker.stamina = 0;
  seeker.staminaWait = 5;
  tap(g, seeker.id, 'shove');
  assert.equal(seeker.shoves, 0, 'a tired seeker cannot smack');
  seeker.stamina = STAMINA.shoveCost;
  seeker.shoveCd = 0;
  tap(g, seeker.id, 'shove');
  assert.equal(seeker.shoves, 1, 'a rested seeker can');
  assert.ok(seeker.stamina < 5, 'the smack cost stamina');
});
