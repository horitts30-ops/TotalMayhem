'use strict';

// Rules tests for Prop Hunt, Meteor Mayhem and Crown Chaos. No network involved.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const games = require('../server/games');
const ArenaGame = require('../server/games/arenaBase');
const PropHunt = require('../server/games/propHunt');
const MeteorMayhem = require('../server/games/meteorMayhem');
const CrownChaos = require('../server/games/crownChaos');

const DT = 1 / 30;
const THREE = { propHunt: PropHunt, meteorMayhem: MeteorMayhem, crownChaos: CrownChaos };

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
const tap = (g, id, key) => {
  press(g, id, { [key]: true });
  g.tick(DT);
  press(g, id, {});
  g.tick(DT);
};

// ------------------------------------------------------------------ all three
test('the three newest minigames have descriptions, arena info and two variants each', () => {
  for (const [id, Game] of Object.entries(THREE)) {
    assert.ok(Object.keys(Game.VARIANTS).length >= 2, `${id} variants`);
    for (const v of Object.keys(Game.VARIANTS)) {
      const d = Game.describe(v);
      assert.equal(d.gameId, id);
      assert.ok(d.name && d.tagline && d.theme && d.category);
      assert.ok(d.instructions.length >= 3 && d.controls.length >= 3);
    }
    const a = Game.arena;
    assert.ok(a.maxTime > 0 && a.shoveCooldown > 0 && a.scoreLabel);
  }
  assert.equal(Object.keys(games.GAMES).length, 13, 'thirteen minigames in total');
});

test('fuzz: random rounds always finish with valid results (every new game and variant, 1-8 players)', () => {
  let trial = 0;
  for (const [id, Game] of Object.entries(THREE)) {
    for (const v of Object.keys(Game.VARIANTS)) {
      for (const n of [1, 2, 3, 5, 8]) {
        const g = make(Game, n, v, 500 + trial++);
        g.time = -3;
        const ids = [...g.players.keys()];
        let steps = 0;
        while (!g.isFinished() && steps++ < 30 * 85) {
          if (steps % 5 === 0) {
            for (const pid of ids) {
              g.setInput(pid, { mx: Math.random() * 2 - 1, my: Math.random() * 2 - 1, jump: Math.random() < 0.25, shove: Math.random() < 0.3 });
            }
          }
          g.tick(DT);
          const snaps = g.perViewer ? [...g.snapshotsByViewer(ids).values()] : [g.snapshot()];
          for (const s of snaps) {
            assert.equal(s.gid, id);
            for (const q of s.ps) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z));
          }
          for (const p of g.players.values()) assert.ok(ArenaGame.walkable(p.x, p.y), `${id}/${v}: inside the arena (${p.x},${p.y})`);
        }
        assert.ok(g.isFinished(), `${id}/${v} with ${n} players finished`);
        const rows = g.results();
        assert.equal(rows.length, n);
        assert.ok(rows.some((r) => r.place === 1));
        for (const r of rows) {
          assert.ok(Number.isInteger(r.points) && r.points >= 1 && r.points <= 10, `${id} points ${r.points}`);
          assert.equal(typeof r.detail, 'string');
        }
      }
    }
  }
});

test('players who leave earn nothing and the round still finishes (every new game)', () => {
  for (const [id, Game] of Object.entries(THREE)) {
    const g = make(Game, 4, 'classic', 9);
    g.removePlayer('p2');
    run(g, 1);
    const rows = g.results();
    const left = rows.find((r) => r.id === 'p2');
    assert.equal(left.points, 0, id);
    assert.equal(left.abandoned, true);
    g.removePlayer('p1');
    g.removePlayer('p3');
    g.removePlayer('p4');
    run(g, 1);
    assert.ok(g.isFinished(), `${id} ends when everybody has left`);
  }
});

// ------------------------------------------------------------------ Prop Hunt
function ph(n, variant = 'classic', seed = 3) {
  const g = make(PropHunt, n, variant, seed);
  const seekers = [...g.players.values()].filter((p) => p.role === 'seeker');
  const hiders = [...g.players.values()].filter((p) => p.role === 'hider');
  return { g, seekers, hiders, seeker: seekers[0] };
}
const startSeek = (g) => {
  g.time = g.cfg.hideTime + 0.05;
  g.tick(DT);
};

