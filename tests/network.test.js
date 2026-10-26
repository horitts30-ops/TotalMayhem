'use strict';

// Tests that use REAL network connections: a real server on a random port and
// real Socket.IO clients, just like browsers would be.
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createGameServer } = require('../server/app');

// ---------------------------------------------------------------- helpers
async function startServer(config = {}, gameOptions = {}) {
  const server = createGameServer({
    quiet: true,
    config: {
      INTRO_MS: 150,
      RESULTS_MS: 250,
      ROUND_END_DELAY_MS: 100,
      // Pin the schedule so these tests always play Crumble Floor (the match
      // schedule itself is random and has its own tests).
      SCHEDULE_OVERRIDE: [{ game: 'crumbleFloor', variant: 'classic' }],
      ...config,
    },
    gameOptions,
  });
  const port = await server.start(0, '127.0.0.1');
  return { server, url: `http://127.0.0.1:${port}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const sock = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    sock.state = null;
    sock.phases = [];
    sock.snaps = [];
    sock.on('room:state', (s) => {
      sock.state = s;
      if (sock.phases[sock.phases.length - 1] !== s.phase) sock.phases.push(s.phase);
    });
    sock.on('game:snap', (s) => {
      sock.snaps.push(s);
      if (sock.snaps.length > 400) sock.snaps.shift();
    });
    sock.once('connect', () => resolve(sock));
    sock.once('connect_error', reject);
  });
}

const ask = (sock, event, data) => new Promise((resolve) => sock.emit(event, data, resolve));

async function until(fn, ms = 8000, what = 'condition') {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = fn();
    if (v) return v;
    await sleep(15);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function withServer(config, gameOptions, body) {
  const { server, url } = await startServer(config, gameOptions);
  const sockets = [];
  const mk = async () => {
    const s = await connect(url);
    sockets.push(s);
    return s;
  };
  try {
    await body({ server, url, mk });
  } finally {
    sockets.forEach((s) => s.close());
    await server.stop();
  }
}

// ------------------------------------------------------------------ tests
test('create a room, join with the code (any case), names are de-duplicated', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const a = await mk();
    const b = await mk();
    const created = await ask(a, 'room:create', { name: 'Sam', color: 2, hat: 3 });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[BCDFGHJKMNPQRSTVWXZ]{4}$/);
    assert.ok(created.token && created.playerId);

    const joined = await ask(b, 'room:join', { code: created.code.toLowerCase(), name: 'Sam', color: 1, hat: 0 });
    assert.equal(joined.ok, true);

    await until(() => a.state && a.state.players.length === 2, 3000, 'two players in lobby');
    const names = a.state.players.map((p) => p.name).sort();
    assert.deepEqual(names, ['Sam', 'Sam 2']);
    assert.equal(a.state.hostId, created.playerId);
    assert.equal(a.state.phase, 'lobby');
    assert.equal(b.state.players.length, 2);
  });
});

test('joining with a wrong or malformed code fails with a friendly error', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const a = await mk();
    for (const code of ['ZZZZ', 'ab', '', null, 12345, { evil: true }]) {
      const res = await ask(a, 'room:join', { code, name: 'X' });
      assert.equal(res.ok, false);
      assert.ok(typeof res.error === 'string' && res.error.length > 0);
    }
    const res = await ask(a, 'room:join', 'not even an object');
    assert.equal(res.ok, false);
  });
});

test('a room holds at most 8 players', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const host = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Host' });
    for (let i = 1; i < 8; i++) {
      const s = await mk();
      const r = await ask(s, 'room:join', { code, name: `P${i}` });
      assert.equal(r.ok, true, `player ${i + 1} should fit`);
    }
    const ninth = await mk();
    const r = await ask(ninth, 'room:join', { code, name: 'Late' });
    assert.equal(r.ok, false);
    assert.match(r.error, /full/i);
  });
});

test('names are cleaned and cosmetics are range-checked', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const a = await mk();
    const r = await ask(a, 'room:create', {
      name: '  <b>Eve</b>\u0000\u0007 with an extremely long name  ',
      color: 9999,
      hat: -5,
      skin: 12345,
    });
    assert.equal(r.ok, true);
    await until(() => a.state, 2000, 'state');
    const me = a.state.players[0];
    assert.ok(me.name.length <= 14);
    assert.ok(!/[<>\u0000-\u001f]/.test(me.name));
    assert.ok(me.color >= 0 && me.color <= 11);
    assert.ok(me.hat >= 0 && me.hat <= 15);
    assert.ok(Number.isInteger(me.skin) && me.skin >= 0 && me.skin <= 7);

    // Valid choices go through, junk is ignored or clamped.
    a.emit('room:customize', { color: 11, hat: 15, skin: 3 });
    await until(() => a.state.players[0].hat === 15, 2000, 'cosmetics change');
    assert.equal(a.state.players[0].color, 11);
    assert.equal(a.state.players[0].skin, 3);
    a.emit('room:customize', { color: 'red', hat: {}, skin: [1, 2] });
    await sleep(100);
    assert.ok(a.state.players[0].skin >= 0 && a.state.players[0].skin <= 7);
    assert.ok(a.state.players[0].hat >= 0 && a.state.players[0].hat <= 15);

    const blank = await mk();
    const r2 = await ask(blank, 'room:create', { name: '   ' });
    assert.equal(r2.ok, true);
    await until(() => blank.state, 2000, 'state');
    assert.ok(blank.state.players[0].name.length > 0, 'a silly default name is assigned');
  });
});

test('only the host can start the match or change the round count', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Host' });
    await ask(guest, 'room:join', { code, name: 'Guest' });
    await until(() => host.state && host.state.players.length === 2, 3000, 'both joined');

    const bad = await ask(guest, 'match:start', null);
    assert.equal(bad.ok, false);
    const badRounds = await ask(guest, 'room:rounds', 1);
    assert.equal(badRounds.ok, false);

    const invalid = await ask(host, 'room:rounds', 7);
    assert.equal(invalid.ok, false, '7 rounds is not an allowed option');
    const good = await ask(host, 'room:rounds', 1);
    assert.equal(good.ok, true);
    await until(() => guest.state.rounds === 1, 2000, 'rounds update reaches guest');

    assert.equal(host.state.phase, 'lobby');
  });
});

test('ready flags are shared with everyone in the room', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Host' });
    const j = await ask(guest, 'room:join', { code, name: 'Guest' });
    guest.emit('room:ready', true);
    await until(() => host.state.players.find((p) => p.id === j.playerId && p.ready), 2000, 'ready visible');
    guest.emit('room:ready', false);
    await until(() => host.state.players.find((p) => p.id === j.playerId && !p.ready), 2000, 'unready visible');
  });
});

test('a complete 1-round match: intro -> playing -> results -> final; scores come from the server', async () => {
  // timeScale makes the game run 25x faster so the test takes a couple of seconds.
  await withServer({}, { timeScale: 25 }, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const { code, playerId: hostId } = await ask(host, 'room:create', { name: 'Host' });
    const { playerId: guestId } = await ask(guest, 'room:join', { code, name: 'Guest' });
    await ask(host, 'room:rounds', 1);
    await until(() => host.state.players.length === 2, 2000, 'both joined');

    const started = await ask(host, 'match:start', null);
    assert.equal(started.ok, true);

    await until(() => guest.state.phase === 'final', 15000, 'final scoreboard');

    // The phases happened in the right order for both players.
    for (const s of [host, guest]) {
      const order = s.phases.filter((p) => ['lobby', 'intro', 'playing', 'results', 'final'].includes(p));
      assert.deepEqual(order, ['lobby', 'intro', 'playing', 'results', 'final']);
    }

    // Both clients received world snapshots containing both players.
    assert.ok(host.snaps.length > 3, `host got ${host.snaps.length} snapshots`);
    assert.ok(host.snaps.some((s) => s.ps.length === 2));
    assert.match(host.snaps[0].tiles, /^[0-9x_]+$/);

    // Final standings are consistent with the round results.
    const f = host.state.final;
    assert.equal(f.standings.length, 2);
    const total = f.standings.reduce((n, s) => n + s.score, 0);
    assert.ok(total > 0, 'points were awarded');
    assert.ok(f.standings[0].score >= f.standings[1].score, 'sorted best-first');
    assert.deepEqual(guest.state.final, host.state.final, 'everyone sees the same result');
    assert.ok([hostId, guestId].includes(f.winners[0]));
  });
});

test('"play again" restarts the match with fresh scores; "back to lobby" returns to the lobby', async () => {
  await withServer({}, { timeScale: 25 }, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Host' });
    await ask(guest, 'room:join', { code, name: 'Guest' });
    await ask(host, 'room:rounds', 1);
    await ask(host, 'match:start', null);
    await until(() => host.state.phase === 'final', 15000, 'first final');

    // Guests cannot restart.
    assert.equal((await ask(guest, 'match:start', null)).ok, false);
    assert.equal((await ask(guest, 'match:toLobby', null)).ok, false);

    assert.equal((await ask(host, 'match:start', null)).ok, true);
    await until(() => host.state.phase === 'intro', 3000, 'second match intro');
    assert.ok(host.state.players.every((p) => p.score === 0), 'scores reset for the new match');
    await until(() => host.state.phase === 'final', 15000, 'second final');

    assert.equal((await ask(host, 'match:toLobby', null)).ok, true);
    await until(() => host.state.phase === 'lobby' && guest.state.phase === 'lobby', 3000, 'back in lobby');
  });
});

test('clients cannot give themselves points or poke at server-only events', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const host = await mk();
    const { code, playerId } = await ask(host, 'room:create', { name: 'Cheater' });
    await until(() => host.state, 2000, 'state');

    // None of these events exist on the server, so nothing should happen.
    host.emit('game:score', { points: 999 });
    host.emit('results', { rows: [] });
    host.emit('player:setScore', { id: playerId, score: 1000 });
    host.emit('room:state', { phase: 'final' });
    host.emit('__proto__', { admin: true });
    host.emit('room:customize', { score: 5000, hat: 2, __proto__: { polluted: true } });
    await sleep(150);

    assert.equal(host.state.players[0].score, 0);
    assert.equal(host.state.phase, 'lobby');
    assert.equal({}.polluted, undefined, 'no prototype pollution');

    // Outside of a round, game inputs are ignored; the server must still be healthy.
    for (let i = 0; i < 50; i++) host.emit('game:input', { mx: 1e9, my: NaN, jump: 'yes', shove: {} });
    host.emit('game:input', 'garbage');
    host.emit('game:input', null);
    const again = await ask(host, 'room:rounds', 3);
    assert.equal(again.ok, true, 'server still answers after the junk');
    assert.equal(code.length, 4);
  });
});

test('flooding game:input does not break the server', async () => {
  await withServer({}, { timeScale: 1 }, async ({ mk }) => {
    const host = await mk();
    await ask(host, 'room:create', { name: 'Spammer' });
    await ask(host, 'match:start', null);
    await until(() => host.state.phase === 'playing', 5000, 'playing');
    for (let i = 0; i < 3000; i++) host.emit('game:input', { mx: Math.random() * 2 - 1, my: 1, jump: i % 2 === 0, shove: i % 3 === 0 });
    await sleep(300);
    assert.ok(host.snaps.length > 0);
    const last = host.snaps[host.snaps.length - 1];
    for (const p of last.ps) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  });
});

test('a player who joins mid-round watches, then plays the next round', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Host' });
    await ask(guest, 'room:join', { code, name: 'Guest' });
    await ask(host, 'match:start', null);
    await until(() => host.state.phase === 'playing', 5000, 'playing');
    const countBefore = host.snaps.length;

    const late = await mk();
    const joined = await ask(late, 'room:join', { code, name: 'Latecomer' });
    assert.equal(joined.ok, true);
    assert.equal(joined.lateJoin, true);

    await until(() => late.state && late.state.phase === 'playing', 3000, 'late joiner sees the round');
    const me = late.state.players.find((p) => p.id === joined.playerId);
    assert.equal(me.inRound, false, 'not part of the running round');

    await until(() => late.snaps.length > 2, 3000, 'late joiner receives snapshots to watch');
    assert.ok(late.snaps[late.snaps.length - 1].ps.every((p) => p.id !== joined.playerId));
    assert.ok(host.snaps.length > countBefore);

    // Late joiners cannot affect the game.
    late.emit('game:input', { mx: 1, my: 1, jump: true, shove: true });
    await sleep(100);
  });
});

test('disconnect in the lobby: seat is kept for a while, reconnecting restores it, host passes on', async () => {
  await withServer({}, {}, async ({ mk, url }) => {
    const host = await mk();
    const guest = await mk();
    const c = await ask(host, 'room:create', { name: 'Host' });
    const j = await ask(guest, 'room:join', { code: c.code, name: 'Guest' });
    await until(() => host.state.players.length === 2, 2000, 'two players');

    // Guest drops.
    guest.close();
    await until(() => {
      const g = host.state.players.find((p) => p.id === j.playerId);
      return g && g.connected === false;
    }, 3000, 'guest marked as disconnected');
    assert.equal(host.state.players.length, 2, 'seat is still held');

    // Guest comes back with the saved token (what a page refresh does).
    const back = await connect(url);
    const rej = await ask(back, 'room:rejoin', { code: c.code, token: j.token });
    assert.equal(rej.ok, true);
    assert.equal(rej.playerId, j.playerId, 'same player');
    await until(() => host.state.players.find((p) => p.id === j.playerId).connected, 3000, 'reconnected');

    // Wrong token is refused.
    const stranger = await connect(url);
    const bad = await ask(stranger, 'room:rejoin', { code: c.code, token: 'definitely-not-the-token' });
    assert.equal(bad.ok, false);

    // Host drops -> the remaining player becomes host.
    host.close();
    await until(() => back.state && back.state.hostId === j.playerId, 3000, 'host passed to the guest');
    back.close();
    stranger.close();
  });
});

test('seat expires after the grace period; empty rooms are cleaned up', async () => {
  await withServer({ RECONNECT_GRACE_MS: 150, EMPTY_ROOM_TTL_MS: 150 }, {}, async ({ server, mk }) => {
    const host = await mk();
    const guest = await mk();
    const c = await ask(host, 'room:create', { name: 'Host' });
    await ask(guest, 'room:join', { code: c.code, name: 'Guest' });
    await until(() => host.state.players.length === 2, 2000, 'two players');

    guest.close();
    await until(() => host.state.players.length === 1, 3000, 'guest seat released after the grace period');

    host.close();
    await until(() => server.manager.rooms.size === 0, 3000, 'empty room removed');
  });
});

test('leaving a room on purpose frees the seat immediately', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const c = await ask(host, 'room:create', { name: 'Host' });
    await ask(guest, 'room:join', { code: c.code, name: 'Guest' });
    await until(() => host.state.players.length === 2, 2000, 'two');
    assert.equal((await ask(guest, 'room:leave', null)).ok, true);
    await until(() => host.state.players.length === 1, 2000, 'guest gone from host view');
  });
});

test('a player leaving mid-round does not break the round for the others', async () => {
  await withServer({}, { timeScale: 12 }, async ({ mk }) => {
    const a = await mk();
    const b = await mk();
    const c = await mk();
    const room = await ask(a, 'room:create', { name: 'A' });
    await ask(b, 'room:join', { code: room.code, name: 'B' });
    await ask(c, 'room:join', { code: room.code, name: 'C' });
    await ask(a, 'room:rounds', 1);
    await ask(a, 'match:start', null);
    await until(() => a.state.phase === 'playing', 5000, 'playing');

    assert.equal((await ask(c, 'room:leave', null)).ok, true);

    await until(() => a.state.phase === 'results' || a.state.phase === 'final', 20000, 'round still completes');
    await until(() => a.state.phase === 'final', 8000, 'final');
    assert.equal(a.state.final.standings.length, 2, 'the leaver is not in the final standings');
  });
});

test('a player who loses connection mid-round is treated as out and scores nothing for the round', async () => {
  await withServer({}, { timeScale: 12 }, async ({ mk }) => {
    const a = await mk();
    const b = await mk();
    const room = await ask(a, 'room:create', { name: 'A' });
    const jb = await ask(b, 'room:join', { code: room.code, name: 'B' });
    await ask(a, 'room:rounds', 1);
    await ask(a, 'match:start', null);
    await until(() => a.state.phase === 'playing', 5000, 'playing');
    await until(() => a.snaps.length > 0, 3000, 'snapshots flowing');

    b.close();
    await until(() => a.state.phase === 'results', 20000, 'results after the other player vanished');
    const rows = a.state.results.rows;
    const rb = rows.find((r) => r.id === jb.playerId);
    assert.equal(rb.points, 0);
    assert.equal(rb.abandoned, true);
    const ra = rows.find((r) => r.id !== jb.playerId);
    assert.ok(ra.points > 0);
  });
});

test('duplicate / repeated messages cannot create duplicate rooms or double-score', async () => {
  await withServer({}, { timeScale: 25 }, async ({ server, mk }) => {
    const a = await mk();
    const first = await ask(a, 'room:create', { name: 'A' });
    const second = await ask(a, 'room:create', { name: 'A' }); // same socket creates again
    assert.equal(first.ok && second.ok, true);
    assert.notEqual(first.code, second.code);
    await until(() => server.manager.rooms.size === 1, 2000, 'old room is cleaned up when the player moves on');

    await ask(a, 'room:rounds', 1);
    // Hammer "start" many times at once: only one match may begin.
    const results = await Promise.all(Array.from({ length: 10 }, () => ask(a, 'match:start', null)));
    assert.equal(results.filter((r) => r.ok).length, 1);
    await until(() => a.state.phase === 'final', 15000, 'final');
    const me = a.state.final.standings[0];
    assert.ok(me.score <= 12, `score is bounded by one round's maximum (got ${me.score})`);
  });
});

