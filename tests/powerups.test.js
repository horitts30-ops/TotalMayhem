'use strict';

// Tests for power-ups: the catalogue and price rules, the pit-stop phase in a
// Room (using a fake network, so no sockets), and the effect each boost has in
// the games. Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const powerups = require('../server/powerups');
const { Room } = require('../server/room');
const cfgBase = require('../server/config');
const CrumbleFloor = require('../server/games/crumbleFloor');
const GoldGrab = require('../server/games/goldGrab');
const PropHunt = require('../server/games/propHunt');
const ArenaGame = require('../server/games/arenaBase');

const DT = 1 / 30;

// ------------------------------------------------------------------ helpers
function makeRoom(n = 3, over = {}) {
  const io = { to: () => ({ emit() {} }) };
  const room = new Room(io, 'TEST', { ...cfgBase, ...over }, {});
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(room.addPlayer({ name: `P${i + 1}` }).id);
  return { room, ids };
}
const inPitstop = (room) => {
  room.phase = 'pitstop';
  room.phaseEndsAt = Date.now() + 60000;
};

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

// -------------------------------------------------------------- catalogue
test('power-ups: every boost is small, has a price, and is listed for the browser', () => {
  assert.ok(powerups.POWERUPS.length >= 5);
  const ids = new Set();
  for (const p of powerups.POWERUPS) {
    assert.ok(!ids.has(p.id), 'unique ids');
    ids.add(p.id);
    assert.ok(p.name && p.desc && p.icon);
    assert.ok(Number.isInteger(p.price) && p.price >= 10 && p.price <= 40);
    for (const [k, v] of Object.entries(p.mods)) {
      assert.ok(k in powerups.NEUTRAL, `known boost ${k}`);
      assert.ok(v >= 0.6 && v <= 1.4, `${p.id}.${k} = ${v} stays modest (no more than 40% either way)`);
    }
  }
  const list = powerups.catalogue();
  assert.equal(list.length, powerups.POWERUPS.length);
  for (const c of list) assert.ok(c.underdogPrice < c.price, 'the comeback price is cheaper');
});

test('power-ups: at most two can be carried, and the comeback discount is 30%', () => {
  assert.equal(powerups.MAX_SLOTS, 2);
  const def = powerups.getPowerup('speed');
  assert.equal(powerups.priceFor(def, false), 20);
  assert.equal(powerups.priceFor(def, true), 14);
  assert.equal(powerups.getPowerup('nope'), null);
});

test('power-ups: combine() multiplies boosts, ignores unknown ids and repeats', () => {
  const m = powerups.combine(['speed', 'jump', 'speed', 'banana']);
  assert.ok(Math.abs(m.speed - 1.12) < 1e-9, 'a repeated id is only counted once');
  assert.ok(Math.abs(m.jump - 1.18) < 1e-9);
  assert.equal(m.shoveCd, 1);
  assert.deepEqual(powerups.combine([]), powerups.NEUTRAL);
  assert.deepEqual(powerups.combine(null), powerups.NEUTRAL);
});

test('power-ups: normalizeMods clamps junk, so a bad request can never make anyone super-human', () => {
  const m = powerups.normalizeMods({ speed: 99, jump: -5, shoveCd: 'fast', range: NaN, sturdy: 0 });
  assert.equal(m.speed, 1.4);
  assert.equal(m.jump, 0.6);
  assert.equal(m.shoveCd, 1);
  assert.equal(m.range, 1);
  assert.equal(m.sturdy, 0.4);
  assert.deepEqual(powerups.normalizeMods(undefined), powerups.NEUTRAL);
  assert.deepEqual(powerups.normalizeMods('hello'), powerups.NEUTRAL);
});

// ---------------------------------------------------------------- the room
test('pit stop: coins from a round fill the purse; a new match starts everybody at zero', () => {
  const { room, ids } = makeRoom(2);
  room.startMatch(ids[0]);
  room.beginPlaying();
  room.game.time = 5;
  room.game._finish();
  room.beginResults();
  for (const id of ids) {
    const p = room.players.get(id);
    assert.ok(p.purse >= 10, `purse ${p.purse}`);
  }
  inPitstop(room);
  room.phase = 'final';
  room.startMatch(ids[0]);
  for (const id of ids) assert.equal(room.players.get(id).purse, 0);
});

