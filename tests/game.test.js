'use strict';

// Tests for the Crumble Floor RULES (no network involved).
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const CrumbleFloor = require('../server/games/crumbleFloor');

const { TUNING, TILE, COLS, CONSTANTS } = CrumbleFloor;
const DT = 1 / 30;

function makeGame(n = 2, variant = 'classic') {
  const participants = [];
  for (let i = 0; i < n; i++) participants.push({ id: `p${i + 1}`, name: `Player ${i + 1}` });
  const g = new CrumbleFloor(participants, variant);
  // Skip the countdown and stop random crumbling so tests are predictable.
  g.time = 0.5;
  g.nextWaveAt = 1e9;
  return g;
}

function run(g, seconds) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) g.tick(DT);
}

function place(p, x, y, fx = 1, fy = 0) {
  p.x = x;
  p.y = y;
  p.fx = fx;
  p.fy = fy;
  p.vx = p.vy = p.kx = p.ky = 0;
}

// Make a gap in row 4 (the middle row), covering the given columns.
function digHole(g, row, cols) {
  for (const c of cols) g.kind[row * COLS + c] = CONSTANTS.GONE;
}

test('arena has a sensible number of tiles and rounded corners', () => {
  const g = makeGame(1);
  const solid = g.kind.filter((k) => k === CONSTANTS.SOLID).length;
  assert.ok(solid > 90 && solid < 126, `solid tiles: ${solid}`);
  assert.equal(g.kind[0], CONSTANTS.VOID, 'top-left corner should not exist');
});

test('players stand safely on solid floor', () => {
  const g = makeGame(2);
  run(g, 3);
  for (const p of g.players.values()) assert.equal(p.state, 'alive');
});

test('walking into a hole makes you fall and become a ghost', () => {
  const g = makeGame(2);
  const a = g.players.get('p1');
  digHole(g, 4, [6, 7]);
  place(a, 330, 4 * TILE + 32);
  g.setInput('p1', { mx: 1, my: 0, jump: false, shove: false });
  run(g, 1.2);
  assert.notEqual(a.state, 'alive', 'player should have fallen');
  run(g, 1.2);
  assert.equal(a.state, 'ghost');
});

test('JUMPING carries you over a 2-tile hole', () => {
  const g = makeGame(2);
  const a = g.players.get('p1');
  digHole(g, 4, [6, 7]); // hole from x=384 to x=512
  place(a, 300, 4 * TILE + 32);
  g.setInput('p1', { mx: 1, my: 0, jump: false, shove: false });
  // Run toward the hole until just before the edge, then jump.
  let guard = 0;
  while (a.x < 372 && guard++ < 200) g.tick(DT);
  g.setInput('p1', { mx: 1, my: 0, jump: true, shove: false });
  g.tick(DT);
  g.setInput('p1', { mx: 1, my: 0, jump: false, shove: false });
  assert.ok(a.z > 0, 'player should be in the air');
  run(g, 1.5);
  assert.equal(a.state, 'alive', 'player should have cleared the hole');
  assert.ok(a.x > 512, `landed past the hole (x=${a.x.toFixed(0)})`);
  assert.equal(a.jumps, 1);
});

test('without jumping, the same run falls into the hole (control test)', () => {
  const g = makeGame(2);
  const a = g.players.get('p1');
  digHole(g, 4, [6, 7]);
  place(a, 300, 4 * TILE + 32);
  g.setInput('p1', { mx: 1, my: 0, jump: false, shove: false });
  run(g, 2);
  assert.notEqual(a.state, 'alive');
});

test('a 3-tile hole is too wide to jump (jumps have a limit)', () => {
  const g = makeGame(2);
  const a = g.players.get('p1');
  digHole(g, 4, [5, 6, 7]); // x=320..512 = 192px wide
  place(a, 250, 4 * TILE + 32);
  g.setInput('p1', { mx: 1, my: 0, jump: false, shove: false });
  let guard = 0;
  while (a.x < 312 && guard++ < 200) g.tick(DT);
  g.setInput('p1', { mx: 1, my: 0, jump: true, shove: false });
  g.tick(DT);
  g.setInput('p1', { mx: 1, my: 0, jump: false, shove: false });
  run(g, 2);
  assert.notEqual(a.state, 'alive');
});

test('you cannot fall while airborne, even right above a hole', () => {
  const g = makeGame(2);
  const a = g.players.get('p1');
  digHole(g, 4, [6, 7]);
  place(a, 440, 4 * TILE + 32); // standing in the hole's area
  a.z = 40;
  a.vz = 100;
  run(g, 0.2);
  assert.equal(a.state, 'alive');
});

