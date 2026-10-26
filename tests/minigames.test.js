'use strict';

// Rules tests for the open-arena minigames: Gold Grab, Hot Potato, Hill Hustle,
// the shared base class, and the match schedule. No network involved.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const games = require('../server/games');
const ArenaGame = require('../server/games/arenaBase');
const GoldGrab = require('../server/games/goldGrab');
const HotPotato = require('../server/games/hotPotato');
const HillHustle = require('../server/games/hillHustle');

const DT = 1 / 30;
const NEW_GAMES = { goldGrab: GoldGrab, hotPotato: HotPotato, hillHustle: HillHustle };

// A small repeatable random number generator, so tests do not flake.
function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(Game, n = 2, variant = 'classic', seed = 1) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push({ id: `p${i + 1}`, name: `Player ${i + 1}` });
  const g = new Game(parts, variant, { rng: seeded(seed) });
  g.time = 0.5; // skip the countdown
  return g;
}

function run(g, seconds) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) g.tick(DT);
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

// ------------------------------------------------------------------ all games
test('every new minigame has a description, arena info and at least two variants', () => {
  for (const [id, Game] of Object.entries(NEW_GAMES)) {
    assert.ok(Object.keys(Game.VARIANTS).length >= 2, `${id} variants`);
    for (const v of Object.keys(Game.VARIANTS)) {
      const d = Game.describe(v);
      assert.equal(d.gameId, id);
      assert.ok(d.name && d.tagline && d.theme && d.category);
      assert.ok(d.instructions.length >= 3 && d.controls.length >= 3);
    }
    const a = Game.arena;
    assert.ok(a.maxTime > 0 && a.shoveCooldown > 0 && a.scoreLabel);
    assert.ok(a.scoreDir === 'high' || a.scoreDir === 'low');
  }
});

test('full random rounds always finish with valid results (fuzz, every game and variant)', () => {
  let trial = 0;
  for (const [id, Game] of Object.entries(NEW_GAMES)) {
    for (const v of Object.keys(Game.VARIANTS)) {
      for (const n of [1, 2, 5, 8]) {
        const g = make(Game, n, v, 100 + trial++);
        g.time = -3; // include the countdown
        const ids = [...g.players.keys()];
        let steps = 0;
        while (!g.isFinished() && steps++ < 30 * 80) {
          if (steps % 5 === 0) {
            for (const pid of ids) {
              g.setInput(pid, { mx: Math.random() * 2 - 1, my: Math.random() * 2 - 1, jump: Math.random() < 0.25, shove: Math.random() < 0.3 });
            }
          }
          g.tick(DT);
          const s = g.snapshot();
          assert.equal(s.gid, id);
          for (const q of s.ps) {
            assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z), 'finite positions');
          }
          for (const p of g.players.values()) {
            assert.ok(ArenaGame.walkable(p.x, p.y), `${id}/${v}: player inside the arena (${p.x},${p.y})`);
          }
        }
        assert.ok(g.isFinished(), `${id}/${v} with ${n} players finished`);
        const rows = g.results();
        assert.equal(rows.length, n);
        assert.ok(rows.some((r) => r.place === 1));
        for (const r of rows) {
          assert.ok(Number.isInteger(r.points) && r.points >= 1 && r.points <= 10);
          assert.ok(r.place >= 1 && r.place <= n);
          assert.equal(typeof r.detail, 'string');
        }
      }
    }
  }
});

test('nothing happens during the 3-2-1 countdown (no moving, shoving or scoring)', () => {
  for (const Game of Object.values(NEW_GAMES)) {
    const g = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'classic', { rng: seeded(3) });
    const a = g.players.get('a');
    const x0 = a.x;
    press(g, 'a', { mx: 1, shove: true, jump: true });
    for (let i = 0; i < 60; i++) g.tick(DT); // 2 seconds, still counting down
    assert.ok(g.time < 0);
    assert.equal(a.x, x0, 'no movement before GO');
    assert.equal(a.shoves, 0);
    assert.equal(a.jumps, 0);
  }
});

