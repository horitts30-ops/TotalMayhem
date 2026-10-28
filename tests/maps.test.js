'use strict';

// Tests for the map system (server/maps.js) and how the minigames use it.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const games = require('../server/games');
const ArenaGame = require('../server/games/arenaBase');
const { MAPS, MAP_IDS, getMap, mapChoices, chooseMap, TILE, COLS, ROWS } = require('../server/maps');
const { Room } = require('../server/room');
const BASE = require('../server/config');

const DT = 1 / 30;
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
const parts = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
const MAP_GAMES = Object.keys(games.GAMES).filter((g) => games.GAMES[g].MAP_OK);

function connectedTiles(solid) {
  const start = solid.indexOf(true);
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const j = nr * COLS + nc;
      if (solid[j] && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size;
}

test('there are 10 new maps plus the classic one, with unique ids and names', () => {
  assert.equal(MAP_IDS.length, 11);
  assert.equal(new Set(MAP_IDS).size, 11);
  assert.equal(new Set(MAP_IDS.map((id) => MAPS[id].name)).size, 11);
  assert.equal(mapChoices().length, 11);
  assert.equal(getMap('nonsense').id, 'classic');
  assert.equal(getMap(undefined).id, 'classic');
});

test('every map is a 14x9 grid, one connected piece, with room for 8 players', () => {
  for (const id of MAP_IDS) {
    const m = MAPS[id];
    assert.equal(m.rows.length, ROWS, id);
    for (const row of m.rows) assert.match(row, /^[#.]{14}$/, `${id}: ${row}`);
    const tiles = m.solid.filter(Boolean).length;
    assert.ok(tiles >= 30, `${id} has only ${tiles} tiles`);
    assert.equal(connectedTiles(m.solid), tiles, `${id} has a piece that cannot be reached`);
  }
});

test('the classic map is exactly the old oval floor', () => {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      assert.equal(MAPS.classic.walkable(x, y), ArenaGame.walkable(x, y), `${c},${r}`);
    }
  }
  assert.equal(MAPS.classic.spawns, null);
});

test('spawn points and centres are standable, distinct and spread out', () => {
  for (const id of MAP_IDS) {
    const m = MAPS[id];
    assert.ok(m.walkable(m.center.x, m.center.y), `${id} centre`);
    if (!m.spawns) continue;
    assert.equal(m.spawns.length, 8, id);
    for (const s of m.spawns) assert.ok(m.walkable(s.x, s.y), `${id} spawn`);
    const keys = new Set(m.spawns.map((s) => `${s.x},${s.y}`));
    assert.equal(keys.size, 8, `${id}: two players would start on the same tile`);
    for (let a = 0; a < 8; a++) {
      for (let b = a + 1; b < 8; b++) {
        assert.ok(Math.hypot(m.spawns[a].x - m.spawns[b].x, m.spawns[a].y - m.spawns[b].y) >= TILE - 1, `${id}: ${a} and ${b} too close`);
      }
    }
  }
});

test('walkable matches the picture: nobody can stand on an empty tile', () => {
  for (const id of MAP_IDS) {
    const m = MAPS[id];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * TILE + TILE / 2;
        const y = r * TILE + TILE / 2;
        assert.equal(m.walkable(x, y), m.rows[r][c] === '#', `${id} ${c},${r}`);
      }
    }
  }
});

test('the nine minigames that use maps are marked, the other four are not', () => {
  assert.deepEqual(
    MAP_GAMES.sort(),
    ['crownChaos', 'crumbleFloor', 'digDash', 'goldGrab', 'hillHustle', 'hotPotato', 'meteorMayhem', 'paintPanic', 'propHunt'].sort()
  );
  for (const g of ['colorCall', 'jumpRope', 'lapDash', 'moleStomp']) assert.ok(!games.GAMES[g].MAP_OK, g);
});

test('chooseMap: a host pick is respected, random mixes, junk falls back to random', () => {
  assert.equal(chooseMap('donut'), 'donut');
  const seen = new Set();
  const rng = seeded(7);
  for (let i = 0; i < 400; i++) seen.add(chooseMap('random', rng));
  assert.equal(seen.size, 11, 'random should reach every map');
  assert.ok(MAP_IDS.includes(chooseMap('bogus', rng)));
  assert.ok(MAP_IDS.includes(chooseMap(undefined, rng)));
});