test('a jump pressed a hair early still counts (jump buffer)', () => {
  const g = makeGame(2);
  const a = g.players.get('p1');
  place(a, 200, 4 * TILE + 32);
  a.z = 5;
  a.vz = -200; // about to land
  g.setInput('p1', { mx: 0, my: 0, jump: true, shove: false });
  run(g, 0.2);
  assert.equal(a.jumps, 1, 'buffered jump should fire on landing');
});

test('shove pushes a rival, stuns them and gives temporary immunity', () => {
  const g = makeGame(3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  place(a, 400, 288, 1, 0);
  place(b, 450, 288);
  place(c, 450, 330, 0, -1); // also near b, from below
  g.setInput('p1', { mx: 0, my: 0, jump: false, shove: true });
  g.tick(DT);
  assert.ok(b.kx > 300, `b should be knocked right (kx=${b.kx})`);
  assert.ok(b.immune > 0);
  assert.ok(b.stun > 0);
  assert.equal(b.lastShovedBy, 'p1');
  const kxAfterFirst = b.kx;

  // A second player shoving b right now must NOT stack another push.
  g.setInput('p3', { mx: 0, my: 0, jump: false, shove: true });
  g.tick(DT);
  assert.equal(b.lastShovedBy, 'p1', 'immunity blocks a second shove');
  assert.ok(b.kx <= kxAfterFirst, 'knockback was not stacked');
});

test('shove has a cooldown', () => {
  const g = makeGame(2);
  const [a, b] = ['p1', 'p2'].map((id) => g.players.get(id));
  place(a, 400, 288, 1, 0);
  place(b, 700, 288); // far away, so every shove whiffs
  g.setInput('p1', { mx: 0, my: 0, jump: false, shove: true });
  g.tick(DT);
  assert.equal(a.shoves, 1);
  g.setInput('p1', { mx: 0, my: 0, jump: false, shove: false });
  g.tick(DT);
  g.setInput('p1', { mx: 0, my: 0, jump: false, shove: true });
  g.tick(DT);
  assert.equal(a.shoves, 1, 'second shove blocked by cooldown');
});

test('shove does nothing to someone behind you', () => {
  const g = makeGame(2);
  const [a, b] = ['p1', 'p2'].map((id) => g.players.get(id));
  place(a, 400, 288, 1, 0); // facing right
  place(b, 350, 288); // standing to the left
  g.setInput('p1', { mx: 0, my: 0, jump: false, shove: true });
  g.tick(DT);
  assert.equal(b.immune, 0);
});

test('shoving is disabled during the 3-2-1 countdown', () => {
  const g = makeGame(2);
  g.time = -2;
  const [a, b] = ['p1', 'p2'].map((id) => g.players.get(id));
  place(a, 400, 288, 1, 0);
  place(b, 450, 288);
  g.setInput('p1', { mx: 0, my: 0, jump: false, shove: true });
  g.tick(DT);
  assert.equal(b.immune, 0);
  assert.equal(a.shoves, 0);
});

test('shoving a rival off the edge awards a KO and bonus points', () => {
  const g = makeGame(2);
  const [a, b] = ['p1', 'p2'].map((id) => g.players.get(id));
  place(b, 40, 288);
  place(a, 100, 288, -1, 0); // facing the edge, with b in front
  g.setInput('p1', { mx: 0, my: 0, jump: false, shove: true });
  run(g, 1.5);
  assert.notEqual(b.state, 'alive');
  assert.equal(a.kos, 1);
  assert.ok(g.isFinished(), 'round ends when only one player is left');

  const results = g.results();
  const ra = results.find((r) => r.id === 'p1');
  const rb = results.find((r) => r.id === 'p2');
  assert.equal(ra.place, 1);
  assert.equal(rb.place, 2);
  assert.equal(ra.points, 10 + 2, 'winner: 10 for 1st + 2 for the KO');
  assert.equal(rb.points, 5);
});

test('KO credit expires after a few seconds', () => {
  const g = makeGame(2);
  const [a, b] = ['p1', 'p2'].map((id) => g.players.get(id));
  place(a, 700, 288);
  place(b, 500, 288);
  b.lastShovedBy = 'p1';
  b.lastShovedAt = g.time - 10;
  g.kind[4 * COLS + 7] = CONSTANTS.GONE; // b stands at x=500 -> col 7
  run(g, 1);
  assert.notEqual(b.state, 'alive');
  assert.equal(a.kos, 0);
});

test('eliminated players become ghosts that can drop goo puddles', () => {
  const g = makeGame(3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  place(a, 700, 200);
  place(c, 700, 400);
  place(b, 440, 288);
  g.kind[4 * COLS + 6] = CONSTANTS.GONE; // under b (x=440 -> col 6)
  run(g, 2); // b falls and becomes a ghost
  assert.equal(b.state, 'ghost');

  // Move the ghost to solid floor next to a, then drop goo.
  place(b, 640, 200);
  g.setInput('p2', { mx: 0, my: 0, jump: false, shove: true });
  g.tick(DT);
  assert.equal(g.puddles.length, 1);
  assert.equal(b.puddleAmmo, TUNING.puddleAmmo - 1);

  // The puddle is a harmless warning while it forms.
  place(a, 645, 205);
  g.tick(DT);
  assert.equal(a.slow, 0, 'no slowdown while the puddle is still forming');

  run(g, 0.9);
  assert.ok(a.slow > 0, 'standing in a formed puddle slows you');
  assert.equal(b.puddleHits, 1);

  // And you cannot be re-splatted immediately (anti-harassment).
  const slowAfterFirst = a.puddleImmune;
  assert.ok(slowAfterFirst > 0);
});

test('jumping over a puddle avoids it', () => {
  const g = makeGame(3);
  const [a, b] = ['p1', 'p2'].map((id) => g.players.get(id));
  b.state = 'ghost';
  place(b, 600, 288);
  g.puddles.push({ id: 99, owner: 'p2', x: 600, y: 288, age: 1 });
  place(a, 600, 288);
  a.z = 30;
  a.vz = 10;
  g.tick(DT);
  assert.equal(a.slow, 0);
});

test('puddles disappear when the floor under them falls', () => {
  const g = makeGame(2);
  g.puddles.push({ id: 1, owner: 'p2', x: 600, y: 288, age: 1 });
  g.kind[4 * COLS + 9] = CONSTANTS.GONE; // x=600 -> col 9
  g.tick(DT);
  assert.equal(g.puddles.length, 0);
});

test('on timeout, survivors tie for first place', () => {
  const g = makeGame(2);
  g.time = TUNING.maxTime - 0.02;
  g.tick(DT);
  assert.ok(g.isFinished());
  const results = g.results();
  assert.equal(results[0].place, 1);
  assert.equal(results[1].place, 1);
  assert.equal(results[0].points, 10);
  assert.equal(results[1].points, 10);
});

test('later elimination = better placement; points shrink with placement', () => {
  const g = makeGame(4);
  // Park everybody on safe floor in the top rows first.
  ['p1', 'p2', 'p3', 'p4'].forEach((id, i) => place(g.players.get(id), 120 + i * 80, 100));
  // Then drop p4, p3 and p2 through the floor one at a time (0.4s apart).
  for (const [id, col] of [['p4', 9], ['p3', 10], ['p2', 11]]) {
    place(g.players.get(id), col * TILE + 32, 288);
    g.kind[4 * COLS + col] = CONSTANTS.GONE;
    run(g, 0.4);
  }
  assert.ok(g.isFinished());
  const r = Object.fromEntries(g.results().map((x) => [x.id, x]));
  assert.equal(r.p1.place, 1);
  assert.equal(r.p2.place, 2);
  assert.equal(r.p3.place, 3);
  assert.equal(r.p4.place, 4);
  assert.ok(r.p1.points > r.p2.points && r.p2.points > r.p3.points && r.p3.points > r.p4.points);
});

test('a player who disconnects mid-round is removed and earns no points', () => {
  const g = makeGame(3);
  g.removePlayer('p2');
  run(g, 0.2);
  assert.equal(g.players.get('p2').state, 'left');
  run(g, 0.1);
  g.removePlayer('p3'); // now only p1 remains
  run(g, 0.1);
  assert.ok(g.isFinished());
  const r = Object.fromEntries(g.results().map((x) => [x.id, x]));
  assert.equal(r.p1.place, 1);
  assert.equal(r.p2.points, 0);
  assert.equal(r.p3.points, 0);
});

test('hostile input is sanitized (NaN, Infinity, huge numbers, wrong types)', () => {
  const g = makeGame(2);
  g.setInput('p1', { mx: NaN, my: Infinity, jump: 'yes', shove: 1 });
  const p = g.players.get('p1');
  assert.deepEqual(p.input, { mx: 0, my: 0, jump: false, shove: false });
  g.setInput('p1', { mx: 1e12, my: -1e12, jump: true, shove: false });
  assert.equal(p.input.mx, 1);
  assert.equal(p.input.my, -1);
  g.setInput('nobody', { mx: 1 });
  g.setInput('p1', null);
  g.setInput('p1', 'garbage');
  run(g, 1);
  const snap = g.snapshot();
  for (const q of snap.ps) {
    assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z));
  }
});