test('players cannot leave the arena, even when running into the walls', () => {
  for (const Game of Object.values(NEW_GAMES)) {
    const g = make(Game, 2);
    for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      press(g, 'p1', { mx: dir[0], my: dir[1] });
      run(g, 5);
      const p = g.players.get('p1');
      assert.ok(ArenaGame.walkable(p.x, p.y), `${Game.GAME_ID} dir ${dir}: ${p.x},${p.y}`);
    }
  }
});

test('JUMP dodges a shove; a grounded player gets pushed', () => {
  const g = make(GoldGrab, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, 400, 288, 1, 0);
  place(b, 440, 288);
  b.z = 60; // in the air
  b.vz = 10;
  press(g, 'p1', { shove: true });
  g.tick(DT);
  assert.equal(b.hitsTaken, 0, 'airborne player was not hit');
  assert.equal(a.shoves, 1);

  const g2 = make(GoldGrab, 2);
  const [c, d] = [g2.players.get('p1'), g2.players.get('p2')];
  place(c, 400, 288, 1, 0);
  place(d, 440, 288);
  press(g2, 'p1', { shove: true });
  g2.tick(DT);
  assert.equal(d.hitsTaken, 1);
  assert.ok(d.kx > 100, 'pushed away');
});

test('shove has a cooldown and a victim is immune right after being shoved', () => {
  const g = make(HillHustle, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, 400, 288, 1, 0);
  place(b, 440, 288);
  press(g, 'p1', { shove: true });
  g.tick(DT);
  assert.equal(b.hitsTaken, 1);
  // press again immediately: cooldown blocks it
  press(g, 'p1', { shove: false });
  g.tick(DT);
  press(g, 'p1', { shove: true });
  place(b, 440, 288);
  g.tick(DT);
  assert.equal(a.shoves, 1, 'cooldown: the second shove did not happen yet');
  // after the cooldown (1.4 s) the victim's 1.0 s immunity is over too
  press(g, 'p1', { shove: false });
  run(g, 1.6);
  place(b, 440, 288);
  press(g, 'p1', { shove: true });
  g.tick(DT);
  assert.equal(a.shoves, 2);
  assert.equal(b.hitsTaken, 2);
});

test('hostile input is sanitized in the new games too', () => {
  const g = make(GoldGrab, 2);
  g.setInput('p1', { mx: NaN, my: Infinity, jump: 'yes', shove: {} });
  g.setInput('p1', null);
  g.setInput('p1', 'garbage');
  g.setInput('nobody', { mx: 1 });
  run(g, 1);
  const p = g.players.get('p1');
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.equal(p.jumps, 0);
});

test('a player who leaves mid-round earns nothing; the round still finishes', () => {
  for (const Game of Object.values(NEW_GAMES)) {
    const g = make(Game, 3);
    run(g, 3);
    g.removePlayer('p2');
    run(g, 70);
    assert.ok(g.isFinished());
    const rows = g.results();
    const left = rows.find((r) => r.id === 'p2');
    assert.equal(left.points, 0);
    assert.equal(left.abandoned, true);
    assert.equal(rows.find((r) => r.id === 'p1').points > 0, true);
  }
});

test('if everybody leaves, the round ends instead of hanging', () => {
  for (const Game of Object.values(NEW_GAMES)) {
    const g = make(Game, 2);
    run(g, 1);
    g.removePlayer('p1');
    g.removePlayer('p2');
    run(g, 0.5);
    assert.ok(g.isFinished());
  }
});

