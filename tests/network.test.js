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
      PITSTOP_MS: 120, // keep the power-up shop short in tests (it has its own tests)
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
    assert.ok(me.hat >= 0 && me.hat <= 21);
    assert.ok(Number.isInteger(me.skin) && me.skin >= 0 && me.skin <= 36);

    // Valid choices go through, junk is ignored or clamped.
    a.emit('room:customize', { color: 11, hat: 21, skin: 3 });
    await until(() => a.state.players[0].hat === 21, 2000, 'cosmetics change');
    assert.equal(a.state.players[0].color, 11);
    assert.equal(a.state.players[0].skin, 3);
    a.emit('room:customize', { color: 'red', hat: {}, skin: [1, 2] });
    await sleep(100);
    assert.ok(a.state.players[0].skin >= 0 && a.state.players[0].skin <= 11);
    assert.ok(a.state.players[0].hat >= 0 && a.state.players[0].hat <= 21);

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
  for (const [game, key] of [['goldGrab', 'cn'], ['hotPotato', 'bomb'], ['hillHustle', 'zone'], ['propHunt', 'props'], ['meteorMayhem', 'mt'], ['crownChaos', 'crown'], ['paintPanic', 'pt'], ['colorCall', 'cc'], ['jumpRope', 'rp'], ['lapDash', 'ps'], ['digDash', 'ds'], ['moleStomp', 'mo']]) {
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

test('shop coins: results rows and the final standings carry server-decided coin rewards', async () => {
  await withServer({}, { timeScale: 25 }, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Host' });
    await ask(guest, 'room:join', { code, name: 'Guest' });
    await ask(host, 'room:rounds', 1);
    await until(() => host.state.players.length === 2, 2000, 'both joined');
    let resultsSeen = null;
    host.on('room:state', (s) => {
      if (s.phase === 'results' && s.results && !resultsSeen) resultsSeen = JSON.parse(JSON.stringify(s.results));
    });
    assert.equal((await ask(host, 'match:start', null)).ok, true);
    await until(() => host.state.phase === 'final', 15000, 'final');

    assert.ok(resultsSeen, 'saw a results screen');
    assert.match(resultsSeen.matchId, /^[0-9a-z]+-1$/);
    for (const row of resultsSeen.rows) {
      assert.ok(Number.isInteger(row.coins) && row.coins >= 10, `with company everybody earns the participation coins (got ${row.coins})`);
      assert.ok(Array.isArray(row.coinParts) && row.coinParts.length >= 1);
    }
    const f = host.state.final;
    assert.equal(f.matchId, resultsSeen.matchId, 'results and final belong to the same match');
    for (const e of f.standings) assert.ok(e.bonus === 5 || e.bonus === 10, `final bonus is 5 or 10 (got ${e.bonus})`);
    assert.ok(f.standings.filter((e) => e.place === 1).every((e) => e.bonus === 10));
  });
});

test('shop coins: a second match gets a new match id, so it can be paid again', async () => {
  await withServer({}, { timeScale: 25 }, async ({ mk }) => {
    const host = await mk();
    await ask(host, 'room:create', { name: 'Solo' });
    await ask(host, 'room:rounds', 1);
    await ask(host, 'match:start', null);
    await until(() => host.state.phase === 'final', 15000, 'first final');
    const first = host.state.final.matchId;
    await ask(host, 'match:start', null);
    await until(() => host.state.phase === 'final' && host.state.final.matchId !== first, 15000, 'second final');
    assert.notEqual(host.state.final.matchId, first);
  });
});

test('shop coins: practicing alone pays only the small flat amount and no final bonus', async () => {
  await withServer({}, { timeScale: 25 }, async ({ mk }) => {
    const host = await mk();
    await ask(host, 'room:create', { name: 'Solo' });
    await ask(host, 'room:rounds', 1);
    let seen = null;
    host.on('room:state', (s) => {
      if (s.phase === 'results' && s.results && !seen) seen = JSON.parse(JSON.stringify(s.results));
    });
    await ask(host, 'match:start', null);
    await until(() => host.state.phase === 'final', 15000, 'final');
    assert.equal(seen.rows.length, 1);
    assert.equal(seen.rows[0].coins, 3);
    assert.equal(host.state.final.standings[0].bonus, 0);
  });
});

