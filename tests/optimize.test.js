'use strict';

// Tests for the lag/size optimizations (v0.12.3): the smaller snapshot format (server/snapcodec.js and its
// browser copy public/js/snapcodec.js). Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const games = require('../server/games');
const { encodeSnap, decodeSnap } = require('../server/snapcodec');

const DT = 1 / 30;
const loadClientCodec = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'snapcodec.js')).href);

function playedGame(id, variant = 'classic', n = 8) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push({ id: `player${i}abc`, name: `P${i}` });
  const g = new games.GAMES[id](parts, variant, {});
  g.time = 0.5;
  for (let i = 0; i < 90; i++) {
    for (const p of parts) g.setInput(p.id, { mx: Math.sin(i / 17 + p.id.length), my: Math.cos(i / 11), jump: i % 37 === 0, shove: i % 53 === 0 });
    g.tick(DT);
    if (i < 89) g.snapshot(); // like the server, hand out a picture every step (this also empties the event list)
  }
  return g;
}

test('snapshots: encode then decode gives back exactly the same snapshot, for every minigame', () => {
  for (const id of Object.keys(games.GAMES)) {
    const g = playedGame(id);
    const ids = [...g.players.keys()];
    const snaps = g.perViewer ? [...g.snapshotsByViewer(ids).values()] : [g.snapshot()];
    for (const snap of snaps) {
      const wire = JSON.parse(JSON.stringify(encodeSnap(snap))); // what really crosses the network
      const back = decodeSnap(wire);
      assert.deepEqual(back, JSON.parse(JSON.stringify(snap)), `${id}: same after a round trip`);
    }
  }
});

test('snapshots: the smaller format is clearly smaller (under 65% of the size with 8 players)', () => {
  let before = 0;
  let after = 0;
  for (const id of Object.keys(games.GAMES)) {
    const snap = playedGame(id).snapshot(`player0abc`);
    before += JSON.stringify(snap).length;
    after += JSON.stringify(encodeSnap(snap)).length;
    assert.ok(JSON.stringify(encodeSnap(snap)).length < JSON.stringify(snap).length, `${id} got smaller`);
  }
  assert.ok(after < before * 0.65, `total ${after} vs ${before} bytes (${((after / before) * 100).toFixed(0)}%)`);
});

test('snapshots: players with different fields, missing fields, zeros, false and empty lists all survive', () => {
  const snap = { t: 1, ps: [{ id: 'a', x: 0, y: 1.5, st: 'alive', fl: false, list: [] }, { id: 'b', x: 2, extra: { k: 1 }, z: 0 }], ev: [] };
  const back = decodeSnap(JSON.parse(JSON.stringify(encodeSnap(snap))));
  assert.deepEqual(back, snap);
  // snapshots without players (or already plain) pass through untouched
  const empty = { t: 3, ps: [] };
  assert.equal(encodeSnap(empty), empty);
  assert.equal(decodeSnap(empty), empty);
  assert.equal(decodeSnap(null), null);
  assert.equal(decodeSnap(undefined), undefined);
});

test('snapshots: the browser copy of the decoder gives the same answer as the server copy', async () => {
  const client = await loadClientCodec();
  for (const id of ['crumbleFloor', 'goldGrab', 'lapDash', 'propHunt']) {
    const g = playedGame(id);
    const snap = g.perViewer ? g.snapshotsByViewer([...g.players.keys()]).get('player0abc') : g.snapshot();
    const wire = JSON.parse(JSON.stringify(encodeSnap(snap)));
    assert.deepEqual(client.decodeSnap(wire), decodeSnap(wire), id);
  }
  assert.equal(client.decodeSnap(null), null);
});

test('network: a real round sends the smaller snapshots (pk/pv), and the server marks them droppable (volatile)', async () => {
  const { io } = require('socket.io-client');
  const { createGameServer } = require('../server/app');
  const server = createGameServer({ quiet: true, config: { INTRO_MS: 100, SCHEDULE_OVERRIDE: [{ game: 'goldGrab', variant: 'classic' }] } });
  const port = await server.start(0, '127.0.0.1');
  const sock = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  const seen = [];
  sock.on('game:snap', (s) => seen.push(s));
  try {
    await new Promise((resolve) => sock.once('connect', resolve));
    const created = await new Promise((resolve) => sock.emit('room:create', { name: 'Solo' }, resolve));
    assert.equal(created.ok, true);
    await new Promise((resolve) => sock.emit('room:rounds', 1, resolve));
    await new Promise((resolve) => sock.emit('match:start', null, resolve));
    for (let i = 0; i < 300 && seen.length < 20; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(seen.length >= 10, `got snapshots (${seen.length})`);
    const s = seen[seen.length - 1];
    assert.ok(Array.isArray(s.pk) && Array.isArray(s.pv) && !s.ps, 'wire format is the compact one');
    assert.equal(decodeSnap(s).ps.length, 1);
    assert.equal(decodeSnap(s).ps[0].id, created.playerId);
  } finally {
    sock.close();
    await server.stop();
  }
});