// ------------------------------------------------------------------ Gold Grab
test('Gold Grab: running over a coin collects it; jackpot coins are worth more', () => {
  const g = make(GoldGrab, 2);
  const a = g.players.get('p1');
  place(a, 300, 288);
  g.coins.push({ id: 900, x: 305, y: 288, v: 1, vx: 0, vy: 0, jackpot: false, dropped: false, lockId: null, lockUntil: 0, born: 0 });
  g.coins.push({ id: 901, x: 295, y: 292, v: 5, vx: 0, vy: 0, jackpot: true, dropped: false, lockId: null, lockUntil: 0, born: 0 });
  g.tick(DT);
  assert.equal(a.coins, 6);
  assert.equal(g.coins.find((c) => c.id === 900), undefined);
  const ev = g.snapshot().ev.filter((e) => e.k === 'coin');
  assert.equal(ev.length, 2);
  assert.ok(ev.some((e) => e.jackpot));
});

test('Gold Grab: you cannot grab coins while in the air', () => {
  const g = make(GoldGrab, 2);
  const a = g.players.get('p1');
  place(a, 300, 288);
  a.z = 80;
  a.vz = 5;
  g.coins.push({ id: 900, x: 300, y: 288, v: 1, vx: 0, vy: 0, jackpot: false, dropped: false, lockId: null, lockUntil: 0, born: 0 });
  g.tick(DT);
  assert.equal(a.coins, 0);
});

test('Gold Grab: a shove makes the victim drop at most 3 coins, which the attacker can grab', () => {
  const g = make(GoldGrab, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  b.coins = 10;
  place(a, 400, 288, 1, 0);
  place(b, 440, 288);
  g.nextSpawn = 1e9;
  g.nextJackpot = 1e9;
  press(g, 'p1', { shove: true });
  g.tick(DT);
  assert.equal(b.coins, 7, 'dropped exactly 3');
  assert.equal(b.coinsLost, 3);
  const drops = g.coins.filter((c) => c.dropped);
  assert.equal(drops.length, 3);
  assert.ok(drops.every((c) => c.lockId === 'p2'), 'the victim cannot instantly re-grab them');
  assert.ok(g.snapshot().ev.some((e) => e.k === 'drop' && e.n === 3));
});

test('Gold Grab: a victim with no coins loses nothing', () => {
  const g = make(GoldGrab, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, 400, 288, 1, 0);
  place(b, 440, 288);
  g.nextSpawn = 1e9;
  g.nextJackpot = 1e9;
  press(g, 'p1', { shove: true });
  g.tick(DT);
  assert.equal(g.coins.length, 0);
  assert.equal(b.coinsLost, 0);
});

test('Gold Grab: the victim cannot re-grab dropped coins straight away, but can after the lock', () => {
  const g = make(GoldGrab, 2);
  const b = g.players.get('p2');
  place(b, 300, 288);
  g.nextSpawn = 1e9;
  g.nextJackpot = 1e9;
  g.coins.push({ id: 900, x: 300, y: 288, v: 1, vx: 0, vy: 0, jackpot: false, dropped: true, lockId: 'p2', lockUntil: g.time + 1.2, born: g.time });
  g.tick(DT);
  assert.equal(b.coins, 0);
  run(g, 1.3);
  assert.equal(b.coins, 1);
});

test('Gold Grab: the number of ordinary coins on the floor is capped', () => {
  const g = make(GoldGrab, 1);
  g.players.get('p1').speedMul = 0;
  place(g.players.get('p1'), 40 + 64, 300);
  run(g, 40);
  const ordinary = g.coins.filter((c) => !c.jackpot && !c.dropped).length;
  assert.ok(ordinary <= GoldGrab.TUNING.coinCap, `ordinary coins: ${ordinary}`);
});

test('Gold Grab: the jackpot appears closer to whoever is in last place', () => {
  let nearLoser = 0;
  let nearLeader = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const g = make(GoldGrab, 2, 'classic', seed);
    const [leader, loser] = [g.players.get('p1'), g.players.get('p2')];
    leader.coins = 20;
    place(leader, 150, 288);
    place(loser, 750, 288);
    g.time = g.nextJackpot;
    g.tick(DT);
    const ev = g.snapshot().ev.find((e) => e.k === 'jackpot');
    assert.ok(ev, 'a jackpot spawned');
    nearLoser += Math.hypot(ev.x - loser.x, ev.y - loser.y);
    nearLeader += Math.hypot(ev.x - leader.x, ev.y - leader.y);
  }
  assert.ok(nearLoser < nearLeader * 0.75, `avg distance to last place ${(nearLoser / 40).toFixed(0)} vs leader ${(nearLeader / 40).toFixed(0)}`);
});