test('floor starts crumbling only after GO, then keeps crumbling', () => {
  const g = new CrumbleFloor([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
  const countBad = () => g.kind.filter((k) => k === CONSTANTS.CRACKING || k === CONSTANTS.GONE).length;
  // The idle players might fall by chance and end the round (which correctly
  // stops the crumbling). To test the crumble schedule itself, keep the round
  // "open" on every step.
  const runOpen = (seconds) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      g.finished = false;
      g._results = null;
      g.tick(DT);
    }
  };
  runOpen(3); // countdown
  runOpen(1.5);
  assert.equal(countBad(), 0, 'nothing cracks right at the start');
  runOpen(1);
  assert.ok(countBad() > 0, 'crumbling has begun');
  const early = countBad();
  runOpen(15);
  assert.ok(countBad() > early + 10, 'crumbling accelerates');
  runOpen(60);
  assert.equal(
    g.kind.filter((k) => k === CONSTANTS.SOLID).length,
    0,
    'the whole floor is gone well before the 75s limit'
  );
});

test('the round-ending rule: a lone player (practice) ends when they fall', () => {
  const g = makeGame(1);
  const a = g.players.get('p1');
  digHole(g, 4, [6]);
  place(a, 6 * TILE + 32, 4 * TILE + 32);
  run(g, 0.5);
  assert.ok(g.isFinished());
  assert.equal(g.results()[0].place, 1);
});