test('Prop Hunt: one seeker (two with 7+ players); a solo player is just a hider', () => {
  assert.equal(ph(1).seekers.length, 0);
  for (const n of [2, 3, 4, 5, 6]) assert.equal(ph(n).seekers.length, 1, `${n} players`);
  for (const n of [7, 8]) assert.equal(ph(n).seekers.length, 2, `${n} players`);
  const { g, hiders, seeker } = ph(4);
  assert.equal(hiders.length, 3);
  assert.ok(seeker.origSeeker);
});

test('Prop Hunt: the seeker is blindfolded and frozen while the hiders hide', () => {
  const { g, seeker } = ph(3);
  const start = { x: seeker.x, y: seeker.y };
  press(g, seeker.id, { mx: 1, my: 0 });
  run(g, 1.5);
  assert.ok(Math.hypot(seeker.x - start.x, seeker.y - start.y) < 1, 'the seeker did not move');
  const hider = [...g.players.values()].find((p) => p.role === 'hider');
  place(hider, seeker.x + 40, seeker.y, -1, 0);
  place(seeker, seeker.x, seeker.y, 1, 0);
  tap(g, seeker.id, 'shove');
  assert.equal(seeker.finds, 0, 'smacking is disabled while blindfolded');
  startSeek(g);
  press(g, seeker.id, { mx: 1 });
  run(g, 0.4);
  assert.ok(seeker.x !== start.x, 'once the hiding time is over the seeker can move');
});

test('Prop Hunt: the seeker\'s own snapshot shows no hiders and no props while blindfolded', () => {
  const { g, seeker, hiders } = ph(4);
  const ids = [...g.players.keys()];
  const views = g.snapshotsByViewer(ids);
  const seen = views.get(seeker.id);
  assert.equal(seen.blind, 1);
  assert.deepEqual(seen.props, []);
  assert.deepEqual(seen.ps.map((p) => p.id), [seeker.id], 'only the seeker is in the seeker\'s snapshot');
  const hv = views.get(hiders[0].id);
  assert.equal(hv.blind, 0);
  assert.equal(hv.ps.length, 4, 'a hider sees everybody');
  assert.ok(hv.props.length >= 10, 'and sees the props');
});

test('Prop Hunt: E turns a hider into a prop, it cannot move, SPACE swaps the prop, E turns back', () => {
  const { g, hiders } = ph(3);
  const h = hiders[0];
  place(h, 300, 280);
  tap(g, h.id, 'shove');
  assert.equal(h.disguised, true);
  const at = { x: h.x, y: h.y };
  press(g, h.id, { mx: 1, my: 1 });
  run(g, 1);
  assert.ok(Math.hypot(h.x - at.x, h.y - at.y) < 0.5, 'a prop does not walk around');
  press(g, h.id, {});
  const before = h.prop;
  tap(g, h.id, 'jump');
  assert.equal(h.prop, (before + 1) % PropHunt.TUNING.propTypes);
  assert.equal(h.swaps, 1);
  run(g, 1); // let the toggle cooldown pass
  tap(g, h.id, 'shove');
  assert.equal(h.disguised, false);
});

test('Prop Hunt: disguise toggling has a cooldown, so it cannot be flickered', () => {
  const { g, hiders } = ph(3);
  const h = hiders[0];
  place(h, 300, 280);
  press(g, h.id, { shove: true });
  g.tick(DT);
  press(g, h.id, {});
  g.tick(DT);
  press(g, h.id, { shove: true });
  g.tick(DT);
  assert.equal(h.disguised, true, 'a second tap right away is ignored');
  press(g, h.id, {});
  run(g, 1);
  tap(g, h.id, 'shove');
  assert.equal(h.disguised, false);
});

