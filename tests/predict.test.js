'use strict';

// Tests for the movement prediction (public/js/predict.js). The key test replays a whole
// "round" against the REAL server rules with a delayed connection and checks that the
// predicted picture lands much closer to where the server really puts you than the old
// "just extrapolate the last snapshot" approach.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const games = require('../server/games');
const ArenaGame = require('../server/games/arenaBase');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'predict.js')).href);

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

// Runs one simulated connection. Returns the average distance (in px) between where we would
// DRAW your character and where the server really has it at that moment, for both methods.
async function simulate({ slot, oneWayMs, seconds = 20, seed = 1 }) {
  const { Predictor, arenaWalkable } = await load();
  const rnd = rngOf(seed);
  const g = games.createGame(slot, [{ id: 'p1', name: 'Me' }], { rng: rnd });
  g.time = 0.5;
  const pr = new Predictor();
  const TICK = 1 / 30;
  const FRAME = 1000 / 60;
  const up = oneWayMs;
  const down = oneWayMs;
  const history = []; // server truth: { tMs, x, y }
  const toServer = []; // inputs on their way up
  const toClient = []; // snapshots on their way down
  let own = null;
  let recvAt = 0;
  let input = { mx: 0, my: 0 };
  let nextChange = 0;
  let nextTick = 0;
  let errPredict = 0;
  let errOld = 0;
  let n = 0;
  const samples = [];
  const gid = games.GAMES[slot.game].GAME_ID;
  for (let t = 0; t < seconds * 1000; t += FRAME) {
    // the player changes direction now and then (sometimes stops)
    if (t >= nextChange) {
      const dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
      const d = dirs[Math.floor(rnd() * dirs.length)];
      input = { mx: d[0], my: d[1] };
      pr.record(t, input.mx, input.my);
      toServer.push({ at: t + up, input });
      nextChange = t + 300 + rnd() * 900;
    }
    // server side
    while (toServer.length && toServer[0].at <= t) {
      const m = toServer.shift();
      g.setInput('p1', { mx: m.input.mx, my: m.input.my, jump: false, shove: false });
    }
    while (nextTick <= t) {
      g.tick(TICK);
      const snap = g.snapshot();
      const me = snap.ps[0];
      history.push({ t: nextTick, x: me.x, y: me.y });
      toClient.push({ at: nextTick + down, me });
      nextTick += TICK * 1000;
    }
    // client side
    while (toClient.length && toClient[0].at <= t) {
      const m = toClient.shift();
      own = m.me;
      recvAt = m.at;
    }
    if (!own || t < 2500) continue; // let it warm up
    const rtt = up + down;
    const out = pr.predict(own, { now: t, recvAt, rtt, walkable: arenaWalkable });
    const ahead = Math.min(0.06, (t - recvAt) / 1000);
    samples.push({ want: t + up, out, oldX: own.x + own.vx * ahead, oldY: own.y + own.vy * ahead });
  }
  // compare with what the server REALLY did at the moment each guess was meant for
  for (const sm of samples) {
    const fut = history.find((h) => h.t >= sm.want);
    if (!fut || !sm.out) continue;
    errPredict += Math.hypot(sm.out.x - fut.x, sm.out.y - fut.y);
    errOld += Math.hypot(sm.oldX - fut.x, sm.oldY - fut.y);
    n++;
  }
  return { predict: errPredict / n, old: errOld / n, n, gid };
}

test('predict: the guess lands far closer to the real position than plain extrapolation (several pings, several games)', async () => {
  for (const slot of [{ game: 'goldGrab', variant: 'classic' }, { game: 'paintPanic', variant: 'rush' }, { game: 'hotPotato', variant: 'icy' }]) {
    for (const oneWayMs of [20, 50, 100]) {
      const r = await simulate({ slot, oneWayMs, seed: 5 + oneWayMs });
      assert.ok(r.n > 500);
      assert.ok(r.predict < r.old * 0.55, `${slot.game}@${oneWayMs}ms: predicted error ${r.predict.toFixed(1)}px vs old ${r.old.toFixed(1)}px`);
      assert.ok(r.predict < 14 + oneWayMs * 0.15, `${slot.game}@${oneWayMs}ms: absolute error ${r.predict.toFixed(1)}px`);
    }
  }
});

test('predict: pressing a key moves the picture on the very next frame, before any server news', async () => {
  const { Predictor } = await load();
  const pr = new Predictor();
  const own = { x: 400, y: 300, vx: 0, vy: 0, z: 0, ms: 235, ma: 14, fx: 1, fy: 0 };
  const idle = pr.predict(own, { now: 1000, recvAt: 980, rtt: 80, walkable: null });
  assert.ok(Math.abs(idle.x - 400) < 0.01 && Math.abs(idle.y - 300) < 0.01, 'nothing pressed: nothing moves');
  pr.record(1000, 1, 0);
  const moved = pr.predict(own, { now: 1016, recvAt: 980, rtt: 80, walkable: null });
  assert.ok(moved.x > 400 + 0.3, `starts moving right at once (${moved.x})`);
  const later = pr.predict(own, { now: 1100, recvAt: 980, rtt: 80, walkable: null });
  assert.ok(later.x > 400 + 5, `and keeps going (${later.x})`);
  assert.equal(Math.round(moved.fy * 100), 0);
  assert.ok(moved.fx > 0.9, 'and faces that way');
});