test('Gold Grab: when everybody is level the jackpot is simply random (no crash, valid spot)', () => {
  const g = make(GoldGrab, 3);
  g.time = g.nextJackpot;
  g.tick(DT);
  const ev = g.snapshot().ev.find((e) => e.k === 'jackpot');
  assert.ok(ev && ArenaGame.walkable(ev.x, ev.y));
});

test('Gold Grab: an ignored jackpot disappears after a while', () => {
  const g = make(GoldGrab, 1);
  place(g.players.get('p1'), 100, 150);
  g.nextSpawn = 1e9;
  g.nextJackpot = 1e9;
  g.coins.push({ id: 900, x: 800, y: 500, v: 5, vx: 0, vy: 0, jackpot: true, dropped: false, lockId: null, lockUntil: 0, born: g.time });
  run(g, GoldGrab.TUNING.jackpotLife - 1);
  assert.equal(g.coins.length, 1, 'still there');
  run(g, 2);
  assert.equal(g.coins.length, 0, 'gone');
  assert.ok(g.snapshot().ev.some((e) => e.k === 'jackpotGone'));
});

test('Gold Grab: most coins wins; equal coins share a place', () => {
  const g = make(GoldGrab, 3);
  g.players.get('p1').coins = 9;
  g.players.get('p2').coins = 9;
  g.players.get('p3').coins = 2;
  g._finish();
  const rows = g.results();
  const pl = (id) => rows.find((r) => r.id === id);
  assert.equal(pl('p1').place, 1);
  assert.equal(pl('p2').place, 1);
  assert.equal(pl('p3').place, 3);
  assert.equal(pl('p1').points, 10);
  assert.ok(pl('p3').points < pl('p1').points);
  assert.equal(pl('p1').detail, '9 coins');
});

// ------------------------------------------------------------------ Hot Potato
function withBomb(n = 3, seed = 1) {
  const g = make(HotPotato, n, 'classic', seed);
  g.time = 1.5;
  g.tick(DT); // first bomb is handed out
  return g;
}

test('Hot Potato: exactly one player holds the bomb, and the fuse burns down', () => {
  const g = withBomb(4);
  assert.ok(g.holderId);
  const f0 = g.fuse;
  run(g, 1);
  assert.ok(g.fuse < f0 - 0.5);
  const snap = g.snapshot();
  assert.equal(snap.ps.filter((p) => p.bm).length, 1);
  assert.equal(snap.bomb.id, g.holderId);
});

test('Hot Potato: the holder passes the bomb by shoving; the fuse keeps burning', () => {
  const g = withBomb(3);
  const holder = g.players.get(g.holderId);
  const victim = [...g.players.values()].find((p) => p !== holder);
  place(holder, 400, 288, 1, 0);
  place(victim, 440, 288);
  victim.passImmune = 0;
  const fuse = g.fuse;
  press(g, holder.id, { shove: true });
  g.tick(DT);
  assert.equal(g.holderId, victim.id);
  assert.equal(holder.passes, 1);
  assert.ok(Math.abs(g.fuse - fuse) < 0.1, 'fuse not reset by a pass');
  assert.ok(g.snapshot().ev.some((e) => e.k === 'bomb' && e.from === holder.id));
});