test('Prop Hunt over the network: the seeker is never sent where the disguised hiders are', async () => {
  await withServer({ SCHEDULE_OVERRIDE: [{ game: 'propHunt', variant: 'classic' }] }, { timeScale: 5 }, async ({ mk }) => {
    const socks = [await mk(), await mk(), await mk()];
    const created = await ask(socks[0], 'room:create', { name: 'A' });
    const ids = [created.playerId];
    for (const [i, s] of socks.slice(1).entries()) ids.push((await ask(s, 'room:join', { code: created.code, name: `P${i + 2}` })).playerId);
    await until(() => socks[0].state.players.length === 3, 3000, 'three players');
    await ask(socks[0], 'room:rounds', 1);
    assert.equal((await ask(socks[0], 'match:start', null)).ok, true);
    await until(() => socks.every((s) => s.snaps.length > 0), 8000, 'snapshots for everyone');

    const last = (s) => s.snaps[s.snaps.length - 1];
    const meIn = (s, id) => last(s).ps.find((p) => p.id === id);
    const seekerIdx = ids.findIndex((id, i) => (meIn(socks[i], id) || {}).rl === 1);
    assert.ok(seekerIdx >= 0, 'one of the players is the seeker');
    const seeker = socks[seekerIdx];
    const hiders = socks.map((s, i) => ({ s, id: ids[i] })).filter((_, i) => i !== seekerIdx);

    // While the seeker is blindfolded they see nothing but themselves.
    await until(() => last(seeker).blind === 1 || last(seeker).hl === 0, 4000, 'blindfold phase or already over');
    const early = seeker.snaps.find((s) => s.blind === 1);
    if (early) {
      assert.equal(early.props.length, 0);
      assert.deepEqual(early.ps.map((p) => p.id), [ids[seekerIdx]]);
    }

    // Once the hunt starts, both hiders disguise themselves.
    await until(() => last(seeker).hl === 0 && last(seeker).t > 0 && last(seeker).props.length > 0, 15000, 'hunt started');
    const decoys = last(seeker).props.length;
    for (const h of hiders) {
      h.s.emit('game:input', { mx: 0, my: 0, jump: false, shove: true });
      await sleep(60);
      h.s.emit('game:input', { mx: 0, my: 0, jump: false, shove: false });
    }
    await until(() => last(seeker).props.length === decoys + 2, 5000, 'two more props appeared for the seeker');

    const view = last(seeker);
    for (const h of hiders) {
      assert.ok(!view.ps.some((p) => p.id === h.id), 'the seeker\'s snapshot does not list a disguised hider');
      const mine = meIn(h.s, h.id);
      assert.equal(mine && mine.dg, 1, 'but the hider knows they are disguised');
    }
    assert.ok(view.props.every((p) => Array.isArray(p) && p.length === 3), 'props carry no ids or flags');
    // ...and nothing ever leaked: scan every snapshot the seeker ever received
    for (const s of seeker.snaps) {
      for (const h of hiders) {
        const listed = s.ps.find((p) => p.id === h.id);
        if (listed) assert.ok(!listed.dg, 'no disguise flag for others');
      }
    }
  });
});