test('Prop Hunt: a hider starts as the prop nearest to them, so they blend in at once', () => {
  const { g, hiders } = ph(3);
  const h = hiders[0];
  const decoy = g.decoys[0];
  place(h, decoy.x + 10, decoy.y + 5);
  tap(g, h.id, 'shove');
  assert.equal(h.prop, decoy.type);
});

test('Prop Hunt: a disguised hider is absent from the seeker\'s players and is just one more prop', () => {
  const { g, seeker, hiders } = ph(4);
  startSeek(g);
  const h = hiders[0];
  place(h, 700, 300);
  g.time = g.cfg.hideTime + 0.05;
  tap(g, h.id, 'shove');
  assert.equal(h.disguised, true);
  const ids = [...g.players.keys()];
  const views = g.snapshotsByViewer(ids);
  const seeSeeker = views.get(seeker.id);
  assert.ok(!seeSeeker.ps.some((p) => p.id === h.id), 'the seeker\'s snapshot does not list the hider');
  assert.equal(seeSeeker.props.length, g.decoys.length + 1, 'but the prop count includes the disguised hider');
  const entry = seeSeeker.props.find((q) => Math.abs(q[0] - 700) < 1 && Math.abs(q[1] - 300) < 1);
  assert.ok(entry, 'the disguise shows as a prop at the same spot');
  assert.equal(entry.length, 3, 'a prop is just [x, y, type] - the same shape as every real prop');
  for (const q of seeSeeker.props) assert.ok(q.every((v) => typeof v === 'number'));
  // nothing in the seeker's whole snapshot says "this prop is a player"
  const text = JSON.stringify({ ...seeSeeker, sc: undefined });
  assert.ok(!text.includes('"dg"'), 'no disguise flag');
  // the hider themself knows
  const mine = views.get(h.id).ps.find((p) => p.id === h.id);
  assert.equal(mine.dg, 1);
  assert.equal(typeof mine.pt, 'number');
  // other hiders do not see the secret either
  const other = views.get(hiders[1].id);
  assert.ok(!other.ps.some((p) => p.id === h.id));
});

test('Prop Hunt: nobody else gets told WHO turned into a prop (events are trimmed per viewer)', () => {
  const { g, seeker, hiders } = ph(4);
  startSeek(g);
  const h = hiders[0];
  place(h, 500, 300);
  g.events.length = 0;
  press(g, h.id, { shove: true });
  g.tick(DT); // the hider turns into a prop during this tick
  const views = g.snapshotsByViewer([...g.players.keys()]);
  const mine = views.get(h.id).ev.find((e) => e.k === 'disguise');
  const seekers = views.get(seeker.id).ev.find((e) => e.k === 'disguise');
  const friends = views.get(hiders[1].id).ev.find((e) => e.k === 'disguise');
  assert.equal(mine && mine.id, h.id, 'the hider is told about their own disguise');
  assert.ok(seekers && friends, 'others may notice the poof');
  assert.ok(!('id' in seekers) && !('id' in friends), 'but it does not say who');
});

test('Prop Hunt: while the seeker is blindfolded they are not even told about disguises', () => {
  const { g, seeker, hiders } = ph(3);
  place(hiders[0], 500, 300);
  g.events.length = 0;
  press(g, hiders[0].id, { shove: true });
  g.tick(DT);
  const views = g.snapshotsByViewer([...g.players.keys()]);
  assert.ok(!views.get(seeker.id).ev.some((e) => e.k === 'disguise'));
  assert.ok(views.get(hiders[0].id).ev.some((e) => e.k === 'disguise'));
});