test('Hot Potato: a shove from a player WITHOUT the bomb does not move the bomb', () => {
  const g = withBomb(3);
  const holder = g.players.get(g.holderId);
  const [x, y] = [...g.players.values()].filter((p) => p !== holder);
  place(holder, 100, 150);
  place(x, 400, 288, 1, 0);
  place(y, 440, 288);
  press(g, x.id, { shove: true });
  g.tick(DT);
  assert.equal(g.holderId, holder.id);
  assert.equal(y.hitsTaken, 1, 'they were still shoved');
});

test('Hot Potato: the bomb cannot be handed straight back', () => {
  const g = withBomb(2);
  const first = g.players.get(g.holderId);
  const second = [...g.players.values()].find((p) => p !== first);
  place(first, 400, 288, 1, 0);
  place(second, 440, 288, -1, 0);
  second.passImmune = 0;
  press(g, first.id, { shove: true });
  g.tick(DT);
  assert.equal(g.holderId, second.id);
  // The new holder tries to pass it right back
  place(first, 400, 288);
  place(second, 440, 288, -1, 0);
  press(g, first.id, { shove: false });
  press(g, second.id, { shove: true });
  g.tick(DT);
  assert.equal(g.holderId, second.id, 'still holding: the target was protected');
  // ...after the protection (0.9 s) and the shove cooldown (1.4 s) are over, it works
  press(g, second.id, { shove: false });
  run(g, 1.6);
  place(first, 400, 288);
  place(second, 440, 288, -1, 0);
  press(g, second.id, { shove: true });
  g.tick(DT);
  assert.equal(g.holderId, first.id);
});

test('Hot Potato: JUMPING dodges the pass', () => {
  const g = withBomb(2);
  const holder = g.players.get(g.holderId);
  const other = [...g.players.values()].find((p) => p !== holder);
  place(holder, 400, 288, 1, 0);
  place(other, 440, 288);
  other.passImmune = 0;
  other.z = 70;
  other.vz = 5;
  press(g, holder.id, { shove: true });
  g.tick(DT);
  assert.equal(g.holderId, holder.id);
});

test('Hot Potato: BOOM gives the holder a strike, stuns them, shoves bystanders away, and a new bomb appears', () => {
  const g = withBomb(3);
  const holder = g.players.get(g.holderId);
  const near = [...g.players.values()].find((p) => p !== holder);
  place(holder, 400, 288);
  place(near, 460, 288);
  g.fuse = 0.01;
  g.tick(DT);
  assert.equal(holder.strikes, 1);
  assert.ok(holder.stun > 1);
  assert.ok(near.kx > 100, 'bystander was knocked back');
  assert.equal(g.holderId, null);
  assert.ok(g.snapshot().ev.some((e) => e.k === 'boom' && e.id === holder.id));
  run(g, 1.5);
  assert.ok(g.holderId, 'a new bomb was handed out');
  assert.notEqual(g.holderId, holder.id, 'not to the player who just blew up');
});

test('Hot Potato: the next bomb goes to someone with the FEWEST booms (fairness)', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const g = withBomb(3, seed);
    const holder = g.players.get(g.holderId);
    const others = [...g.players.values()].filter((p) => p !== holder);
    others[0].strikes = 2;
    others[1].strikes = 0;
    g.fuse = 0.01;
    g.tick(DT);
    run(g, 1.5);
    assert.equal(g.holderId, others[1].id, `seed ${seed}`);
  }
});

test('Hot Potato: solo practice keeps working (the bomb stays with you)', () => {
  const g = withBomb(1);
  const p = g.players.get('p1');
  g.fuse = 0.01;
  g.tick(DT);
  run(g, 1.5);
  assert.equal(p.strikes, 1);
  assert.equal(g.holderId, 'p1');
});

test('Hot Potato: if the holder leaves, the bomb moves to someone else', () => {
  const g = withBomb(3);
  const old = g.holderId;
  g.removePlayer(old);
  assert.ok(g.holderId && g.holderId !== old);
  assert.equal(g.players.get(g.holderId).state, 'alive');
});