test('a match can mix minigames: every game type runs over the network and scores come from the server', async () => {
  const schedule = [
    { game: 'crumbleFloor', variant: 'moon' },
    { game: 'goldGrab', variant: 'classic' },
    { game: 'hotPotato', variant: 'icy' },
    { game: 'hillHustle', variant: 'moving' },
    { game: 'goldGrab', variant: 'jackpot' },
  ];
  await withServer({ SCHEDULE_OVERRIDE: schedule, ALLOWED_ROUNDS: [1, 3, 5] }, { timeScale: 25 }, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Host' });
    await ask(guest, 'room:join', { code, name: 'Guest' });
    assert.equal((await ask(host, 'room:rounds', 5)).ok, true);
    await until(() => host.state.players.length === 2, 2000, 'both joined');
    assert.equal((await ask(host, 'match:start', null)).ok, true);

    const seen = [];
    let lastRound = 0;
    const started = Date.now();
    while (host.state.phase !== 'final' && Date.now() - started < 40000) {
      if (host.state.phase === 'intro' && host.state.round !== lastRound) {
        lastRound = host.state.round;
        seen.push(host.state.intro.gameId + ':' + host.state.intro.variantId);
        // the intro card carries what the client needs for every game
        assert.ok(host.state.intro.name && host.state.intro.instructions.length >= 3);
        assert.ok(host.state.arena.maxTime > 0);
      }
      if (host.state.phase === 'playing') {
        host.emit('game:input', { mx: Math.random() * 2 - 1, my: Math.random() * 2 - 1, jump: Math.random() < 0.2, shove: Math.random() < 0.3 });
      }
      await sleep(20);
    }
    assert.equal(host.state.phase, 'final', 'the match finished');
    assert.deepEqual(seen, schedule.map((s) => s.game + ':' + s.variant));

    // every kind of game sent snapshots with the shared player fields
    const gids = new Set(host.snaps.map((s) => s.gid).filter(Boolean));
    assert.ok(gids.size >= 1);
    const f = host.state.final;
    assert.equal(f.standings.length, 2);
    assert.ok(f.standings.reduce((n, s) => n + s.score, 0) >= 5 * 2, 'every round awarded points');
    assert.deepEqual(guest.state.final, host.state.final);
  });
});

test('each new minigame sends the snapshot fields the browser draws', async () => {
  for (const [game, key] of [['goldGrab', 'cn'], ['hotPotato', 'bomb'], ['hillHustle', 'zone']]) {
    await withServer({ SCHEDULE_OVERRIDE: [{ game, variant: 'classic' }] }, { timeScale: 8 }, async ({ mk }) => {
      const host = await mk();
      await ask(host, 'room:create', { name: 'Solo' });
      await ask(host, 'room:rounds', 1);
      assert.equal((await ask(host, 'match:start', null)).ok, true);
      await until(() => host.state.phase === 'playing' && host.snaps.some((s) => s.t > 2), 8000, `${game} running`);
      const snap = host.snaps[host.snaps.length - 1];
      assert.equal(snap.gid, game);
      assert.ok(key in snap, `${game} snapshot has "${key}"`);
      assert.equal(typeof snap.hud, 'string');
      const me = snap.ps[0];
      for (const f of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'fx', 'fy', 'st', 'sh', 'im', 'sn', 'cd', 'rs']) assert.ok(f in me, `${game} player field ${f}`);
      assert.equal(host.state.intro.gameId, game);
    });
  }
});