test('Prop Hunt: smacking a real hider finds them; they become a helper seeker and stay in the game', () => {
  const { g, seeker, hiders } = ph(4);
  startSeek(g);
  const h = hiders[0];
  place(seeker, 400, 280, 1, 0);
  place(h, 440, 280);
  tap(g, h.id, 'shove');
  assert.equal(h.disguised, true);
  g.events.length = 0;
  tap(g, seeker.id, 'shove');
  assert.equal(h.found, true);
  assert.equal(h.role, 'seeker');
  assert.equal(h.helper, true);
  assert.equal(h.disguised, false);
  assert.equal(h.state, 'alive', 'found players are never eliminated');
  assert.equal(seeker.finds, 1);
  assert.ok(g.events.some((e) => e.k === 'found' && e.id === h.id && e.by === seeker.id));
  // and the helper can now hunt too
  const other = hiders[1];
  place(h, 200, 200, 1, 0);
  place(other, 240, 200);
  h.stun = 0;
  g.tick(DT);
  run(g, 1.4);
  tap(g, h.id, 'shove');
  assert.equal(other.found, true, 'a helper can find hiders');
  assert.equal(h.finds, 1);
});

test('Prop Hunt: smacking a plain prop makes the seeker dizzy and finds nobody', () => {
  const { g, seeker, hiders } = ph(3);
  startSeek(g);
  const d = g.decoys[0];
  for (const h of hiders) place(h, 40, 40); // far away (the corner is off the floor, so push them in)
  for (const h of hiders) place(h, 100, 288);
  place(seeker, d.x - 40, d.y, 1, 0);
  seeker.stun = 0;
  g.events.length = 0;
  tap(g, seeker.id, 'shove');
  assert.equal(seeker.bonks, 1);
  assert.ok(seeker.stun > 0.5, 'dizzy');
  assert.equal(seeker.finds, 0);
  assert.ok(g.events.some((e) => e.k === 'bonk'));
});

test('Prop Hunt: smacking empty air costs nothing but the cooldown', () => {
  const { g, seeker } = ph(3);
  startSeek(g);
  g.decoys.length = 0;
  for (const p of g.players.values()) if (p !== seeker) place(p, 100, 288);
  place(seeker, 700, 300, 1, 0);
  seeker.stun = 0;
  tap(g, seeker.id, 'shove');
  assert.equal(seeker.stun, 0);
  assert.equal(seeker.bonks, 0);
});

test('Prop Hunt: the nearest candidate wins, so a prop in front of a hider gets smacked first', () => {
  const { g, seeker, hiders } = ph(3);
  startSeek(g);
  g.decoys.length = 0;
  g.decoys.push({ id: 1, x: 430, y: 280, type: 0 });
  place(seeker, 400, 280, 1, 0);
  place(hiders[0], 470, 280); // behind the decoy, still in range
  place(hiders[1], 100, 288);
  tap(g, hiders[0].id, 'shove');
  tap(g, seeker.id, 'shove');
  assert.equal(hiders[0].found, false);
  assert.equal(seeker.bonks, 1);
});

test('Prop Hunt: a hider who jumps at the right moment dodges the smack', () => {
  const { g, seeker, hiders } = ph(3);
  startSeek(g);
  g.decoys.length = 0;
  place(seeker, 400, 280, 1, 0);
  place(hiders[0], 440, 280);
  place(hiders[1], 100, 288);
  hiders[0].z = 40;
  hiders[0].vz = 10;
  tap(g, seeker.id, 'shove');
  assert.equal(hiders[0].found, false);
});

test('Prop Hunt: walking through a disguised hider does not push them (so props cannot be "bumped" to reveal them)', () => {
  const { g, seeker, hiders } = ph(3);
  startSeek(g);
  const h = hiders[0];
  place(h, 440, 280);
  tap(g, h.id, 'shove');
  place(seeker, 405, 280, 1, 0);
  press(g, seeker.id, { mx: 1 });
  const hx = h.x;
  const hy = h.y;
  run(g, 0.5);
  assert.equal(h.x, hx);
  assert.equal(h.y, hy);
});

test('Prop Hunt: hiders score for every second hidden, plus a bonus for never being found', () => {
  const { g, seeker, hiders } = ph(3);
  startSeek(g);
  for (const h of hiders) place(h, 300 + Math.random() * 10, 280);
  hiders.forEach((h) => tap(g, h.id, 'shove'));
  const base = hiders[0].survive;
  run(g, 5);
  assert.ok(hiders[0].survive - base > 4.8, 'about one point per second');
  assert.equal(seeker.survive, 0, 'the seeker does not earn survival points');
  g.time = g.cfg.maxTime - 0.05;
  run(g, 0.2);
  assert.ok(g.isFinished());
  const bonus = PropHunt.TUNING.survivorBonus;
  assert.ok(g._score(hiders[0]) >= hiders[0].survive + bonus - 0.01);
});