// The big one: every map x every map-using minigame, with 8 players mashing buttons.
test('every map works in every minigame that uses maps (8 players, 25 seconds each, nobody leaves the floor)', () => {
  for (const gid of MAP_GAMES) {
    const Game = games.GAMES[gid];
    for (const mapId of MAP_IDS) {
      for (const rage of [false, true]) {
        const rng = seeded(11);
        const g = new Game(parts(8), 'classic', { rng: seeded(3), mapId, rage });
        g.time = 0.5;
        const map = getMap(mapId);
        const ids = [...g.players.keys()];
        for (let i = 0; i < Math.round(25 / DT); i++) {
          if (i % 6 === 0) {
            for (const id of ids) g.setInput(id, { mx: Math.round(rng() * 2 - 1), my: Math.round(rng() * 2 - 1), jump: rng() < 0.15, shove: rng() < 0.3 });
          }
          g.tick(DT);
          if (gid === 'crumbleFloor') continue; // there you CAN fall; that is the game
          for (const p of g.players.values()) {
            if (p.state !== 'alive') continue;
            assert.ok(map.walkable(p.x, p.y), `${gid} on ${mapId}: ${p.id} at ${p.x | 0},${p.y | 0} is off the floor`);
          }
        }
        assert.ok(Number.isFinite(g.snapshot('p1').t), `${gid}/${mapId}`);
      }
    }
  }
});

test('players start on the map spawn points and face the middle', () => {
  const g = new (games.GAMES.goldGrab)(parts(4), 'classic', { rng: seeded(1), mapId: 'plus' });
  const sp = MAPS.plus.spawns;
  [...g.players.values()].forEach((p, i) => {
    assert.equal(p.x, sp[i].x);
    assert.equal(p.y, sp[i].y);
  });
});

test('Hill Hustle and Crown Chaos start in the middle of the map even when the middle is a hole', () => {
  const hill = new (games.GAMES.hillHustle)(parts(3), 'classic', { rng: seeded(1), mapId: 'donut' });
  assert.ok(MAPS.donut.walkable(hill.zone.x, hill.zone.y));
  const crown = new (games.GAMES.crownChaos)(parts(3), 'classic', { rng: seeded(1), mapId: 'donut' });
  assert.ok(MAPS.donut.walkable(crown.crown.x, crown.crown.y));
});

test('Paint Panic only lets you paint tiles that exist on the chosen map', () => {
  const g = new (games.GAMES.paintPanic)(parts(2), 'classic', { rng: seeded(1), mapId: 'cheese' });
  let paintable = 0;
  g.paintable.forEach((on, i) => {
    assert.equal(on, MAPS.cheese.solid[i], `tile ${i}`);
    if (on) paintable++;
  });
  assert.equal(paintable, MAPS.cheese.solid.filter(Boolean).length);
});

test('Crumble Floor starts with the chosen map as its floor', () => {
  const g = new (games.GAMES.crumbleFloor)(parts(3), 'classic', { rng: seeded(1), mapId: 'frame' });
  const s = g.snapshot('p1');
  const str = typeof s.tiles === 'string' ? s.tiles : null;
  assert.ok(str, 'snapshot has a tile string');
  for (let i = 0; i < MAPS.frame.solid.length; i++) {
    assert.equal(str[i] === '_', !MAPS.frame.solid[i], `tile ${i}`);
  }
});

test('games without a map option still behave exactly as before (classic)', () => {
  const g = new (games.GAMES.goldGrab)(parts(2), 'classic', { rng: seeded(1) });
  assert.equal(g.map.id, 'classic');
  assert.ok(g.canStand(448, 288));
  assert.ok(!g.canStand(5, 5));
});

// ------------------------------------------------------------- room level
function fakeRoom() {
  const io = { to: () => ({ emit() {} }), emit() {} };
  const room = new Room(io, 'TEST', { ...BASE }, { rng: seeded(5) });
  return room;
}