test('pit stop: buying takes the price, adds the boost and tells everybody in the room state', () => {
  const { room, ids } = makeRoom(2);
  const me = room.players.get(ids[0]);
  me.purse = 50;
  inPitstop(room);
  assert.equal(room.buyPowerup(ids[0], 'speed'), null);
  assert.equal(me.purse, 30);
  assert.deepEqual(me.power.map((x) => x.id), ['speed']);
  const st = room.publicState();
  const row = st.players.find((p) => p.id === ids[0]);
  assert.equal(row.purse, 30);
  assert.deepEqual(row.power, ['speed']);
  assert.ok(st.powerups.length >= 5);
  assert.equal(st.maxPowerSlots, 2);
});

test('pit stop: it is only open between rounds', () => {
  const { room, ids } = makeRoom(2);
  room.players.get(ids[0]).purse = 100;
  for (const phase of ['lobby', 'intro', 'playing', 'results', 'final']) {
    room.phase = phase;
    assert.match(room.buyPowerup(ids[0], 'speed'), /between rounds/, phase);
  }
  assert.equal(room.players.get(ids[0]).purse, 100);
  assert.match(room.refundPowerup(ids[0], 'speed'), /between rounds/);
});

test('pit stop: you cannot overspend, buy the same thing twice, buy a third, or buy nonsense', () => {
  const { room, ids } = makeRoom(2);
  const me = room.players.get(ids[0]);
  inPitstop(room);
  me.purse = 19;
  assert.match(room.buyPowerup(ids[0], 'speed'), /1 more/);
  assert.equal(me.purse, 19);
  me.purse = 200;
  assert.equal(room.buyPowerup(ids[0], 'speed'), null);
  assert.match(room.buyPowerup(ids[0], 'speed'), /already/);
  assert.equal(room.buyPowerup(ids[0], 'jump'), null);
  assert.match(room.buyPowerup(ids[0], 'reach'), /at most/);
  assert.equal(me.power.length, 2);
  assert.equal(me.purse, 160);
  for (const junk of ['', 'free-money', '__proto__', 'constructor']) {
    assert.match(room.buyPowerup(ids[0], junk), /No such/);
  }
  assert.match(room.buyPowerup('nobody', 'speed'), /not in this room/);
});

test('pit stop: last place pays 30% less (3+ players), but not when everybody is level or only two play', () => {
  const { room, ids } = makeRoom(3);
  const [a, b, c] = ids.map((id) => room.players.get(id));
  a.score = 20;
  b.score = 12;
  c.score = 5;
  assert.equal(room.isUnderdog(c), true);
  assert.equal(room.isUnderdog(a), false);
  assert.equal(room.isUnderdog(b), false);
  inPitstop(room);
  c.purse = 14;
  assert.equal(room.buyPowerup(c.id, 'speed'), null, '14 coins is enough for the discounted price');
  assert.equal(c.purse, 0);
  assert.equal(c.power[0].paid, 14);
  b.purse = 14;
  assert.match(room.buyPowerup(b.id, 'speed'), /6 more/);

  a.score = b.score = c.score = 7;
  assert.equal(room.isUnderdog(c), false, 'everybody level: nobody is behind');
  const two = makeRoom(2);
  two.room.players.get(two.ids[0]).score = 10;
  assert.equal(two.room.isUnderdog(two.room.players.get(two.ids[1])), false, 'with two players there is no discount');
});

test('pit stop: a refund returns exactly what you paid (even a discounted price)', () => {
  const { room, ids } = makeRoom(3);
  const [a, b, c] = ids.map((id) => room.players.get(id));
  a.score = 20;
  b.score = 12;
  c.score = 5;
  inPitstop(room);
  c.purse = 30;
  room.buyPowerup(c.id, 'speed');
  assert.equal(c.purse, 16);
  assert.equal(room.refundPowerup(c.id, 'speed'), null);
  assert.equal(c.purse, 30);
  assert.equal(c.power.length, 0);
  assert.match(room.refundPowerup(c.id, 'speed'), /do not have/);
});

test('pit stop: it ends when everybody is done, or when the time is up', () => {
  const { room, ids } = makeRoom(3);
  room.round = 1;
  room.rounds = 3;
  room.schedule = [{ game: 'goldGrab', variant: 'classic' }, { game: 'goldGrab', variant: 'classic' }, { game: 'goldGrab', variant: 'classic' }];
  inPitstop(room);
  room.updatePhases(Date.now());
  assert.equal(room.phase, 'pitstop', 'still open');
  room.setShopDone(ids[0], true);
  room.setShopDone(ids[1], true);
  room.updatePhases(Date.now());
  assert.equal(room.phase, 'pitstop', 'one player is still shopping');
  room.setShopDone(ids[2], true);
  room.updatePhases(Date.now());
  assert.equal(room.phase, 'intro');
  assert.equal(room.round, 2);

  inPitstop(room);
  room.phaseEndsAt = Date.now() - 1;
  room.updatePhases(Date.now());
  assert.equal(room.phase, 'intro', 'time up');
});