test('power-ups over the network: the server keeps the purse, rejects cheats, and the boost reaches the next round', async () => {
  await withServer({ PITSTOP_MS: 20000 }, { timeScale: 25 }, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const created = await ask(host, 'room:create', { name: 'Host' });
    const joined = await ask(guest, 'room:join', { code: created.code, name: 'Guest' });
    await ask(host, 'room:rounds', 3);
    await until(() => host.state.players.length === 2, 2000, 'both joined');

    // Buying is refused outside the pit stop, and a modified browser cannot add coins.
    assert.equal((await ask(host, 'shop:buy', 'speed')).ok, false);
    host.emit('shop:purse', { purse: 9999 });
    host.emit('shop:buy', { id: 'speed', price: 0 }); // wrong shape on purpose

    assert.equal((await ask(host, 'match:start', null)).ok, true);
    await until(() => host.state.phase === 'pitstop', 20000, 'pit stop after round 1');
    assert.ok(host.state.powerups.length >= 5, 'the catalogue is sent to the browser');
    assert.equal(host.state.maxPowerSlots, 2);

    const mine = (sock, id) => sock.state.players.find((p) => p.id === id);
    const hostPurse = mine(host, created.playerId).purse;
    const guestPurse = mine(guest, joined.playerId).purse;
    assert.ok(hostPurse >= 10 && hostPurse < 100, `purse comes from earned coins (${hostPurse})`);
    assert.ok(Math.max(hostPurse, guestPurse) >= 20);

    // Whoever can afford it buys; the other one is told they are too poor.
    const [rich, poor, richId, poorId] = hostPurse >= guestPurse ? [host, guest, created.playerId, joined.playerId] : [guest, host, joined.playerId, created.playerId];
    assert.equal((await ask(rich, 'shop:buy', 'speed')).ok, true);
    assert.equal((await ask(rich, 'shop:buy', 'speed')).ok, false, 'no duplicates');
    assert.equal((await ask(rich, 'shop:buy', 'free-money')).ok, false);
    await until(() => mine(poor, richId).power.length === 1, 2000, 'everybody sees the loadout');
    assert.deepEqual(mine(poor, richId).power, ['speed']);
    assert.equal(mine(rich, richId).purse, Math.max(hostPurse, guestPurse) - 20);
    if (mine(poor, poorId).purse < 20) {
      const answer = await ask(poor, 'shop:buy', 'jump');
      assert.equal(answer.ok, false);
      assert.match(answer.error, /more coins/);
    }

    // Both say they are ready: the pit stop ends early and round 2 begins.
    host.emit('shop:done', true);
    guest.emit('shop:done', true);
    await until(() => host.state.phase === 'intro' && host.state.round === 2, 3000, 'round 2 intro');
    assert.deepEqual(mine(host, richId).power, ['speed'], 'the intro shows what you carry');
    await until(() => host.state.phase === 'playing', 5000, 'round 2 playing');
    await until(() => host.state.phase === 'results' || host.state.phase === 'pitstop', 20000, 'round 2 over');
    await until(() => mine(host, richId).power.length === 0, 3000, 'power-up used up after one round');
  });
});

test('smoothness: ping answers at once, and snapshots arrive steadily (no long gaps)', async () => {
  await withServer({ INTRO_MS: 100 }, {}, async ({ mk }) => {
    const host = await mk();
    // The ping used by the F3 overlay: answered immediately, junk arguments are ignored.
    const t0 = Date.now();
    await new Promise((resolve) => host.emit('net:ping', resolve));
    assert.ok(Date.now() - t0 < 500, 'ping answered quickly');
    host.emit('net:ping', 'not a function');
    host.emit('net:ping');

    await ask(host, 'room:create', { name: 'Host' });
    await ask(host, 'match:start', null);
    await until(() => host.state.phase === 'playing', 5000, 'playing');
    host.snaps.length = 0;
    const times = [];
    host.on('game:snap', () => times.push(Date.now()));
    await sleep(1500);
    assert.ok(times.length >= 35, `about 30 snapshots per second (got ${times.length} in 1.5 s)`);
    let worst = 0;
    for (let i = 1; i < times.length; i++) worst = Math.max(worst, times[i] - times[i - 1]);
    assert.ok(worst < 160, `no long hiccups between snapshots (worst gap ${worst} ms)`);
  });
});

