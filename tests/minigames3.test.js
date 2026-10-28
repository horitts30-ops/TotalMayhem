'use strict';

// Tests for the six newest minigames: Paint Panic, Color Call, Jump Rope Jam,
// Lap Dash, Dig Dash and Mole Stomp. Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const games = require('../server/games');
const { STAMINA } = require('../server/stamina');
const PaintPanic = require('../server/games/paintPanic');
const ColorCall = require('../server/games/colorCall');
const JumpRope = require('../server/games/jumpRope');
const LapDash = require('../server/games/lapDash');
const DigDash = require('../server/games/digDash');
const MoleStomp = require('../server/games/moleStomp');
const ArenaGame = require('../server/games/arenaBase');

const DT = 1 / 30;
const NEW = { paintPanic: PaintPanic, colorCall: ColorCall, jumpRope: JumpRope, lapDash: LapDash, digDash: DigDash, moleStomp: MoleStomp };

// ------------------------------------------------------------------ helpers
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function make(Game, n = 2, variant = 'classic', seed = 1, live = true) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push({ id: `p${i + 1}`, name: `P${i + 1}` });
  const g = new Game(parts, variant, { rng: seeded(seed) });
  if (live) g.time = 0.5;
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
const eventsOf = (g, kind) => {
  const out = [];
  return { push: (e) => e.k === kind && out.push(e), out };
};
// Collects events over a run (the snapshot drains g.events, so we read them as we go).
function runCollect(g, s) {
  const all = [];
  for (let i = 0, n = Math.round(s / DT); i < n; i++) {
    g.tick(DT);
    all.push(...g.snapshot().ev);
  }
  return all;
}
const far = (g, ids) => ids.forEach((id, i) => place(g.players.get(id), 60 + i * 40, 288)); // park players out of the way

// =========================================================== all six: basics
test('the six new games are registered with descriptions, two variants, arena info and shared tuning', () => {
  for (const [id, Game] of Object.entries(NEW)) {
    assert.equal(games.GAMES[id], Game, `${id} is registered`);
    assert.ok(Object.keys(Game.VARIANTS).length >= 2, `${id}: two variants`);
    for (const v of Object.keys(Game.VARIANTS)) {
      const d = games.describeSlot({ game: id, variant: v });
      assert.equal(d.gameId, id);
      assert.ok(d.name && d.tagline && d.theme && d.category);
      assert.ok(d.instructions.length >= 3 && d.controls.length >= 3);
      const a = games.arenaFor({ game: id, variant: v });
      assert.ok(a.maxTime > 0 && a.scoreLabel && a.jumpCost === STAMINA.jumpCost && a.shoveCost === STAMINA.shoveCost, `${id}: arena info`);
    }
  }
});

test('fuzz: random rounds always finish with valid results and clean snapshots (every new game and variant, 1-8 players)', () => {
  let trial = 0;
  for (const [id, Game] of Object.entries(NEW)) {
    for (const v of Object.keys(Game.VARIANTS)) {
      for (const n of [1, 2, 4, 8]) {
        const g = make(Game, n, v, 900 + trial++, false);
        const ids = [...g.players.keys()];
        let steps = 0;
        while (!g.isFinished() && steps++ < 30 * 80) {
          if (steps % 5 === 0) {
            for (const pid of ids) {
              g.setInput(pid, { mx: Math.random() * 2 - 1, my: Math.random() * 2 - 1, jump: Math.random() < 0.25, shove: Math.random() < 0.3 });
            }
          }
          if (steps === 600 && n > 2) g.removePlayer(ids[ids.length - 1]); // somebody leaves mid-round
          g.tick(DT);
          const snap = g.snapshot();
          JSON.stringify(snap); // must be serialisable
          for (const p of snap.ps) {
            assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), `${id}: finite position`);
            assert.ok(p.sp >= 0 && p.sp <= p.sm, `${id}: stamina in range`);
          }
        }
        assert.ok(g.isFinished(), `${id}/${v}/${n}: finishes`);
        const rows = g.results();
        assert.equal(rows.length, n);
        assert.ok(rows.every((r) => r.place >= 1 && r.place <= n && Number.isFinite(r.points) && r.points >= 0), `${id}: valid rows`);
        assert.ok(rows.some((r) => r.place === 1), `${id}: somebody wins`);
        if (n > 2) assert.equal(rows.filter((r) => r.abandoned).length, 1, `${id}: the leaver is marked`);
      }
    }
  }
});