test('pit stop: buying again after saying "done" re-opens your shopping, so nobody is rushed', () => {
  const { room, ids } = makeRoom(2);
  inPitstop(room);
  room.players.get(ids[0]).purse = 40;
  room.setShopDone(ids[0], true);
  room.buyPowerup(ids[0], 'speed');
  assert.equal(room.players.get(ids[0]).done, false);
});

test('pit stop: it is skipped when nobody could afford anything, and when it is switched off', () => {
  const { room, ids } = makeRoom(3);
  for (const id of ids) room.players.get(id).purse = 13;
  assert.equal(room.pitstopWorthIt(), false);
  room.players.get(ids[1]).purse = powerups.cheapestPrice();
  assert.equal(room.pitstopWorthIt(), true);
  const off = makeRoom(3, { PITSTOP_MS: 0 });
  for (const id of off.ids) off.room.players.get(id).purse = 999;
  assert.equal(off.room.pitstopWorthIt(), false);
  assert.deepEqual(off.room.publicState().powerups, [], 'no catalogue when power-ups are off');
});

test('pit stop: the last round has no pit stop after it', () => {
  const { room, ids } = makeRoom(2);
  room.startMatch(ids[0]);
  room.rounds = 1;
  room.beginPlaying();
  room.game._finish();
  room.beginResults();
  room.phaseEndsAt = Date.now() - 1;
  room.updatePhases(Date.now());
  assert.equal(room.phase, 'final');
});

test('pit stop: what you bought is used in the next round only, then it is gone', () => {
  const { room, ids } = makeRoom(2);
  room.startMatch(ids[0]);
  room.round = 1;
  room.rounds = 3;
  room.players.get(ids[1]).purse = 60;
  inPitstop(room);
  room.buyPowerup(ids[1], 'speed');
  room.buyPowerup(ids[1], 'jump');
  room.beginIntro();
  room.beginPlaying();
  const mine = room.game.players.get(ids[1]);
  assert.ok(Math.abs(mine.mods.speed - 1.12) < 1e-9, 'speed boost reached the game');
  assert.ok(Math.abs(mine.mods.jump - 1.18) < 1e-9);
  assert.equal(room.game.players.get(ids[0]).mods.speed, 1, 'the other player has none');
  room.game._finish();
  room.beginResults();
  assert.deepEqual(room.players.get(ids[1]).power, [], 'used up after the round');
});

test('pit stop: leaving a room mid pit stop cannot freeze the shop (disconnected players do not hold it up)', () => {
  const { room, ids } = makeRoom(2);
  room.round = 1;
  room.rounds = 3;
  room.schedule = [{ game: 'goldGrab', variant: 'classic' }, { game: 'goldGrab', variant: 'classic' }, { game: 'goldGrab', variant: 'classic' }];
  inPitstop(room);
  room.players.get(ids[1]).connected = false;
  room.setShopDone(ids[0], true);
  room.updatePhases(Date.now());
  assert.equal(room.phase, 'intro');
});

// ------------------------------------------------------- the effect in games
test('effect: Speedy Shoes make you run farther in every kind of game', () => {
  for (const Game of [GoldGrab, CrumbleFloor]) {
    const g = make(Game, 2, { p1: powerups.combine(['speed']) });
    const [a, b] = [g.players.get('p1'), g.players.get('p2')];
    place(a, 300, 200);
    place(b, 300, 380);
    press(g, 'p1', { mx: 1 });
    press(g, 'p2', { mx: 1 });
    run(g, 0.6);
    const da = a.x - 300;
    const db = b.x - 300;
    assert.ok(da > db * 1.04 && da < db * 1.2, `${Game.name}: boosted ${da.toFixed(1)} vs normal ${db.toFixed(1)}`);
  }
});

test('effect: Bouncy Boots jump higher', () => {
  for (const Game of [GoldGrab, CrumbleFloor]) {
    const g = make(Game, 2, { p1: powerups.combine(['jump']) });
    const [a, b] = [g.players.get('p1'), g.players.get('p2')];
    place(a, 300, 200);
    place(b, 300, 380);
    tap(g, 'p1', 'jump');
    tap(g, 'p2', 'jump');
    let ha = 0;
    let hb = 0;
    for (let i = 0; i < 40; i++) {
      g.tick(DT);
      ha = Math.max(ha, a.z);
      hb = Math.max(hb, b.z);
    }
    assert.ok(ha > hb * 1.2, `${Game.name}: boosted ${ha.toFixed(1)} vs normal ${hb.toFixed(1)} (about 18% more height from 18% more speed squared)`);
  }
});