test('Prop Hunt: the seeker is never left with nothing, but finding everyone pays best', () => {
  const { g, seeker, hiders } = ph(3);
  assert.equal(g._score(seeker), PropHunt.TUNING.seekerBase);
  seeker.finds = 2;
  assert.equal(g._score(seeker), PropHunt.TUNING.seekerBase + 2 * PropHunt.TUNING.seekerPerFind);
  assert.ok(PropHunt.TUNING.seekerBase >= 20);
  // a hider found early and who then finds others can catch up
  hiders[0].survive = 5;
  hiders[0].found = true;
  hiders[0].finds = 3;
  assert.equal(g._score(hiders[0]), 5 + 3 * PropHunt.TUNING.helperPerFind);
});

test('Prop Hunt: when every hider is found the round ends early', () => {
  const { g, seeker, hiders } = ph(3);
  startSeek(g);
  g.decoys.length = 0;
  place(seeker, 400, 280, 1, 0);
  hiders.forEach((h, i) => place(h, 440 + i * 4, 280 + i * 3));
  g.events.length = 0;
  tap(g, seeker.id, 'shove');
  run(g, 1.1);
  tap(g, seeker.id, 'shove');
  run(g, 0.2);
  for (const h of hiders) if (!h.found) {
    place(seeker, h.x - 40, h.y, 1, 0);
    seeker.stun = 0;
    run(g, 1);
    tap(g, seeker.id, 'shove');
  }
  assert.ok(hiders.every((h) => h.found), 'both hiders found');
  assert.ok(g.isFinished(), 'round over');
  assert.ok(g.time < 30, 'it ended early');
  const rows = g.results();
  assert.equal(rows.find((r) => r.id === seeker.id).place, 1, 'the seeker wins after finding everyone quickly');
});

test('Prop Hunt: if the only seeker leaves, a hider takes over so the round is still playable', () => {
  const { g, seeker } = ph(3);
  startSeek(g);
  g.removePlayer(seeker.id);
  const seekers = [...g.players.values()].filter((p) => p.state === 'alive' && p.role === 'seeker');
  assert.equal(seekers.length, 1);
  assert.ok(g.events.some((e) => e.k === 'newSeeker'));
});

test('Prop Hunt: solo practice has no seeker, lets you try disguises and finishes normally', () => {
  const { g, hiders } = ph(1);
  assert.equal(hiders.length, 1);
  const h = hiders[0];
  startSeek(g);
  tap(g, h.id, 'shove');
  assert.equal(h.disguised, true);
  run(g, 3);
  assert.ok(!g.isFinished(), 'a solo round does not end instantly');
  g.time = g.cfg.maxTime - 0.1;
  run(g, 0.3);
  assert.ok(g.isFinished());
  assert.equal(g.results().length, 1);
});

test('Prop Hunt: props start apart from each other and from the players, inside the arena', () => {
  for (const variant of Object.keys(PropHunt.VARIANTS)) {
    const { g } = ph(8, variant, 11);
    assert.ok(g.decoys.length >= 12, `${variant}: ${g.decoys.length} props`);
    for (const d of g.decoys) assert.ok(ArenaGame.walkable(d.x, d.y));
    for (const p of g.players.values()) {
      for (const d of g.decoys) assert.ok(Math.hypot(p.x - d.x, p.y - d.y) >= 49, 'not on top of a player');
    }
  }
});

test('Prop Hunt: the scoreboard numbers still reach everybody even though hidden players are not listed', () => {
  const { g, hiders, seeker } = ph(4);
  startSeek(g);
  tap(g, hiders[0].id, 'shove');
  run(g, 2);
  const view = g.snapshotsByViewer([...g.players.keys()]).get(seeker.id);
  assert.ok(!view.ps.some((p) => p.id === hiders[0].id));
  assert.ok(typeof view.sc[hiders[0].id] === 'number');
  assert.equal(Object.keys(view.sc).length, 4);
});