test('solo practice works in every new game (one player, a valid result)', () => {
  for (const [id, Game] of Object.entries(NEW)) {
    const g = make(Game, 1, 'classic', 3, false);
    let steps = 0;
    while (!g.isFinished() && steps++ < 30 * 80) g.tick(DT);
    assert.ok(g.isFinished(), id);
    assert.equal(g.results()[0].place, 1);
  }
});

// =========================================================== Paint Panic
test('Paint Panic: walking paints your tiles in your colour slot, and the snapshot shows them', () => {
  const g = make(PaintPanic, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(b, 700, 480);
  place(a, 200, 288);
  press(g, 'p1', { mx: 1 });
  run(g, 1.0);
  assert.ok(a.tiles >= 3, `painted ${a.tiles} tiles`);
  const snap = g.snapshot();
  assert.equal(snap.pt.length, 126);
  assert.equal([...snap.pt].filter((c) => c === '0').length, a.tiles);
  assert.deepEqual(snap.pi, ['p1', 'p2']);
  assert.equal(snap.ps.find((p) => p.id === 'p1').rs, a.tiles, 'the score chip is the tile count');
});

test('Paint Panic: you do not paint while flying; tiles outside the arena are never painted', () => {
  const g = make(PaintPanic, 2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 700, 480);
  place(a, 300, 288);
  a.z = 90;
  a.vz = 0;
  g.tick(DT);
  assert.equal(a.tiles, 0, 'flying paints nothing');
  place(a, 5, 5); // far corner: off the rounded arena
  g.tick(DT);
  assert.equal(a.tiles, 0, 'no paint outside the floor');
});

test('Paint Panic: walking over a rival\'s tile steals it', () => {
  const g = make(PaintPanic, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, 100, 100); // a's own start tile is somewhere harmless
  place(b, 300, 288);
  g.tick(DT);
  assert.equal(b.tiles, 1);
  const aBefore = a.tiles;
  place(b, 700, 480);
  place(a, 300, 288);
  g.tick(DT);
  assert.equal(a.tiles, aBefore + 1, 'a took the tile');
  assert.equal(b.tiles, 1, 'b lost one tile but painted a new one where it now stands');
  assert.equal(b.lost, 1, 'one tile was stolen from b');
});

test('Paint Panic: a shove that connects splats up to three tiles to the shover; no splat without a hit', () => {
  const g = make(PaintPanic, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, 300, 288, 1, 0);
  place(b, 360, 288);
  tap(g, 'p1', 'shove');
  const ev = g.snapshot().ev.filter((e) => e.k === 'splat');
  assert.equal(ev.length, 1);
  assert.ok(a.splats >= 2 && a.splats <= 3, `splatted ${a.splats} tiles`);
  assert.equal(ev[0].n, a.splats);
  const g2 = make(PaintPanic, 2);
  place(g2.players.get('p1'), 300, 288, 1, 0);
  place(g2.players.get('p2'), 700, 480);
  tap(g2, 'p1', 'shove'); // a miss
  assert.equal(g2.snapshot().ev.filter((e) => e.k === 'splat').length, 0);
});

test('Paint Panic: the player far behind gets a wide brush (two tiles at once)', () => {
  const g = make(PaintPanic, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(b, 700, 480);
  for (let i = 0; i < 12; i++) g._paint(b, 14 * 2 + i); // give b a big lead (tiles 28..39)
  b.x = 700;
  place(a, 230, 288, 1, 0); // x 230 is in column 3; 0.8 of a tile ahead is column 4
  g.tick(DT);
  assert.equal(a.tiles, 2, 'the tile under you AND the one ahead');
  const g2 = make(PaintPanic, 2);
  place(g2.players.get('p2'), 700, 480);
  place(g2.players.get('p1'), 230, 288, 1, 0);
  g2.tick(DT);
  assert.equal(g2.players.get('p1').tiles, 1, 'no lead, no extra brush');
});

test('Paint Panic: the most tiles wins and the results say how many', () => {
  const g = make(PaintPanic, 3);
  g._paint(g.players.get('p1'), 30);
  g._paint(g.players.get('p1'), 31);
  g._paint(g.players.get('p2'), 32);
  g.time = 61;
  g.tick(DT);
  const rows = g.results();
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.p1.place, 1);
  assert.equal(by.p2.place, 2);
  assert.equal(by.p3.place, 3);
  assert.equal(by.p1.detail, `${g.players.get('p1').tiles} tiles`);
  assert.match(by.p1.detail, /^\d+ tiles$/);
});

// =========================================================== Color Call
test('Color Call: a call starts, counts down, is judged, and the calls get faster', () => {
  const g = make(ColorCall, 2, 'classic', 5);
  far(g, ['p1', 'p2']);
  const calls = [];
  const checks = [];
  let lastPhase = g.phase;
  const phases = [lastPhase];
  for (let i = 0; i < 30 * 40; i++) {
    g.tick(DT);
    for (const e of g.snapshot().ev) if (e.k === 'call') calls.push(e);
    if (g.phase !== lastPhase) {
      phases.push(g.phase);
      lastPhase = g.phase;
    }
    if (g.phase === 'check') checks.push(g.round);
  }
  assert.ok(calls.length >= 5, `${calls.length} calls in 40 seconds`);
  assert.ok(calls[0].t > calls[calls.length - 1].t, 'later calls give less time');
  assert.ok(calls.every((c) => c.t >= ColorCall.TUNING.callMin - 0.1 && c.zones.length === 1 && c.bad.length === 0));
  assert.deepEqual(phases.slice(0, 5), ['rest', 'call', 'check', 'rest', 'call']);
});

test('Color Call: standing in the called zone scores; being elsewhere splats you (stun, no point, not out)', () => {
  const g = make(ColorCall, 2, 'classic', 8);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  while (g.phase !== 'call') g.tick(DT);
  const safe = g.safe[0];
  const spot = (z) => [z % 2 === 0 ? 200 : 700, z < 2 ? 100 : 480];
  place(a, ...spot(safe));
  place(b, ...spot((safe + 1) % 4));
  const evs = [];
  while (g.phase === 'call') {
    g.tick(DT);
    evs.push(...g.snapshot().ev);
  }
  assert.equal(a.safeRounds, 1);
  assert.equal(b.safeRounds, 0);
  assert.equal(b.missed, 1);
  assert.ok(b.stun > 0.5, 'splatted players are dizzy');
  assert.ok(evs.some((e) => e.k === 'safe' && e.id === 'p1') && evs.some((e) => e.k === 'miss' && e.id === 'p2'));
  assert.equal(b.state, 'alive', 'nobody is ever eliminated');
  assert.equal(g._scoreOf(a), 1);
});

test('Color Call: the "Anything But" version has two lava zones and two safe ones', () => {
  const g = make(ColorCall, 2, 'avoid', 11);
  far(g, ['p1', 'p2']);
  const calls = [];
  for (let i = 0; i < 30 * 25; i++) {
    g.tick(DT);
    for (const e of g.snapshot().ev) if (e.k === 'call') calls.push(e);
  }
  assert.ok(calls.length >= 3);
  for (const c of calls) {
    assert.equal(c.zones.length, 2);
    assert.equal(c.bad.length, 2);
    assert.deepEqual([...c.zones, ...c.bad].sort(), [0, 1, 2, 3], 'safe + lava = all four zones');
  }
});

test('Color Call: a last-second shove can push a rival out of the safe zone', () => {
  const g = make(ColorCall, 2, 'classic', 14);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  while (g.phase !== 'call') g.tick(DT);
  g.safe = [0]; // top-left is safe (x < 448, y < 288)
  g.target = 0;
  place(b, 430, 100); // just inside zone 0
  place(a, 330, 100, 1, 0);
  g.phaseLeft = 1.0;
  tap(g, 'p1', 'shove');
  run(g, 1.3);
  assert.equal(b.safeRounds, 0, 'knocked across the line: not safe');
  assert.equal(b.missed, 1);
  assert.ok(a.hitsDealt >= 1);
});

test('Color Call: zone numbers and the snapshot', () => {
  assert.equal(ColorCall.zoneAt(10, 10), 0);
  assert.equal(ColorCall.zoneAt(800, 10), 1);
  assert.equal(ColorCall.zoneAt(10, 500), 2);
  assert.equal(ColorCall.zoneAt(800, 500), 3);
  const g = make(ColorCall, 2);
  while (g.phase !== 'call') g.tick(DT);
  const snap = g.snapshot();
  assert.equal(snap.cc.ph, 'call');
  assert.ok(snap.cc.l > 0 && snap.cc.d >= ColorCall.TUNING.callMin && Array.isArray(snap.cc.z) && snap.cc.n === 1);
  assert.match(snap.hud, /Get to (RED|BLUE|GREEN|YELLOW)!/);
});

// =========================================================== Jump Rope Jam
test('Jump Rope: the sweep maths handles direction and wrapping around the circle', () => {
  const s = JumpRope.sweptOver;
  assert.equal(s(0, 0.2, 0.1), true);
  assert.equal(s(0, 0.2, 0.3), false);
  assert.equal(s(0, -0.2, -0.1), true);
  assert.equal(s(0, -0.2, 0.1), false);
  assert.equal(s(3.1, 0.2, -3.1), true, 'across the +-PI seam');
  assert.equal(s(-3.1, -0.2, 3.1), true, 'across the seam the other way');
  assert.equal(s(0, 0.2, 0), false, 'a rope already on top of you is not a new crossing');
});

test('Jump Rope: a grounded player is tangled (stun, knock, grace), once per pass, and scores nothing', () => {
  const g = make(JumpRope, 2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 450, 288); // at the hub: out of the way
  g.angle = -0.1;
  place(a, 448 + 200, 288); // due "east" of the middle
  const ev = runCollect(g, 0.4);
  assert.equal(a.tangles, 1);
  assert.equal(a.clears, 0);
  assert.ok(a.stun > 0 || a.grace > 0);
  assert.equal(ev.filter((e) => e.k === 'tangle' && e.id === 'p1').length, 1);
  assert.ok(Math.hypot(a.kx, a.ky) > 50 || a.stun > 0, 'knocked along');
});

test('Jump Rope: being in the air when it passes is a clear (+1), and the far end of the rope counts too', () => {
  const g = make(JumpRope, 2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 450, 288);
  g.angle = -0.1;
  place(a, 448 - 200, 288); // due "west": the OTHER end of the rope comes by
  a.z = 70;
  a.vz = 0;
  const ev = runCollect(g, 0.15);
  assert.equal(a.clears, 1);
  assert.equal(a.tangles, 0);
  assert.equal(ev.filter((e) => e.k === 'clear').length, 1);
});

test('Jump Rope: the hub is safe, and it speeds up but never past the maximum', () => {
  const g = make(JumpRope, 2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 700, 480);
  place(a, 448 + 10, 288);
  g.angle = -0.05;
  run(g, 6);
  assert.equal(a.tangles, 0, 'standing in the hub is safe');
  assert.ok(a.hubTime > 5);
  const w0 = g._speed();
  g.time = 50;
  assert.ok(g._speed() > w0);
  g.time = 500;
  assert.equal(g._speed(), JumpRope.TUNING.maxSpeed);
});

test('Jump Rope: too tired to jump means you cannot clear it', () => {
  const g = make(JumpRope, 2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 450, 288);
  g.angle = -0.4;
  place(a, 448 + 200, 288);
  a.stamina = 0;
  a.staminaWait = 10;
  press(g, 'p1', { jump: true });
  run(g, 0.7);
  assert.equal(a.jumps, 0);
  assert.equal(a.tangles, 1, 'caught: you could not jump');
});

test('Jump Rope: the Wild Rope warns, then reverses, and the angle stays continuous', () => {
  const g = make(JumpRope, 1, 'wild', 2);
  place(g.players.get('p1'), 448, 288);
  g.time = 0;
  const warn = [];
  const flip = [];
  let prev = g.angle;
  let maxJump = 0;
  let signChange = false;
  for (let i = 0; i < 30 * 24; i++) {
    g.tick(DT);
    for (const e of g.snapshot().ev) {
      if (e.k === 'flipWarn') warn.push(g.time);
      if (e.k === 'flip') flip.push(g.time);
    }
    let d = g.angle - prev;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    maxJump = Math.max(maxJump, Math.abs(d));
    if (d < 0) signChange = true;
    prev = g.angle;
  }
  assert.ok(flip.length >= 1 && warn.length >= 1, 'it reversed at least once');
  assert.ok(warn[0] < flip[0], 'the warning comes first');
  assert.ok(signChange, 'the rope really turned the other way');
  assert.ok(maxJump < 0.2, `no teleporting (max step ${maxJump.toFixed(3)} rad)`);
});

test('Jump Rope: the most clears wins; fewer tangles breaks a tie', () => {
  const g = make(JumpRope, 3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  a.clears = 5;
  b.clears = 5;
  b.tangles = 2;
  c.clears = 2;
  g.time = 61;
  g.tick(DT);
  const by = Object.fromEntries(g.results().map((r) => [r.id, r]));
  assert.equal(by.p1.place, 1);
  assert.equal(by.p2.place, 2);
  assert.equal(by.p3.place, 3);
});

// =========================================================== Lap Dash
test('Lap Dash: the track has 6 gates, hurdles that depend on the variant, and everything is on the floor', () => {
  for (const [variant, hurdles] of [['classic', 3], ['gauntlet', 6]]) {
    const tr = games.arenaFor({ game: 'lapDash', variant }).track;
    assert.equal(tr.gates.length, 6);
    assert.equal(tr.hurdles.length, hurdles, `${variant} hurdles`);
    for (const g of tr.gates) assert.ok(ArenaGame.walkable(g.x, g.y), 'gate on the floor');
    for (const h of tr.hurdles) {
      assert.ok(ArenaGame.walkable(h.x, h.y), 'hurdle on the floor');
      assert.ok(Math.abs(Math.hypot(h.tx, h.ty) - 1) < 0.01, 'unit direction');
    }
  }
  const g = make(LapDash, 8);
  for (const p of g.players.values()) assert.ok(ArenaGame.walkable(p.x, p.y), 'start position on the floor');
});

test('Lap Dash: gates count only in order', () => {
  const g = make(LapDash, 2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 60, 288);
  const gates = g.track.gates;
  place(a, gates[2].x, gates[2].y); // the THIRD gate first: does not count
  g.tick(DT);
  assert.equal(a.gates, 0);
  place(a, gates[0].x, gates[0].y);
  g.tick(DT);
  assert.equal(a.gates, 1);
  place(a, gates[0].x, gates[0].y);
  g.tick(DT);
  assert.equal(a.gates, 1, 'the same gate twice does not count twice');
  place(a, gates[1].x, gates[1].y);
  const ev = runCollect(g, 0.1);
  assert.equal(a.gates, 2);
  assert.ok(ev.some((e) => e.k === 'gate' && e.n === 2));
  assert.equal(a.lastGateAt > 0, true);
  // a full lap is flagged
  for (let k = 2; k < 6; k++) {
    place(a, gates[k].x, gates[k].y);
    g.tick(DT);
  }
  assert.equal(a.gates, 6);
  assert.ok(g.snapshot().ev.some((e) => e.k === 'gate' && e.lap === 1));
  place(a, gates[0].x, gates[0].y);
  g.tick(DT);
  assert.equal(a.gates, 7, 'the second lap starts counting');
});

test('Lap Dash: a hurdle trips a runner on the ground, but not one who jumps it (and only once)', () => {
  const g = make(LapDash, 3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  const h = g.track.hurdles[0];
  place(c, 60, 288);
  place(a, h.x, h.y);
  g.tick(DT);
  assert.equal(a.trips, 1);
  assert.ok(a.stun > 0.4);
  g.tick(DT);
  g.tick(DT);
  assert.equal(a.trips, 1, 'the grace period stops a double trip');
  place(b, h.x, h.y);
  b.z = 45;
  b.vz = 0;
  g.tick(DT);
  assert.equal(b.trips, 0, 'airborne: hopped it');
  // a runner far to the side of the bar goes around it
  place(c, h.x - h.ty * 0 + (-h.ty) * 150, h.y + h.tx * 150);
  g.tick(DT);
  assert.equal(c.trips, 0, 'running around the end is allowed');
});

test('Lap Dash: the rubber band - the further behind the leader, the faster you run', () => {
  const g = make(LapDash, 3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  a.gates = 9;
  b.gates = 5;
  c.gates = 0;
  g.tick(DT);
  assert.equal(a.speedMul, 1);
  assert.equal(b.speedMul, LapDash.TUNING.boost1);
  assert.equal(c.speedMul, LapDash.TUNING.boost2);
});

test('Lap Dash: more gates wins; the earlier arrival wins a tie; results mention laps', () => {
  const g = make(LapDash, 3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  a.gates = 13;
  a.lastGateAt = 50;
  b.gates = 13;
  b.lastGateAt = 40;
  c.gates = 4;
  g.time = 61;
  g.tick(DT);
  const by = Object.fromEntries(g.results().map((r) => [r.id, r]));
  assert.equal(by.p2.place, 1, 'same gates, but reached first');
  assert.equal(by.p1.place, 2);
  assert.equal(by.p3.place, 3);
  assert.match(by.p2.detail, /13 gates \(2 laps\)/);
});

// =========================================================== Dig Dash
test('Dig Dash: X marks appear on the floor, spaced apart, up to a maximum, and replace dug ones', () => {
  const g = make(DigDash, 2);
  far(g, ['p1', 'p2']);
  g.tick(DT);
  assert.equal(g.spots.length, DigDash.TUNING.startSpots);
  for (const s of g.spots) assert.ok(ArenaGame.walkable(s.x, s.y));
  for (let i = 0; i < g.spots.length; i++) {
    for (let j = i + 1; j < g.spots.length; j++) assert.ok(Math.hypot(g.spots[i].x - g.spots[j].x, g.spots[i].y - g.spots[j].y) >= DigDash.TUNING.minSpotGap);
  }
  run(g, 20);
  assert.ok(g.spots.length <= DigDash.TUNING.maxSpots);
  assert.equal(g.spots.length, DigDash.TUNING.maxSpots, 'they keep coming back up to the maximum');
});

test('Dig Dash: standing still on an X digs it; the treasure is paid out and the X is gone', () => {
  const g = make(DigDash, 2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 60, 288);
  g.tick(DT);
  const spot = g.spots[0];
  spot.bomb = false;
  spot.value = 3;
  place(a, spot.x, spot.y);
  const ev = runCollect(g, DigDash.TUNING.digTime + 0.3);
  assert.equal(a.points, 3);
  assert.equal(a.digs, 1);
  assert.ok(!g.spots.some((s) => s.id === spot.id));
  assert.deepEqual(ev.filter((e) => e.k === 'dug').map((e) => e.v), [3]);
});

test('Dig Dash: running over an X does not dig it, and the progress shows in the snapshot', () => {
  const g = make(DigDash, 2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 60, 288);
  g.tick(DT);
  const spot = g.spots[0];
  place(a, spot.x - 150, spot.y);
  a.vx = 235;
  press(g, 'p1', { mx: 1 });
  run(g, 0.3);
  assert.equal(a.dugT, 0, 'moving fast: no digging');
  press(g, 'p1', {});
  place(a, spot.x, spot.y);
  run(g, 0.5);
  const snap = g.snapshot();
  const mine = snap.ps.find((p) => p.id === 'p1');
  assert.ok(mine.dp > 0.2 && mine.dp < 1, `progress ${mine.dp}`);
});

test('Dig Dash: a bomb costs the digger up to 2 points and stuns everybody close to it, nobody far away', () => {
  const g = make(DigDash, 3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  g.tick(DT);
  const spot = g.spots[0];
  spot.bomb = true;
  spot.value = 0;
  a.points = 5;
  place(a, spot.x, spot.y);
  place(b, spot.x + 60, spot.y);
  place(c, 40, 40);
  c.x = spot.x < 400 ? 800 : 100;
  c.y = spot.y < 288 ? 500 : 80; // far from the blast
  c.stun = 0;
  const ev = runCollect(g, DigDash.TUNING.digTime + 0.3);
  assert.equal(a.points, 3, 'lost 2');
  assert.ok(b.stun > 0 || Math.hypot(b.kx, b.ky) > 100, 'the bystander was blasted');
  assert.equal(c.stun, 0, 'a faraway player is fine');
  assert.ok(ev.some((e) => e.k === 'dugBomb'));
  a.points = 1;
  const spot2 = g.spots[0];
  spot2.bomb = true;
  a.stun = 0;
  place(b, 60, 288);
  place(c, 60, 480);
  place(a, spot2.x, spot2.y);
  run(g, DigDash.TUNING.digTime + 0.3);
  assert.equal(a.points, 0, 'points never go below zero');
});

test('Dig Dash: two diggers on one X - the first to finish gets it, the other starts over', () => {
  const g = make(DigDash, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  g.tick(DT);
  const spot = g.spots[0];
  spot.bomb = false;
  spot.value = 2;
  place(a, spot.x, spot.y);
  run(g, 0.6); // a is halfway
  place(b, spot.x + 10, spot.y);
  run(g, DigDash.TUNING.digTime);
  assert.equal(a.points, 2, 'a finished first');
  assert.equal(b.points, 0);
  assert.equal(b.dugT, 0, 'b has to start over on the next X');
});

test('Dig Dash: a shove fills the hole back in', () => {
  const g = make(DigDash, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  g.tick(DT);
  const spot = g.spots[0];
  place(b, spot.x, spot.y);
  run(g, 0.6);
  assert.ok(b.dugT > 0.4);
  place(a, spot.x - 60, spot.y, 1, 0);
  b.x = spot.x;
  b.y = spot.y;
  tap(g, 'p1', 'shove');
  assert.equal(b.dugT, 0, 'progress lost');
  assert.ok(b.interrupted >= 1);
});

test('Dig Dash: what is buried stays secret - the snapshot only has positions', () => {
  const g = make(DigDash, 2);
  g.tick(DT);
  const snap = g.snapshot();
  const text = JSON.stringify(snap);
  assert.ok(snap.ds.length > 0);
  for (const row of snap.ds) assert.equal(row.length, 3, '[id, x, y] only');
  assert.ok(!/bomb|value/i.test(text), 'no mention of what is underground');
  // ...and even a viewer-specific copy is the same
  const views = [...g.snapshotsByViewer(['p1', 'p2']).values()];
  for (const v of views) assert.ok(!/bomb|value/i.test(JSON.stringify(v)));
});

// =========================================================== Mole Stomp
test('Mole Stomp: a mound rumbles first, then the mole pops up, then it leaves again', () => {
  const g = make(MoleStomp, 1);
  place(g.players.get('p1'), 60, 288);
  let states = [];
  for (let i = 0; i < 30 * 4; i++) {
    g.tick(DT);
    const snap = g.snapshot();
    if (snap.mo.length) states.push(snap.mo[0][2]);
  }
  assert.equal(states[0], 0, 'rumbling first');
  assert.ok(states.includes(1), 'then up');
  const first = states.indexOf(1);
  assert.ok(states.slice(0, first).every((s) => s === 0));
  assert.ok(g.moles.length <= MoleStomp.TUNING.maxActive);
  // at no time are two moles in one burrow
  const g2 = make(MoleStomp, 2, 'frenzy', 4);
  far(g2, ['p1', 'p2']);
  for (let i = 0; i < 30 * 30; i++) {
    g2.tick(DT);
    const b = g2.moles.map((m) => m.b);
    assert.equal(new Set(b).size, b.length, 'one mole per burrow');
    assert.ok(b.length <= MoleStomp.VARIANTS.frenzy.maxActive);
  }
});

function moleAt(g, kind = 'mole', burrow = 4, age = 0.7) {
  g.moles = [{ id: 99, b: burrow, kind, born: g.time - age, life: 1.3 }];
}

test('Mole Stomp: landing on a risen mole scores it; walking over it does not; a rumbling one cannot be stomped', () => {
  const [bx, by] = MoleStomp.BURROWS[4];
  // landing
  let g = make(MoleStomp, 2);
  g.nextSpawn = 999;
  moleAt(g);
  place(g.players.get('p2'), 60, 288);
  let a = g.players.get('p1');
  place(a, bx, by);
  a.z = 24;
  a.vz = -200;
  let ev = runCollect(g, 0.1);
  assert.equal(a.points, 1);
  assert.equal(g.moles.length, 0, 'the mole is squashed');
  assert.ok(ev.some((e) => e.k === 'stomp' && e.id === 'p1' && e.v === 1));
  // walking
  g = make(MoleStomp, 2);
  g.nextSpawn = 999;
  moleAt(g);
  place(g.players.get('p2'), 60, 288);
  a = g.players.get('p1');
  place(a, bx - 100, by);
  press(g, 'p1', { mx: 1 });
  run(g, 1.0);
  assert.equal(a.points, 0, 'you have to JUMP on them');
  // rumbling
  g = make(MoleStomp, 2);
  g.nextSpawn = 999;
  moleAt(g, 'mole', 4, 0.2);
  place(g.players.get('p2'), 60, 288);
  a = g.players.get('p1');
  place(a, bx, by);
  a.z = 24;
  a.vz = -200;
  g.tick(DT);
  assert.equal(a.points, 0, 'still rumbling');
});

test('Mole Stomp: a real jump and landing (with stamina) stomps; red moles bite and gold moles pay 3', () => {
  const [bx, by] = MoleStomp.BURROWS[4];
  const g = make(MoleStomp, 2);
  g.nextSpawn = 999;
  moleAt(g);
  place(g.players.get('p2'), 60, 288);
  const a = g.players.get('p1');
  place(a, bx, by);
  tap(g, 'p1', 'jump');
  assert.equal(a.jumps, 1);
  const stam = a.stamina;
  assert.ok(stam < a.staminaMax, 'the jump cost stamina');
  moleAt(g); // refresh so it stays risen while we land
  run(g, 0.9);
  assert.equal(a.points, 1, 'landed on it');

  const g2 = make(MoleStomp, 2);
  g2.nextSpawn = 999;
  moleAt(g2, 'red');
  place(g2.players.get('p2'), 60, 288);
  const r = g2.players.get('p1');
  r.points = 1;
  place(r, bx, by);
  r.z = 20;
  r.vz = -200;
  const ev = runCollect(g2, 0.1);
  assert.equal(r.points, 0, 'bitten: -2 but never below zero');
  assert.ok(r.stun > 0);
  assert.ok(ev.some((e) => e.k === 'bite'));

  const g3 = make(MoleStomp, 2);
  g3.nextSpawn = 999;
  moleAt(g3, 'gold');
  place(g3.players.get('p2'), 60, 288);
  const gd = g3.players.get('p1');
  place(gd, bx, by);
  gd.z = 20;
  gd.vz = -200;
  runCollect(g3, 0.1);
  assert.equal(gd.points, 3);
  assert.equal(gd.golds, 1);
});

test('Mole Stomp: when two jump on the same mole, the closer one gets it', () => {
  const [bx, by] = MoleStomp.BURROWS[4];
  const g = make(MoleStomp, 2);
  g.nextSpawn = 999;
  moleAt(g);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, bx + 30, by);
  place(b, bx + 5, by);
  for (const p of [a, b]) {
    p.z = 20;
    p.vz = -200;
  }
  g.tick(DT);
  assert.equal(b.points, 1);
  assert.equal(a.points, 0);
});

test('Mole Stomp: the gold mole pops up at the free burrow nearest to whoever is losing', () => {
  const g = make(MoleStomp, 2, 'classic', 6);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  a.points = 0;
  b.points = 6;
  place(a, 672, 432); // bottom-right
  place(b, 224, 144);
  g.nextGold = 0; // the next mole is the gold one
  g.nextSpawn = 0;
  g.tick(DT);
  const gold = g.moles.find((m) => m.kind === 'gold');
  assert.ok(gold, 'a gold mole appeared');
  assert.equal(gold.b, 8, 'burrow 8 is bottom-right, next to the loser');
});

test('Mole Stomp: the burrows are all on the floor and the arena info lists them', () => {
  for (const [x, y] of MoleStomp.BURROWS) assert.ok(ArenaGame.walkable(x, y));
  assert.equal(MoleStomp.arena.burrows.length, 9);
});

// =========================================================== the room and the network
test('every new game can run inside a real Room (intro, play, results) without errors', async () => {
  const { Room } = require('../server/room');
  const cfgBase = require('../server/config');
  for (const id of Object.keys(NEW)) {
    const sent = [];
    const sink = { emit: (ev, data) => sent.push([ev, data]) };
    const io = { to: () => ({ ...sink, volatile: sink }) };
    const room = new Room(io, 'TEST', { ...cfgBase, INTRO_MS: 10, PITSTOP_MS: 0, SCHEDULE_OVERRIDE: [{ game: id, variant: 'classic' }], ROUND_END_DELAY_MS: 10 }, { timeScale: 40 });
    const p1 = room.addPlayer({ name: 'A' });
    room.addPlayer({ name: 'B' });
    room.rounds = 1;
    assert.equal(room.startMatch(p1.id), null);
    const start = Date.now();
    while (room.phase !== 'results' && room.phase !== 'final' && Date.now() - start < 8000) {
      room.updatePhases(Date.now());
      room.step(1 / 30);
      room.flushSnapshot();
      await new Promise((r) => setImmediate(r));
    }
    assert.ok(['results', 'final'].includes(room.phase), `${id}: reached the results (now ${room.phase})`);
    assert.equal(room.game ? room.game.constructor.GAME_ID : id, id);
    const state = room.publicState();
    JSON.stringify(state);
  }
});

test('Mole Stomp: you can SHOVE a risen mole to whack it (gold pays 3, red bites), but not a rumbling one or one out of reach', () => {
  const [bx, by] = MoleStomp.BURROWS[4];
  const setup = (kind, age, dx = -60) => {
    const g = make(MoleStomp, 2);
    g.nextSpawn = 999;
    moleAt(g, kind, 4, age);
    place(g.players.get('p2'), 60, 100);
    const a = g.players.get('p1');
    place(a, bx + dx, by, dx < 0 ? 1 : -1, 0);
    return { g, a };
  };
  let { g, a } = setup('mole', 0.7);
  tap(g, 'p1', 'shove');
  assert.equal(a.points, 1, 'a shove whacked the mole');
  assert.equal(g.moles.length, 0);
  assert.equal(a.jumps, 0, 'no jump needed');

  ({ g, a } = setup('gold', 0.7));
  tap(g, 'p1', 'shove');
  assert.equal(a.points, 3);
  assert.equal(a.golds, 1);

  ({ g, a } = setup('red', 0.7));
  a.points = 2;
  tap(g, 'p1', 'shove');
  assert.equal(a.points, 0, 'a red mole bites even when shoved');
  assert.ok(a.stun > 0);

  ({ g, a } = setup('mole', 0.2)); // still rumbling
  tap(g, 'p1', 'shove');
  assert.equal(a.points, 0);
  assert.equal(g.moles.length, 1);

  ({ g, a } = setup('mole', 0.7, -400)); // far away
  tap(g, 'p1', 'shove');
  assert.equal(a.points, 0);

  ({ g, a } = setup('mole', 0.7)); // facing the wrong way
  a.fx = -1;
  tap(g, 'p1', 'shove');
  assert.equal(a.points, 0, 'the mole is behind you');
});