test('Hot Potato: fewest booms wins; ties go to whoever held the bomb for less time', () => {
  const g = make(HotPotato, 3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  a.strikes = 1; a.holdTime = 5;
  b.strikes = 1; b.holdTime = 9;
  c.strikes = 3; c.holdTime = 1;
  g._finish();
  const rows = g.results();
  assert.deepEqual(rows.map((r) => r.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(rows.map((r) => r.place), [1, 2, 3]);
  assert.equal(rows[2].detail, '3 booms');
});

test('Hot Potato: nobody is ever eliminated - every player is still in the game at the end', () => {
  const g = make(HotPotato, 4, 'classic', 9);
  g.time = 0;
  for (let i = 0; i < 30 * 61; i++) {
    for (const p of g.players.values()) press(g, p.id, { mx: Math.sin(i / 20 + p.x), my: Math.cos(i / 25), shove: i % 17 === 0 });
    g.tick(DT);
  }
  assert.ok(g.isFinished());
  for (const p of g.players.values()) assert.equal(p.state, 'alive');
  assert.ok([...g.players.values()].reduce((n, p) => n + p.strikes, 0) >= 3, 'bombs did go off');
});

// ------------------------------------------------------------------ Hill Hustle
test('Hill Hustle: a lone player on the hill scores; being off it scores nothing', () => {
  const g = make(HillHustle, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, g.zone.x, g.zone.y);
  place(b, 100, 150);
  run(g, 2);
  assert.ok(a.hillTime > 1.8 && a.hillTime < 2.2, `hillTime ${a.hillTime}`);
  assert.equal(b.hillTime, 0);
  assert.equal(g.holderId, 'p1');
});

test('Hill Hustle: two players on the hill = contested, nobody scores', () => {
  const g = make(HillHustle, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, g.zone.x - 20, g.zone.y);
  place(b, g.zone.x + 20, g.zone.y);
  run(g, 0.5);
  place(a, g.zone.x - 20, g.zone.y);
  place(b, g.zone.x + 20, g.zone.y);
  g.tick(DT);
  assert.equal(a.hillTime, 0);
  assert.equal(b.hillTime, 0);
  assert.equal(g.snapshot().zone.ct, 1);
  assert.ok(g.contested);
});

test('Hill Hustle: a player in the air does not count as being on the hill', () => {
  const g = make(HillHustle, 1);
  const a = g.players.get('p1');
  place(a, g.zone.x, g.zone.y);
  a.z = 90;
  a.vz = 0.1;
  g.tick(DT);
  assert.equal(a.hillTime, 0);
});

test('Hill Hustle: the hill shows a warning, then hops to a new spot far from the old one', () => {
  const g = make(HillHustle, 1);
  g.players.get('p1').speedMul = 0;
  place(g.players.get('p1'), 40 + 64, 300);
  const start = { x: g.zone.x, y: g.zone.y };
  const every = g.cfg.moveEvery;
  g.time = every - 1.9;
  g.tick(DT);
  const warn = g.snapshot();
  assert.ok(warn.zone.next, 'warning is shown');
  assert.ok(warn.ev.some((e) => e.k === 'zoneWarn'));
  const target = { x: warn.zone.next.x, y: warn.zone.next.y };
  assert.ok(Math.hypot(target.x - start.x, target.y - start.y) >= HillHustle.TUNING.minHop - 1);
  run(g, 3.2);
  assert.ok(Math.hypot(g.zone.x - target.x, g.zone.y - target.y) < 1, 'arrived at the announced spot');
  assert.equal(g.snapshot().zone.next, null);
  assert.ok(ArenaGame.walkable(g.zone.x, g.zone.y), 'the hill is on the floor');
});

test('Hill Hustle: the hill always stays inside the arena over a whole round', () => {
  for (const v of Object.keys(HillHustle.VARIANTS)) {
    const g = make(HillHustle, 1, v, 5);
    g.time = 0;
    g.players.get('p1').speedMul = 0;
    for (let i = 0; i < 30 * 61; i++) {
      g.tick(DT);
      assert.ok(ArenaGame.walkable(g.zone.x, g.zone.y), `${v} t=${g.time.toFixed(1)}: ${g.zone.x},${g.zone.y}`);
    }
  }
});

test('Hill Hustle: a shove can push a rival off the hill, leaving you alone on it', () => {
  const g = make(HillHustle, 2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, g.zone.x - 30, g.zone.y, 1, 0);
  place(b, g.zone.x + 30, g.zone.y);
  press(g, 'p1', { shove: true });
  run(g, 1.2);
  assert.ok(Math.hypot(b.x - g.zone.x, b.y - g.zone.y) > HillHustle.TUNING.radius, 'b got pushed off');
  assert.ok(a.hillTime > 0.3, `a scored ${a.hillTime}`);
});

test('Hill Hustle: most hill time wins', () => {
  const g = make(HillHustle, 3);
  g.players.get('p1').hillTime = 12.3;
  g.players.get('p2').hillTime = 30;
  g.players.get('p3').hillTime = 0;
  g._finish();
  const rows = g.results();
  assert.deepEqual(rows.map((r) => r.id), ['p2', 'p1', 'p3']);
  assert.equal(rows[0].detail, '30.0s on the hill');
  assert.equal(rows[0].title, 'King of the Hill');
});

test('titles are not handed out for doing nothing (0 coins is not a Coin Goblin)', () => {
  const g = make(GoldGrab, 2);
  g._finish();
  assert.ok(g.results().every((r) => r.title === ''));
  const h = make(HillHustle, 2);
  h._finish();
  assert.ok(h.results().every((r) => r.title === ''));
});

// ------------------------------------------------------------------ the match schedule
test('the schedule uses every minigame before repeating and never plays the same one twice in a row', () => {
  const ids = Object.keys(games.GAMES);
  assert.ok(ids.length >= 4);
  for (let trial = 0; trial < 200; trial++) {
    const sched = games.buildSchedule(8, seeded(trial + 1));
    assert.equal(sched.length, 8);
    for (let i = 1; i < sched.length; i++) assert.notEqual(sched[i].game, sched[i - 1].game, `trial ${trial}`);
    assert.equal(new Set(sched.slice(0, ids.length).map((s) => s.game)).size, ids.length, 'first lap uses every game');
    for (const s of sched) assert.ok(games.GAMES[s.game].VARIANTS[s.variant], 'valid variant');
  }
});

test('round 1 always uses the normal version of its minigame; shorter matches work too', () => {
  for (let trial = 0; trial < 50; trial++) {
    const s = games.buildSchedule(1, seeded(trial + 7));
    assert.equal(s.length, 1);
    assert.equal(s[0].variant, Object.keys(games.GAMES[s[0].game].VARIANTS)[0]);
    assert.equal(games.buildSchedule(3, seeded(trial)).length, 3);
    assert.equal(games.buildSchedule(5, seeded(trial)).length, 5);
  }
});

test('different matches get different schedules', () => {
  const seen = new Set();
  for (let trial = 0; trial < 30; trial++) seen.add(games.buildSchedule(5, seeded(trial * 13 + 1)).map((s) => `${s.game}:${s.variant}`).join(','));
  assert.ok(seen.size > 10, `distinct schedules: ${seen.size}`);
});

test('the registry can build, describe and give arena info for every slot', () => {
  assert.ok(games.SCHEDULE_POOL.length >= 13);
  for (const slot of games.SCHEDULE_POOL) {
    const d = games.describeSlot(slot);
    assert.ok(d.name && d.gameId === slot.game);
    const arena = games.arenaFor(slot);
    assert.ok(arena.maxTime > 0 && arena.cols === 14);
    const g = games.createGame(slot, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], {});
    g.tick(DT);
    const s = g.snapshot();
    assert.equal(s.ps.length, 2);
    assert.ok(Array.isArray(s.ev));
  }
});