test('effect: Quick Hands shorten the shove cooldown', () => {
  for (const Game of [GoldGrab, CrumbleFloor]) {
    const g = make(Game, 2, { p1: powerups.combine(['quick']) });
    const [a, b] = [g.players.get('p1'), g.players.get('p2')];
    place(a, 300, 200);
    place(b, 300, 380);
    tap(g, 'p1', 'shove');
    tap(g, 'p2', 'shove');
    assert.ok(a.shoveCd < b.shoveCd * 0.75, `${Game.name}: ${a.shoveCd.toFixed(2)} vs ${b.shoveCd.toFixed(2)}`);
  }
});

test('effect: Long Arms reach a rival that a normal shove would miss, Sturdy Soles reduce the push', () => {
  for (const Game of [GoldGrab, CrumbleFloor]) {
    // reach: the target stands 95 pixels away (normal reach is 80)
    let g = make(Game, 3, { p1: powerups.combine(['reach']) });
    place(g.players.get('p1'), 300, 288, 1, 0);
    place(g.players.get('p2'), 395, 288);
    place(g.players.get('p3'), 300, 100);
    tap(g, 'p1', 'shove');
    assert.equal(g.players.get('p2').hitsTaken, 1, `${Game.name}: long arms hit`);
    g = make(Game, 3, {});
    place(g.players.get('p1'), 300, 288, 1, 0);
    place(g.players.get('p2'), 395, 288);
    place(g.players.get('p3'), 300, 100);
    tap(g, 'p1', 'shove');
    assert.equal(g.players.get('p2').hitsTaken, 0, `${Game.name}: normal shove misses`);

    // sturdy: same shove, less knockback
    const push = (mods) => {
      const gg = make(Game, 3, mods);
      place(gg.players.get('p1'), 300, 288, 1, 0);
      place(gg.players.get('p2'), 340, 288);
      place(gg.players.get('p3'), 300, 100);
      press(gg, 'p1', { shove: true });
      gg.tick(DT);
      const q = gg.players.get('p2');
      return Math.hypot(q.kx, q.ky);
    };
    const plain = push({});
    const sturdy = push({ p2: powerups.combine(['sturdy']) });
    assert.ok(plain > 300);
    assert.ok(Math.abs(sturdy / plain - 0.65) < 0.02, `${Game.name}: ${sturdy.toFixed(0)} vs ${plain.toFixed(0)}`);
  }
});

test('effect: a game with no mods behaves exactly as before, and junk mods cannot break a game', () => {
  const g = make(GoldGrab, 2, { p1: { speed: 'warp', jump: Infinity, shoveCd: -1 }, ghost: { speed: 3 } });
  const p = g.players.get('p1');
  assert.equal(p.mods.speed, 1);
  assert.equal(p.mods.jump, 1, 'Infinity is not a real number, so it is ignored');
  assert.equal(p.mods.shoveCd, 0.5, 'a negative request is clamped to the lowest allowed');
  run(g, 2);
  assert.ok(Number.isFinite(p.x) && ArenaGame.walkable(p.x, p.y));
  const plain = new GoldGrab([{ id: 'a', name: 'A' }], 'classic', {});
  assert.deepEqual(plain.players.get('a').mods, powerups.NEUTRAL);
});

test('effect: the Prop Hunt seeker also gets Long Arms and Quick Hands', () => {
  const g = new PropHunt([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }], 'classic', {
    mods: { p1: powerups.combine(['reach', 'quick']), p2: powerups.combine(['reach', 'quick']), p3: powerups.combine(['reach', 'quick']) },
  });
  g.time = g.cfg.hideTime + 0.1;
  const seeker = [...g.players.values()].find((p) => p.role === 'seeker');
  assert.ok(Math.abs(seeker.mods.range - 1.25) < 1e-9);
  const others = [...g.players.values()].filter((p) => p !== seeker);
  g.decoys.length = 0;
  place(seeker, 400, 288, 1, 0);
  place(others[0], 400 + 95, 288);
  place(others[1], 100, 288);
  tap(g, seeker.id, 'shove');
  assert.equal(others[0].found, true, '95px is beyond the normal 78px smack but within 25% longer arms');
  assert.ok(seeker.shoveCd <= PropHunt.TUNING.smackCooldown * 0.7 + 1e-9);
});