test('predict: no guess while stunned/frozen (ms = 0) or when the player is not there', async () => {
  const { Predictor } = await load();
  const pr = new Predictor();
  pr.record(0, 1, 0);
  assert.equal(pr.predict({ x: 1, y: 1, vx: 0, vy: 0, z: 0, ms: 0, ma: 14, fx: 1, fy: 0 }, { now: 100, recvAt: 90, rtt: 50 }), null);
  assert.equal(pr.predict(null, { now: 100, recvAt: 90, rtt: 50 }), null);
  assert.equal(pr.predict({ x: 1, y: 1, vx: 0, vy: 0, z: 0, fx: 1, fy: 0 }, { now: 100, recvAt: 90, rtt: 50 }), null, 'an old server without ms');
});

test('predict: walls stop the guess like they stop the real player', async () => {
  const { Predictor, arenaWalkable } = await load();
  const pr = new Predictor();
  pr.record(0, 1, 0);
  const own = { x: 840, y: 288, vx: 235, vy: 0, z: 0, ms: 235, ma: 14, fx: 1, fy: 0 };
  const out = pr.predict(own, { now: 400, recvAt: 380, rtt: 200, walkable: arenaWalkable });
  assert.ok(arenaWalkable(out.x, out.y), `stayed on the floor (${out.x}, ${out.y})`);
  assert.ok(out.x <= 882.5, `stopped at the edge (${out.x})`);
});

test('predict: small corrections melt away, big ones jump, and the history stays small', async () => {
  const { Predictor, PREDICT } = await load();
  const pr = new Predictor();
  const own = { x: 100, y: 100, vx: 0, vy: 0, z: 0, ms: 235, ma: 14, fx: 1, fy: 0 };
  const ctx = { now: 1000, recvAt: 990, rtt: 0, walkable: null };
  const a = pr.predict(own, ctx);
  const b = pr.predict({ ...own, x: 110 }, { ...ctx, now: 1016, recvAt: 1016 }); // the server says "10 px to the right"
  assert.ok(b.x < 103, `no pop: it stays near where it was (${b.x})`);
  let last = b;
  for (let i = 0; i < 40; i++) last = pr.predict({ ...own, x: 110 }, { ...ctx, now: 1032 + i * 16, recvAt: 1016 });
  assert.ok(Math.abs(last.x - 110) < 0.5, 'then settles on the server value');
  const c = pr.predict({ ...own, x: 400 }, { ...ctx, now: 2000, recvAt: 2000 });
  assert.equal(Math.round(c.x), 400, 'a big error snaps');
  for (let i = 0; i < 5000; i++) pr.record(i * 20, i % 2, 0);
  assert.ok(pr.hist.length < 120, `history pruned (${pr.hist.length})`);
  assert.ok(PREDICT.maxWindow <= 0.5);
});

test('server: every player snapshot carries the steering info the predictor needs', async () => {
  for (const [id, Game] of Object.entries(games.GAMES)) {
    const g = new Game([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], 'classic', { rng: rngOf(3) });
    g.time = 0.5;
    g.tick(1 / 30);
    const me = g.snapshot().ps[0];
    assert.ok(me.ms > 150 && me.ms < 400, `${id}: ms ${me.ms}`);
    assert.ok(me.ma > 5 && me.ma < 40, `${id}: ma ${me.ma}`);
    g.players.get('p1').stun = 0.3;
    assert.equal(g.snapshot().ps[0].ms, 0, `${id}: stunned means input does nothing`);
  }
  // before the start whistle nothing can steer
  const g = games.createGame({ game: 'goldGrab', variant: 'classic' }, [{ id: 'p1', name: 'A' }], {});
  g.tick(1 / 30);
  assert.equal(g.snapshot().ps[0].ms, 0);
});

test('server: Prop Hunt freezes a seeker during the hide phase, and a disguised hider\'s speed shows up', async () => {
  const PropHunt = require('../server/games/propHunt');
  const g = new PropHunt([{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }], 'classic', { rng: rngOf(9) });
  g.time = 0.5;
  g.tick(1 / 30);
  const seeker = [...g.players.values()].find((p) => p.role === 'seeker' || p.seeker);
  const snap = g.snapshot();
  const rows = Object.fromEntries(snap.ps.map((p) => [p.id, p]));
  if (seeker) assert.equal(rows[seeker.id].ms, 0, 'the blindfolded seeker cannot steer yet');
  assert.ok(snap.ps.some((p) => p.ms > 0), 'hiders can');
});