test('the room: only the host picks, only between matches, only real maps', () => {
  const room = fakeRoom();
  room.hostId = 'h';
  assert.equal(room.setMap('x', 'donut'), 'Only the host can change that.');
  assert.equal(room.setMap('h', 'nope'), 'No such map.');
  assert.equal(room.setMap('h', undefined), 'No such map.');
  assert.equal(room.setMap('h', 'donut'), null);
  assert.equal(room.mapPick, 'donut');
  assert.equal(room.publicState().mapPick, 'donut');
  room.phase = 'playing';
  assert.match(room.setMap('h', 'plus'), /between matches/);
  assert.equal(room.mapPick, 'donut');
});

test('the room: a pinned map reaches the arena info; fixed-arena games get no map', () => {
  const room = fakeRoom();
  room.hostId = 'h';
  room.setMap('h', 'hourglass');
  room.schedule = [{ game: 'goldGrab', variant: 'classic' }, { game: 'moleStomp', variant: 'classic' }];
  room.round = 0;
  room.beginIntro();
  assert.equal(room.mapId, 'hourglass');
  assert.deepEqual(room.arena.floor, MAPS.hourglass.rows);
  assert.equal(room.arena.mapName, 'Hourglass');
  assert.match(room.intro.instructions[0], /Hourglass/);
  room.beginIntro();
  assert.equal(room.mapId, null);
  assert.equal(room.arena.floor, undefined);
});

// ------------------------------------------------------------- client side
test('client prediction uses the same floor rule as the server for every map', async () => {
  const { walkableFor, arenaWalkable } = await import(pathToFileURL(path.join(__dirname, '../public/js/predict.js')).href);
  assert.equal(walkableFor(undefined), arenaWalkable);
  for (const id of MAP_IDS) {
    const fn = walkableFor(MAPS[id].rows);
    for (let y = 0; y < 576; y += 13) {
      for (let x = 0; x < 896; x += 13) assert.equal(fn(x, y), MAPS[id].walkable(x, y), `${id} ${x},${y}`);
    }
  }
});

// ------------------------------------------------------------- real network
test('network: /api/maps lists the maps; the host picks one and the match really plays on it', async () => {
  const { io } = require('socket.io-client');
  const { createGameServer } = require('../server/app');
  const server = createGameServer({
    quiet: true,
    config: { INTRO_MS: 150, RESULTS_MS: 250, ROUND_END_DELAY_MS: 100, SCHEDULE_OVERRIDE: [{ game: 'goldGrab', variant: 'classic' }] },
  });
  const port = await server.start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}`;
  const sock = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const connected = new Promise((r) => sock.once('connect', r)); // listen BEFORE the first await, or the event can be missed
  try {
    const list = await (await fetch(`${url}/api/maps`)).json();
    assert.equal(list.length, 11);
    assert.ok(list.every((m) => m.id && m.name && m.note && !m.rows), 'only the names go over /api/maps');

    await connected;
    const ask = (ev, data) => new Promise((r, j) => { const t = setTimeout(() => j(new Error('no answer to ' + ev)), 3000); sock.emit(ev, data, (x) => { clearTimeout(t); r(x); }); });
    let state = null;
    sock.on('room:state', (s) => (state = s));
    const made = await ask('room:create', { name: 'Hosty' });
    assert.ok(made.ok, JSON.stringify(made));
    assert.equal((await ask('room:map', 'nope')).ok, false);
    assert.equal((await ask('room:map', 42)).ok, false);
    const ok = await ask('room:map', 'peaks');
    assert.equal(ok.ok, true);
    assert.equal(ok.mapPick, 'peaks');
    const deadline = Date.now() + 5000;
    while (!(state && state.mapPick === 'peaks') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.equal(state.mapPick, 'peaks');
    assert.ok((await ask('match:start')).ok);
    while (!(state && state.phase === 'intro') && Date.now() < deadline + 5000) await new Promise((r) => setTimeout(r, 20));
    assert.equal(state.arena.mapId, 'peaks');
    assert.deepEqual(state.arena.floor, MAPS.peaks.rows);
  } finally {
    sock.close();
    await server.stop();
  }
});