// -------------------------------------------------------------- Meteor Mayhem
function mm(n = 2, variant = 'classic') {
  const g = make(MeteorMayhem, n, variant, 4);
  g.nextAt = 1e9; // switch off the random storm so tests control it
  return g;
}

test('Meteor Mayhem: a meteor shows a warning first and does no damage until it lands', () => {
  const g = mm(2);
  const p = g.players.get('p1');
  place(p, 400, 288);
  g.meteors.push({ id: 1, x: 400, y: 288, t: 0 });
  run(g, 1.0);
  assert.equal(p.hits, 0, 'still just a warning');
  assert.equal(g.meteors.length, 1);
  run(g, 0.6);
  assert.equal(p.hits, 1, 'hit when it lands');
  assert.equal(g.meteors.length, 0);
});

test('Meteor Mayhem: standing in the circle when it lands knocks you away and makes you dizzy', () => {
  const g = mm(2);
  const p = g.players.get('p1');
  place(p, 430, 288);
  g.meteors.push({ id: 1, x: 400, y: 288, t: g.cfg.fuse - 0.01 });
  g.events.length = 0;
  g.tick(DT);
  assert.equal(p.hits, 1);
  assert.ok(p.stun > 0);
  assert.ok(p.kx > 100, 'blasted away from the centre');
  assert.ok(g.events.some((e) => e.k === 'impact'));
  assert.ok(g.events.some((e) => e.k === 'meteorHit' && e.id === 'p1'));
});

test('Meteor Mayhem: being outside the circle means no hit', () => {
  const g = mm(2);
  const p = g.players.get('p1');
  place(p, 400 + g.cfg.radius + 70, 288);
  g.meteors.push({ id: 1, x: 400, y: 288, t: g.cfg.fuse - 0.01 });
  g.tick(DT);
  assert.equal(p.hits, 0);
});

test('Meteor Mayhem: JUMPING over the blast avoids it', () => {
  const g = mm(2);
  const p = g.players.get('p1');
  place(p, 400, 288);
  p.z = 60;
  p.vz = 0;
  g.meteors.push({ id: 1, x: 400, y: 288, t: g.cfg.fuse - 0.001 });
  g.tick(DT);
  assert.equal(p.hits, 0);
  assert.equal(p.dodges, 1);
});

test('Meteor Mayhem: after a hit there is a short breather, so two blasts cannot chain-bonk', () => {
  const g = mm(2);
  const p = g.players.get('p1');
  place(p, 400, 288);
  g.meteors.push({ id: 1, x: 400, y: 288, t: g.cfg.fuse - 0.01 });
  g.tick(DT);
  assert.equal(p.hits, 1);
  p.kx = p.ky = 0;
  place(p, 400, 288);
  p.immune = 1;
  g.meteors.push({ id: 2, x: 400, y: 288, t: g.cfg.fuse - 0.01 });
  g.tick(DT);
  assert.equal(p.hits, 1, 'still protected');
});

test('Meteor Mayhem: the storm starts gentle and speeds up, and never has too many warnings at once', () => {
  const g = make(MeteorMayhem, 4, 'classic', 5);
  assert.ok(g._gap() > 1.2);
  g.time = 40;
  assert.ok(g._gap() < 0.8);
  g.time = 0.5;
  g.nextAt = 0.5;
  let most = 0;
  for (let i = 0; i < 30 * 40; i++) {
    g.tick(DT);
    most = Math.max(most, g.meteors.length);
  }
  assert.ok(most <= MeteorMayhem.TUNING.maxActive, `most warnings at once: ${most}`);
  assert.ok(g.landed > 8, `meteors landed: ${g.landed}`);
});