test('public rooms: private by default, only the host can list a room, the list shows no secrets', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const viewer = await mk();
    const { code, token } = await ask(host, 'room:create', { name: 'Hosty' });
    const joined = await ask(guest, 'room:join', { code, name: 'Guesty' });
    await until(() => host.state && host.state.players.length === 2, 2000, 'two players');

    assert.equal(host.state.isPublic, false, 'a new room is private');
    let list = await ask(viewer, 'rooms:list', null);
    assert.equal(list.ok, true);
    assert.deepEqual(list.rooms, [], 'private rooms are never listed');

    const denied = await ask(guest, 'room:public', true);
    assert.equal(denied.ok, false, 'a guest cannot make the room public');
    assert.equal((await ask(host, 'room:public', 'yes please')).isPublic, false, 'only a real true counts');

    const on = await ask(host, 'room:public', true);
    assert.deepEqual([on.ok, on.isPublic], [true, true]);
    await until(() => guest.state.isPublic === true, 2000, 'everybody sees the room is public');
    await sleep(2100); // (the list is rate limited: wait for a fresh window)
    list = await ask(viewer, 'rooms:list');
    assert.equal(list.rooms.length, 1);
    const row = list.rooms[0];
    assert.equal(row.code, code);
    assert.equal(row.host, 'Hosty');
    assert.equal(row.players, 2);
    assert.equal(row.phase, 'lobby');
    const text = JSON.stringify(list);
    assert.ok(!text.includes(token) && !text.includes(joined.token) && !text.includes(joined.playerId), 'no tokens or ids in the list');

    // The listed room can be joined with its code, like any other.
    const joined2 = await ask(viewer, 'room:join', { code: row.code, name: 'Newbie' });
    assert.equal(joined2.ok, true);

    // Hiding it again removes it.
    assert.equal((await ask(host, 'room:public', false)).isPublic, false);
    await sleep(2100);
    list = await ask(viewer, 'rooms:list', null);
    assert.deepEqual(list.rooms, []);
  });
});

test('public rooms: full rooms are not listed, the list is limited, and asking too fast is refused', async () => {
  await withServer({ MAX_PLAYERS: 2 }, {}, async ({ mk }) => {
    const a = await mk();
    const b = await mk();
    const watcher = await mk();
    const { code } = await ask(a, 'room:create', { name: 'A' });
    await ask(a, 'room:public', true);
    assert.equal((await ask(watcher, 'rooms:list', null)).rooms.length, 1);
    await ask(b, 'room:join', { code, name: 'B' });
    const list = await ask(watcher, 'rooms:list', null);
    assert.deepEqual(list.rooms, [], 'a full room cannot be joined, so it is not listed');
    // Spamming the list: after a few asks in a short time the server says no.
    let refused = 0;
    for (let i = 0; i < 8; i++) if (!(await ask(watcher, 'rooms:list', null)).ok) refused++;
    assert.ok(refused >= 3, `refused ${refused} fast requests`);
  });
});

test('room size: the host picks 2-8 players, nobody else can, and the limit is enforced', async () => {
  await withServer({}, {}, async ({ mk }) => {
    const host = await mk();
    const g1 = await mk();
    const g2 = await mk();
    const g3 = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Hosty' });
    await until(() => host.state && host.state.maxPlayers === 8, 2000, 'default is the server maximum');
    assert.equal(host.state.playerCap, 8);
    await ask(g1, 'room:join', { code, name: 'G1' });
    await until(() => host.state.players.length === 2, 2000, 'two players');

    assert.equal((await ask(g1, 'room:max', 3)).ok, false, 'a guest cannot change it');
    for (const bad of [1, 0, 9, 100, -4, 'lots', null]) assert.equal((await ask(host, 'room:max', bad)).ok, false, `rejects ${bad}`);
    assert.equal(host.state.maxPlayers, 8, 'bad values change nothing');

    assert.deepEqual(Object.values(await ask(host, 'room:max', 3)).slice(0, 2), [true, 3]);
    await until(() => g1.state.maxPlayers === 3, 2000, 'everybody sees the new size');
    assert.equal((await ask(host, 'room:max', 1)).ok, false);
    await ask(g2, 'room:join', { code, name: 'G2' });
    const full = await ask(g3, 'room:join', { code, name: 'G3' });
    assert.equal(full.ok, false);
    assert.match(full.error, /full \(3 players max\)/);
    assert.equal((await ask(host, 'room:max', 2)).ok, false, 'cannot go below the players already inside');
    assert.equal((await ask(host, 'room:max', 5)).ok, true);
    assert.equal((await ask(g3, 'room:join', { code, name: 'G3' })).ok, true, 'room again has space');

    // the public list shows the chosen size
    await ask(host, 'room:public', true);
    const watcher = await mk();
    const list = await ask(watcher, 'rooms:list', null);
    assert.equal(list.rooms[0].max, 5);
    assert.equal(list.rooms[0].players, 4);

    // it cannot be changed in the middle of a match
    await ask(host, 'room:rounds', 1);
    assert.equal((await ask(host, 'match:start', null)).ok, true);
    assert.equal((await ask(host, 'room:max', 6)).ok, false);
  });
});
