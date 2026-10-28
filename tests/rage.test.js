'use strict';

// Tests for RAGE BAIT mode (server/rage.js and each game's RAGE table). Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const games = require('../server/games');
const { RAGE, rageVariant } = require('../server/rage');
const ArenaGame = require('../server/games/arenaBase');
const CrumbleFloor = require('../server/games/crumbleFloor');
const GoldGrab = require('../server/games/goldGrab');

const DT = 1 / 30;
function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function make(Game, rage, variant = 'classic', n = 2, seed = 1) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push({ id: `p${i + 1}`, name: `P${i + 1}` });
  const g = new Game(parts, variant, { rage, rng: rngOf(seed) });
  g.time = 0.5;
  return g;
}
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

test('rage: there is no stamina - you can jump and shove with an empty bar, and nothing is spent', () => {
  for (const Game of [GoldGrab, CrumbleFloor]) {
    for (const rage of [false, true]) {
      const g = make(Game, rage);
      const p = g.players.get('p1');
      place(p, 300, 288);
      place(g.players.get('p2'), 700, 288);
      p.stamina = 0;
      p.staminaWait = 5;
      tap(g, 'p1', 'jump');
      for (let i = 0; i < 90 && (p.z > 0 || p.shoveCd > 0); i++) g.tick(DT);
      tap(g, 'p1', 'shove');
      if (rage) {
        assert.equal(p.jumps, 1, `${Game.name}: rage jump works while "tired"`);
        assert.equal(p.shoves, 1, `${Game.name}: rage shove works while "tired"`);
        assert.equal(p.stamina, 0, `${Game.name}: nothing is spent or refilled`);
      } else {
        assert.equal(p.jumps, 0, `${Game.name}: normal mode still needs stamina`);
      }
    }
  }
});

// Shoves p2 once and reports how hard and how far it flew.
function shoveTest(Game, rage) {
  const g = make(Game, rage);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, 300, 288, 1, 0);
  place(b, 360, 288);
  g.setInput('p1', { mx: 0, my: 0, jump: false, shove: true });
  g.tick(DT);
  g.setInput('p1', { mx: 0, my: 0, jump: false, shove: false });
  const launch = Math.hypot(b.kx, b.ky);
  const stun = b.stun;
  const immune = b.immune;
  const start = b.x;
  for (let i = 0; i < 90; i++) g.tick(DT);
  return { launch, stun, immune, flew: b.x - start };
}

test('rage: shoves hit about three times as hard, stun longer, and can be repeated sooner (arena games and Crumble Floor)', () => {
  for (const Game of [GoldGrab, CrumbleFloor]) {
    const normal = shoveTest(Game, false);
    const rage = shoveTest(Game, true);
    assert.ok(rage.launch > normal.launch * 2.7, `${Game.GAME_ID}: launch ${rage.launch.toFixed(0)} vs ${normal.launch.toFixed(0)}`);
    assert.ok(rage.stun > normal.stun * 1.8, `${Game.GAME_ID}: stun`);
    assert.ok(rage.immune < normal.immune * 0.8 + 0.01, `${Game.GAME_ID}: immunity is shorter (${rage.immune} vs ${normal.immune})`);
    assert.ok(rage.flew > normal.flew * 2.5 || rage.flew > 150, `${Game.GAME_ID}: flies much further (${rage.flew.toFixed(0)} vs ${normal.flew.toFixed(0)})`);
  }
});

test('rage: the variant copy is harder but never changes the shared tables', () => {
  for (const [id, Game] of Object.entries(games.GAMES)) {
    for (const [vid, v] of Object.entries(Game.VARIANTS)) {
      const before = JSON.stringify(v);
      const r = rageVariant(v);
      assert.equal(JSON.stringify(v), before, `${id}/${vid}: original untouched`);
      assert.ok(r.shoveSpeed >= RAGE.shove && r.grip < (v.grip || 1) + 1e-9 && r.stun === RAGE.stun);
      if (v.crack !== undefined) assert.ok(r.crack < v.crack && r.interval < v.interval, 'Crumble tiles fall faster and waves come sooner');
    }
  }
  // playing a rage round, then a normal one: nothing leaks over
  make(GoldGrab, true).tick(DT);
  const again = shoveTest(GoldGrab, false);
  assert.ok(again.launch < 700);
});