test('snapshot has the expected shape', () => {
  const g = makeGame(2);
  g.tick(DT);
  const s = g.snapshot();
  assert.equal(s.tiles.length, CrumbleFloor.COLS * CrumbleFloor.ROWS);
  assert.equal(s.ps.length, 2);
  assert.ok(Array.isArray(s.ev));
  assert.match(s.tiles, /^[0-9x_]+$/);
});

test('every variant can be described and played', () => {
  for (const v of Object.keys(CrumbleFloor.VARIANTS)) {
    const d = CrumbleFloor.describe(v);
    assert.ok(d.name && d.instructions.length > 0 && d.controls.length > 0);
    const g = new CrumbleFloor([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], v);
    run(g, 5);
    assert.ok(Number.isFinite(g.time));
  }
});

test('full random rounds always finish with valid results (fuzz)', () => {
  for (let trial = 0; trial < 21; trial++) {
    const n = 1 + (trial % 8);
    const ids = Object.keys(CrumbleFloor.VARIANTS);
    const variant = ids[trial % ids.length];
    const parts = [];
    for (let i = 0; i < n; i++) parts.push({ id: `b${i}`, name: `Bot ${i}` });
    const g = new CrumbleFloor(parts, variant);
    let steps = 0;
    while (!g.isFinished() && steps++ < 30 * 90) {
      if (steps % 6 === 0) {
        for (const p of parts) {
          g.setInput(p.id, {
            mx: Math.random() * 2 - 1,
            my: Math.random() * 2 - 1,
            jump: Math.random() < 0.3,
            shove: Math.random() < 0.3,
          });
        }
      }
      g.tick(DT);
      const s = g.snapshot();
      for (const q of s.ps) {
        assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z), 'finite positions');
      }
    }
    assert.ok(g.isFinished(), `round ended (trial ${trial}, ${n} players, ${variant})`);
    assert.ok(g.time <= TUNING.maxTime + 0.5);
    const results = g.results();
    assert.equal(results.length, n);
    assert.ok(results.some((r) => r.place === 1));
    for (const r of results) {
      assert.ok(r.points >= 0 && Number.isInteger(r.points));
      assert.ok(r.place >= 1 && r.place <= n);
    }
  }
});

test('there are at least 7 floors and each has a name, tagline and theme', () => {
  const ids = Object.keys(CrumbleFloor.VARIANTS);
  assert.ok(ids.length >= 7, `floors: ${ids.length}`);
  assert.equal(ids[0], 'classic', 'classic stays first');
  for (const id of ids) {
    const d = CrumbleFloor.describe(id);
    assert.ok(d.name && d.tagline && d.theme, id);
  }
});

test('Moonbase: floatier jump (longer in the air, further, still not absurdly high)', () => {
  const airtime = (variant) => {
    const g = makeGame(2, variant);
    const a = g.players.get('p1');
    place(a, 300, 4 * TILE + 32);
    g.setInput('p1', { mx: 0, my: 0, jump: true, shove: false });
    g.tick(DT);
    g.setInput('p1', { mx: 0, my: 0, jump: false, shove: false });
    let t = DT;
    let peak = 0;
    while (a.z > 0 && t < 3) {
      peak = Math.max(peak, a.z);
      g.tick(DT);
      t += DT;
    }
    return { t, peak };
  };
  const normal = airtime('classic');
  const moon = airtime('moon');
  assert.ok(moon.t > normal.t * 1.2, `moon ${moon.t.toFixed(2)}s vs normal ${normal.t.toFixed(2)}s`);
  assert.ok(moon.peak < 110, `moon peak ${moon.peak.toFixed(0)}px`);
});