test('Meteor Mayhem: meteors never land outside the arena, and nothing falls during the countdown', () => {
  const g = make(MeteorMayhem, 3, 'hail', 8);
  g.time = -3;
  run(g, 2.5);
  assert.equal(g.meteors.length, 0, 'no meteors during 3-2-1');
  g.time = 0.5;
  g.nextAt = 0.5;
  for (let i = 0; i < 30 * 30; i++) {
    g.tick(DT);
    for (const m of g.meteors) assert.ok(ArenaGame.walkable(m.x, m.y), `meteor at ${m.x},${m.y}`);
  }
});

test('Meteor Mayhem: the fewest hits wins; the longer without a hit breaks ties; nobody is knocked out', () => {
  const g = mm(3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  a.hits = 3;
  a.lastHitAt = 40;
  b.hits = 1;
  b.lastHitAt = 10;
  c.hits = 1;
  c.lastHitAt = 30;
  g.time = g.cfg.maxTime - 0.01;
  run(g, 0.1);
  const rows = g.results();
  const order = rows.map((r) => r.id);
  assert.deepEqual(order, ['p3', 'p2', 'p1']);
  assert.ok(rows.every((r) => r.survived), 'everybody finished the round');
  assert.equal(g.players.get('p1').state, 'alive');
});

test('Meteor Mayhem: a player with zero hits wins and is called Untouchable', () => {
  const g = mm(3);
  g.players.get('p2').hits = 2;
  g.players.get('p3').hits = 4;
  g.time = g.cfg.maxTime - 0.01;
  run(g, 0.1);
  const rows = g.results();
  assert.equal(rows[0].id, 'p1');
  assert.equal(rows[0].title, 'Untouchable');
  assert.equal(rows[0].detail, 'untouched!');
});

test('Meteor Mayhem: a shove does not count as a hit', () => {
  const g = mm(2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, 300, 288, 1, 0);
  place(b, 340, 288);
  tap(g, 'p1', 'shove');
  assert.equal(b.hitsTaken, 1);
  assert.equal(b.hits, 0);
});

// --------------------------------------------------------------- Crown Chaos
function cc(n = 2, variant = 'classic') {
  return make(CrownChaos, n, variant, 6);
}

test('Crown Chaos: touching the crown picks it up, and wearing it scores a point per second', () => {
  const g = cc(2);
  const a = g.players.get('p1');
  place(a, g.crown.x - 80, g.crown.y);
  place(g.players.get('p2'), 150, 290);
  press(g, 'p1', { mx: 1 });
  run(g, 0.8);
  press(g, 'p1', {});
  assert.equal(g.crown.holder, 'p1');
  const before = a.held;
  run(g, 3);
  assert.ok(a.held - before > 2.8 && a.held - before < 3.2, `held ${a.held - before}`);
  assert.equal(g._scoreOf(a), Math.floor(a.held));
});

test('Crown Chaos: the crown follows its wearer around', () => {
  const g = cc(2);
  const a = g.players.get('p1');
  place(a, g.crown.x, g.crown.y);
  place(g.players.get('p2'), 150, 290);
  run(g, 0.2);
  assert.equal(g.crown.holder, 'p1');
  press(g, 'p1', { mx: -1 });
  run(g, 0.5);
  assert.ok(Math.hypot(g.crown.x - a.x, g.crown.y - a.y) < 1);
});

test('Crown Chaos: shoving the wearer knocks the crown off, and the old wearer cannot grab it straight back', () => {
  const g = cc(2);
  const [a, b] = [g.players.get('p1'), g.players.get('p2')];
  place(a, g.crown.x, g.crown.y);
  place(b, a.x - 40, a.y, 1, 0);
  run(g, 0.2);
  assert.equal(g.crown.holder, 'p1');
  g.events.length = 0;
  tap(g, 'p2', 'shove');
  assert.equal(g.crown.holder, null);
  assert.ok(g.events.some((e) => e.k === 'crownDrop'));
  assert.equal(b.crownsKnocked, 1);
  place(a, g.crown.x, g.crown.y);
  g.tick(DT);
  assert.equal(g.crown.holder, null, 'locked out for a moment');
  run(g, g.cfg.lockout + 0.3);
  place(a, g.crown.x, g.crown.y);
  g.tick(DT);
  assert.equal(g.crown.holder, 'p1', 'after the lockout it can be picked up again');
});

test('Crown Chaos: a shoved wearer gets a short shield (no endless bullying)', () => {
  const g = cc(3);
  const [a, b, c] = ['p1', 'p2', 'p3'].map((id) => g.players.get(id));
  place(a, g.crown.x, g.crown.y);
  place(b, a.x - 40, a.y, 1, 0);
  place(c, 100, 288);
  run(g, 0.2);
  tap(g, 'p2', 'shove');
  assert.ok(a.immune > 0.9, `immune for ${a.immune}`);
});

test('Crown Chaos: wearing it too long makes it overheat and fling itself off', () => {
  const g = cc(2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 150, 290);
  place(a, g.crown.x, g.crown.y);
  run(g, 0.2);
  assert.equal(g.crown.holder, 'p1');
  g.events.length = 0;
  run(g, g.cfg.overheat + 0.5);
  assert.ok(g.events.some((e) => e.k === 'overheat'), 'overheat event');
  assert.notEqual(g.crown.holder, 'p1', 'it left the wearer');
  assert.ok(a.longest >= g.cfg.overheat - 0.2);
});

test('Crown Chaos: the hot variant overheats sooner', () => {
  assert.ok(CrownChaos.VARIANTS.hot.overheat < CrownChaos.TUNING.overheat);
});

test('Crown Chaos: a flying crown stays inside the arena', () => {
  const g = cc(2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 150, 290);
  for (let i = 0; i < 12; i++) {
    place(a, g.crown.x, g.crown.y);
    run(g, 0.2);
    g.crown.holder = null;
    g.crown.vx = 400;
    g.crown.vy = -400;
    g.crown.lockId = a.id;
    g.crown.lockUntil = g.time + 5;
    run(g, 1.5);
    assert.ok(ArenaGame.walkable(g.crown.x, g.crown.y), `crown at ${g.crown.x},${g.crown.y}`);
  }
});

test('Crown Chaos: if the wearer leaves, the crown is free for somebody else', () => {
  const g = cc(3);
  const a = g.players.get('p1');
  place(a, g.crown.x, g.crown.y);
  place(g.players.get('p2'), 100, 288);
  place(g.players.get('p3'), 800, 288);
  run(g, 0.2);
  assert.equal(g.crown.holder, 'p1');
  g.removePlayer('p1');
  assert.equal(g.crown.holder, null);
});

test('Crown Chaos: a player in the air cannot pick the crown up', () => {
  const g = cc(2);
  const a = g.players.get('p1');
  place(g.players.get('p2'), 150, 290);
  place(a, g.crown.x, g.crown.y);
  a.z = 50;
  a.vz = 0;
  g._tryPickup();
  assert.equal(g.crown.holder, null);
});

test('Crown Chaos: the most crown time wins; a player who never wore it gets no title for it', () => {
  const g = cc(3);
  g.players.get('p1').held = 14.2;
  g.players.get('p2').held = 6;
  g.players.get('p3').held = 0.2;
  g.time = g.cfg.maxTime - 0.01;
  run(g, 0.1);
  const rows = g.results();
  assert.deepEqual(rows.map((r) => r.id), ['p1', 'p2', 'p3']);
  assert.equal(rows[0].title, 'Crown Hog');
  assert.equal(rows[2].title, 'Never Royal');
});

test('Crown Chaos: solo practice works (the crown can be worn and overheats)', () => {
  const g = cc(1);
  const a = g.players.get('p1');
  place(a, g.crown.x, g.crown.y);
  run(g, 12);
  assert.ok(a.held > 5);
  assert.ok(!g.isFinished());
});

test('the schedule now knows every new game and still never repeats one back-to-back', () => {
  for (let trial = 0; trial < 100; trial++) {
    const sched = games.buildSchedule(13, seeded(trial + 31));
    assert.equal(new Set(sched.map((s) => s.game)).size, 13, 'all thirteen games in a 13-round match');
    for (let i = 1; i < sched.length; i++) assert.notEqual(sched[i].game, sched[i - 1].game);
  }
});