test('rage: every game has a RAGE table, it only changes numbers that exist, and it really is harder', () => {
  for (const [id, Game] of Object.entries(games.GAMES)) {
    if (id === 'crumbleFloor') continue; // its harder floor is in rageVariant (checked above)
    assert.ok(Game.RAGE && Object.keys(Game.RAGE).length >= 2, `${id} has a RAGE table`);
    for (const key of Object.keys(Game.RAGE)) assert.ok(key in Game.TUNING, `${id}: RAGE.${key} is a real setting`);
  }
  const G = games.GAMES;
  assert.ok(G.hotPotato.RAGE.fuseStart < G.hotPotato.TUNING.fuseStart);
  assert.ok(G.meteorMayhem.RAGE.minEvery < G.meteorMayhem.TUNING.minEvery && G.meteorMayhem.RAGE.fuse < G.meteorMayhem.TUNING.fuse);
  assert.ok(G.colorCall.RAGE.callMin < G.colorCall.TUNING.callMin);
  assert.ok(G.jumpRope.RAGE.maxSpeed > G.jumpRope.TUNING.maxSpeed);
  assert.ok(G.digDash.RAGE.bombChance > G.digDash.TUNING.bombChance);
  assert.ok(G.moleStomp.RAGE.redChance > G.moleStomp.TUNING.redChance);
  assert.ok(G.hillHustle.RAGE.radius < G.hillHustle.TUNING.radius);
  assert.ok(G.goldGrab.RAGE.coinCap < G.goldGrab.TUNING.coinCap);
  assert.ok(G.crownChaos.RAGE.overheat < G.crownChaos.TUNING.overheat);
  assert.ok(G.lapDash.RAGE.hurdleGaps.length > G.lapDash.TUNING.hurdleGaps.length);
});

test('rage: the games really use the harder numbers', () => {
  const hp = make(games.GAMES.hotPotato, true);
  assert.equal(hp.cfg.fuseStart, games.GAMES.hotPotato.RAGE.fuseStart);
  assert.equal(make(games.GAMES.hotPotato, false).cfg.fuseStart, games.GAMES.hotPotato.TUNING.fuseStart);
  assert.equal(make(games.GAMES.hillHustle, true).cfg.radius, games.GAMES.hillHustle.RAGE.radius);
  assert.equal(make(games.GAMES.colorCall, true).cfg.callMin, games.GAMES.colorCall.RAGE.callMin);
  // Lap Dash: the game and the arena info the browser draws from agree about the extra hurdles
  const lap = make(games.GAMES.lapDash, true);
  const info = games.arenaFor({ game: 'lapDash', variant: 'classic' }, { rage: true });
  assert.equal(lap.track.hurdles.length, 6);
  assert.equal(info.track.hurdles.length, 6);
  assert.equal(games.arenaFor({ game: 'lapDash', variant: 'classic' }).track.hurdles.length, 3, 'normal mode is unchanged');
  // Crumble: the floor falls apart sooner
  const normal = make(CrumbleFloor, false);
  const rage = make(CrumbleFloor, true);
  assert.ok(rage.v.crack < normal.v.crack && rage.v.interval < normal.v.interval);
  assert.ok(rage.v.grip < normal.v.grip, 'and it is slippery');
});

test('rage: fuzz - every game and variant finishes with valid results in rage mode (1-8 players)', () => {
  let trial = 0;
  for (const [id, Game] of Object.entries(games.GAMES)) {
    for (const v of Object.keys(Game.VARIANTS)) {
      for (const n of [1, 3, 8]) {
        const g = make(Game, true, v, n, 400 + trial++);
        g.time = -3;
        const ids = [...g.players.keys()];
        let steps = 0;
        while (!g.isFinished() && steps++ < 30 * 100) {
          if (steps % 4 === 0) for (const pid of ids) g.setInput(pid, { mx: Math.random() * 2 - 1, my: Math.random() * 2 - 1, jump: Math.random() < 0.2, shove: Math.random() < 0.5 });
          g.tick(DT);
          const snap = g.snapshot();
          for (const p of snap.ps) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${id}/${v}: finite positions`);
          JSON.stringify(snap);
        }
        assert.ok(g.isFinished(), `${id}/${v}/${n}: finishes`);
        const rows = g.results();
        assert.equal(rows.length, n);
        assert.ok(rows.every((r) => r.place >= 1 && r.place <= n && Number.isFinite(r.points)), `${id}: valid rows`);
        assert.ok(rows.some((r) => r.place === 1));
        // nobody is ever out for good: everybody who stayed gets a place and points
        assert.ok(rows.every((r) => r.points >= 0));
      }
    }
  }
});

test('rage: still fair - the same numbers for every player in the room', () => {
  const g = make(GoldGrab, true, 'classic', 4);
  const first = g._moveInfo(g.players.get('p1'));
  for (const p of g.players.values()) assert.deepEqual(g._moveInfo(p), first);
  assert.ok(ArenaGame.walkable(g.players.get('p1').x, g.players.get('p1').y));
});
