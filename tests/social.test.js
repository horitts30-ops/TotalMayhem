'use strict';

// Tests for the Rage Bait room setting, the emoji bubbles and the ADMIN PANEL (including its lock).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { io } = require('socket.io-client');
const { createGameServer } = require('../server/app');
const { AdminLock, cleanAnnouncement } = require('../server/admin');
const { EMOTES } = require('../server/emotes');
const chat = require('../server/chat');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (sock, event, data) => new Promise((resolve) => sock.emit(event, data, resolve));
async function until(fn, ms = 6000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(15);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.state = null;
    s.emotes = [];
    s.announcements = [];
    s.coinGifts = [];
    s.kicked = [];
    s.chat = [];
    s.chatEnabled = [];
    s.on('room:state', (st) => (s.state = st));
    s.on('chat:emoji', (m) => s.emotes.push(m));
    s.on('server:announce', (m) => s.announcements.push(m));
    s.on('admin:coins', (m) => s.coinGifts.push(m));
    s.on('room:kicked', (m) => s.kicked.push(m));
    s.on('chat:msg', (m) => s.chat.push(m));
    s.on('chat:enabled', (m) => s.chatEnabled.push(m));
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}
async function withServer(config, body) {
  const server = createGameServer({
    quiet: true,
    config: { INTRO_MS: 150, RESULTS_MS: 150, PITSTOP_MS: 0, ROUND_END_DELAY_MS: 100, SCHEDULE_OVERRIDE: [{ game: 'lapDash', variant: 'classic' }], ...config },
    gameOptions: { timeScale: 6 },
  });
  const port = await server.start(0, '127.0.0.1');
  const socks = [];
  const mk = async () => {
    const s = await connect(`http://127.0.0.1:${port}`);
    socks.push(s);
    return s;
  };
  try {
    await body({ server, mk });
  } finally {
    socks.forEach((s) => s.close());
    await server.stop();
  }
}

// ================================================================= Rage Bait (room setting)
test('rage bait: off by default, only the host can switch it, only between matches, and everybody sees it', async () => {
  await withServer({}, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const watcher = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Hosty' });
    await ask(guest, 'room:join', { code, name: 'Guesty' });
    await until(() => guest.state && guest.state.players.length === 2, 3000, 'joined');
    assert.equal(host.state.rage, false);
    assert.equal((await ask(guest, 'room:rage', true)).ok, false, 'a guest cannot');
    assert.equal((await ask(host, 'room:rage', 'yes')).rage, false, 'only a real true counts');
    assert.deepEqual([(await ask(host, 'room:rage', true)).ok, host.state.rage], [true, true]);
    await until(() => guest.state.rage === true, 2000, 'guest sees it');

    await ask(host, 'room:public', true);
    assert.equal((await ask(watcher, 'rooms:list', null)).rooms[0].rage, true, 'the public list says so');

    // the intro warns everybody, and the round is played with the harder rules
    await ask(host, 'room:rounds', 1);
    await ask(host, 'match:start', null);
    await until(() => host.state.phase === 'intro', 3000, 'intro');
    assert.match(host.state.intro.instructions[0], /RAGE BAIT/);
    await until(() => host.state.phase === 'playing', 5000, 'playing');
    assert.equal(host.state.arena.track.hurdles.length, 6, 'Lap Dash got all its hurdles');
    assert.equal((await ask(host, 'room:rage', false)).ok, false, 'cannot change it mid-match');
  });
});

test('rage bait: the running game really is in rage mode, and a normal room is not', async () => {
  await withServer({ SCHEDULE_OVERRIDE: [{ game: 'goldGrab', variant: 'classic' }] }, async ({ server, mk }) => {
    const a = await mk();
    const { code } = await ask(a, 'room:create', { name: 'A' });
    await ask(a, 'room:rage', true);
    await ask(a, 'room:rounds', 1);
    await ask(a, 'match:start', null);
    await until(() => a.state.phase === 'playing', 5000, 'playing');
    assert.equal(server.manager.get(code).game.rage, true);
    assert.equal(server.manager.get(code).game.v.shoveSpeed >= 3, true);
    const b = await mk();
    const c2 = await ask(b, 'room:create', { name: 'B' });
    await ask(b, 'room:rounds', 1);
    await ask(b, 'match:start', null);
    await until(() => b.state.phase === 'playing', 5000, 'playing');
    assert.equal(server.manager.get(c2.code).game.rage, false);
  });
});

// ================================================================= emoji bubbles
test('emoji: the browser and server lists match, and the list is small and sane', async () => {
  const C = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'constants.js')).href);
  assert.deepEqual(C.EMOTES, EMOTES);
  assert.equal(EMOTES.length, 8);
  assert.equal(new Set(EMOTES).size, 8);
});

test('emoji: reaches everybody in the same room only, bad numbers are ignored, and spamming is cut off', async () => {
  await withServer({ EMOTE_GAP_MS: 250 }, async ({ mk }) => {
    const a = await mk();
    const b = await mk();
    const outsider = await mk();
    const stranger = await mk();
    const { code, playerId } = await ask(a, 'room:create', { name: 'A' });
    await ask(b, 'room:join', { code, name: 'B' });
    await ask(outsider, 'room:create', { name: 'Elsewhere' });
    await until(() => b.state && b.state.players.length === 2, 2000, 'joined');

    a.emit('chat:emoji', 5);
    await until(() => b.emotes.length === 1 && a.emotes.length === 1, 2000, 'delivered');
    assert.deepEqual(b.emotes[0], { id: playerId, e: 5 });
    await sleep(100);
    assert.equal(outsider.emotes.length, 0, 'another room never sees it');

    for (const bad of [-1, 8, 99, 1.5, '3', null, {}, [1], NaN]) {
      await sleep(270);
      a.emit('chat:emoji', bad);
    }
    await sleep(200);
    assert.equal(b.emotes.length, 1, 'nothing invalid got through');

    // spam: 20 in a row from one player -> only the first one (gap 250 ms)
    await sleep(300);
    for (let i = 0; i < 20; i++) a.emit('chat:emoji', i % 8);
    await sleep(150);
    assert.equal(b.emotes.length, 2, 'only one of the burst arrived');

    stranger.emit('chat:emoji', 1); // not in a room at all
    await sleep(100);
    assert.equal(a.emotes.length, 2);
  });
});

// ================================================================= admin lock (unit)
test('admin lock: a short or missing code is replaced by a random one; a good code is kept and never guessable by default', () => {
  const a = new AdminLock('');
  const b = new AdminLock('');
  assert.equal(a.generated, true);
  assert.match(a.code, /^[A-Z2-9]{10}$/);
  assert.notEqual(a.code, b.code, 'new every time');
  const short = new AdminLock('abc');
  assert.equal(short.generated, true);
  assert.equal(short.tooShort, true);
  assert.notEqual(short.code, 'abc');
  const mine = new AdminLock('  correct horse  ');
  assert.equal(mine.generated, false);
  assert.equal(mine.attempt('1.1.1.1', 'correct horse').ok, true);
  assert.equal(mine.attempt('1.1.1.1', 'correct hors').ok, false);
  assert.equal(mine.attempt('1.1.1.1', 'CORRECT HORSE').ok, false, 'case matters');
  for (const weird of [null, undefined, 12345, {}, [], 'x'.repeat(100000)]) assert.equal(mine.attempt('2.2.2.2', weird).ok, false);
});

test('admin lock: 5 wrong tries lock that address (even for the right code), the lock grows, and it ends on time', () => {
  let t = 1_000_000;
  const lock = new AdminLock('secret-code-1', { now: () => t });
  for (let i = 0; i < 4; i++) lock.attempt('9.9.9.9', 'nope' + i);
  assert.equal(lock.lockedFor('9.9.9.9'), 0, 'not locked after 4');
  const fifth = lock.attempt('9.9.9.9', 'nope');
  assert.ok(fifth.locked >= 299, `locked for ${fifth.locked}s`);
  assert.equal(lock.attempt('9.9.9.9', 'secret-code-1').ok, false, 'the right code does not work while locked');
  assert.equal(lock.attempt('8.8.8.8', 'secret-code-1').ok, true, 'other addresses are unaffected');
  t += 5 * 60 * 1000 + 1000;
  assert.equal(lock.lockedFor('9.9.9.9'), 0, 'lock over after 5 minutes');
  for (let i = 0; i < 5; i++) lock.attempt('9.9.9.9', 'bad');
  assert.ok(lock.lockedFor('9.9.9.9') >= 599, 'second lock is twice as long');
  assert.equal(lock.attempt('9.9.9.9', 'secret-code-1').ok, false);
});

test('admin lock: guessing from many addresses trips a server-wide lock', () => {
  let t = 5_000_000;
  const lock = new AdminLock('another-secret', { now: () => t });
  for (let i = 0; i < 30; i++) lock.attempt(`10.0.0.${i}`, 'wrong');
  assert.ok(lock.lockedFor('10.0.1.1') > 0, 'everybody is locked out for a while');
  assert.equal(lock.attempt('10.0.1.1', 'another-secret').ok, false);
  t += 10 * 60 * 1000 + 1000;
  assert.equal(lock.attempt('10.0.1.1', 'another-secret').ok, true);
});

test('announcements are plain, short text', () => {
  assert.equal(cleanAnnouncement('  Server   restarts\nin 5 minutes!  '), 'Server restarts in 5 minutes!');
  assert.equal(cleanAnnouncement('<img src=x onerror=alert(1)>'), 'img src=x onerror=alert(1)');
  assert.equal(cleanAnnouncement('a'.repeat(500)).length, 120);
  assert.equal(cleanAnnouncement(42), '');
  assert.equal(cleanAnnouncement('\u0007\u0000'), '');
});

// ================================================================= admin panel (real server)
test('admin: nothing works before the code is accepted, wrong codes are refused, the right one unlocks, logout locks again', async () => {
  await withServer({ ADMIN_CODE: 'open-sesame-9' }, async ({ mk }) => {
    const user = await mk();
    const { code } = await ask(user, 'room:create', { name: 'Innocent' });
    const admin = await mk();
    for (const ev of ['admin:status', 'admin:kick', 'admin:close', 'admin:announce']) {
      const r = await ask(admin, ev, { code, playerId: 'x', text: 'hi' });
      assert.equal(r.ok, false, `${ev} refused without login`);
    }
    assert.equal(user.kicked.length + admin.announcements.length, 0);
    assert.equal((await ask(admin, 'admin:login', { code: 'wrong' })).ok, false);
    assert.equal((await ask(admin, 'admin:login', null)).ok, false);
    assert.equal((await ask(admin, 'admin:status')).ok, false, 'a wrong guess unlocks nothing');
    assert.equal((await ask(admin, 'admin:login', { code: 'open-sesame-9' })).ok, true);
    const st = await ask(admin, 'admin:status');
    assert.equal(st.ok, true);
    assert.equal(st.rooms.length, 1);
    assert.equal(st.rooms[0].code, code);
    assert.equal(st.rooms[0].host, 'Innocent');
    assert.ok(st.stats.uptimeSec >= 0 && st.stats.rooms === 1 && st.stats.players === 1);
    assert.equal((await ask(admin, 'admin:logout')).ok, true);
    assert.equal((await ask(admin, 'admin:status')).ok, false, 'locked again');
    // another browser never inherits admin rights
    const other = await mk();
    assert.equal((await ask(other, 'admin:status')).ok, false);
  });
});

test('admin: the overview never contains reconnect tokens or socket ids', async () => {
  await withServer({ ADMIN_CODE: 'open-sesame-9' }, async ({ mk }) => {
    const u = await mk();
    const made = await ask(u, 'room:create', { name: 'Secretive' });
    const admin = await mk();
    await ask(admin, 'admin:login', { code: 'open-sesame-9' });
    const text = JSON.stringify(await ask(admin, 'admin:status'));
    assert.ok(!text.includes(made.token), 'no token');
    assert.ok(!text.includes(u.id), 'no socket id');
    assert.ok(!/token|socketId/i.test(text));
  });
});

test('admin: kick removes one player (and tells their browser), close sends everybody home, announce reaches everyone', async () => {
  await withServer({ ADMIN_CODE: 'open-sesame-9' }, async ({ server, mk }) => {
    const host = await mk();
    const guest = await mk();
    const lone = await mk();
    const admin = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Hosty' });
    const joined = await ask(guest, 'room:join', { code, name: 'Guesty' });
    const other = await ask(lone, 'room:create', { name: 'Other' });
    await until(() => host.state.players.length === 2, 2000, 'two players');
    await ask(admin, 'admin:login', { code: 'open-sesame-9' });

    assert.equal((await ask(admin, 'admin:kick', { code, playerId: 'nobody' })).ok, false);
    assert.equal((await ask(admin, 'admin:kick', { code, playerId: joined.playerId })).ok, true);
    await until(() => guest.kicked.length === 1, 2000, 'guest told');
    assert.match(guest.kicked[0].reason, /removed/);
    await until(() => host.state.players.length === 1, 2000, 'removed from the room');
    // the kicked browser no longer receives that room's traffic
    host.emit('chat:emoji', 2);
    await sleep(150);
    assert.equal(guest.emotes.length, 0);

    // announcements reach every connection and are cleaned
    assert.equal((await ask(admin, 'admin:announce', { text: '   ' })).ok, false);
    assert.equal((await ask(admin, 'admin:announce', { text: '<b>Back in 5 min</b>\n' })).ok, true);
    await until(() => host.announcements.length === 1 && lone.announcements.length === 1 && guest.announcements.length === 1, 2000, 'announced');
    assert.equal(host.announcements[0].text, 'b Back in 5 min /b');

    assert.equal((await ask(admin, 'admin:close', { code: other.code })).ok, true);
    await until(() => lone.kicked.length === 1, 2000, 'lone told');
    assert.equal(server.manager.get(other.code), null);
    assert.equal((await ask(admin, 'admin:close', { code: other.code })).ok, false, 'already gone');
    assert.ok(server.manager.get(code), 'the other room is untouched');
  });
});

test('admin: too many wrong codes over the real connection locks it out, even for the right code', async () => {
  await withServer({ ADMIN_CODE: 'open-sesame-9' }, async ({ mk }) => {
    const a = await mk();
    let last;
    for (let i = 0; i < 5; i++) last = await ask(a, 'admin:login', { code: 'guess' + i });
    assert.equal(last.ok, false);
    assert.ok(last.locked > 0, 'told how long to wait');
    const right = await ask(a, 'admin:login', { code: 'open-sesame-9' });
    assert.equal(right.ok, false);
    assert.match(right.error, /Too many/);
    assert.equal((await ask(a, 'admin:status')).ok, false);
  });
});

test('admin: with no ADMIN_CODE set the server makes up its own, which really works and is not a default like "admin"', async () => {
  await withServer({ ADMIN_CODE: '' }, async ({ server, mk }) => {
    const a = await mk();
    for (const guess of ['admin', 'password', '123456', 'letmein']) assert.equal((await ask(a, 'admin:login', { code: guess })).ok, false);
    const b = await mk();
    assert.equal(server.admin.generated, true);
    assert.equal((await ask(b, 'admin:login', { code: server.admin.code })).ok, true);
  });
});

// ================================================================= text chat
test('chat filter: masks swear words (also simple disguises), leaves innocent words alone, trims and limits text', () => {
  const m = chat.maskBadWords;
  assert.equal(m('this is shit'), 'this is ****');
  assert.equal(m('what the f*ck'), 'what the ****');
  assert.equal(m('FUUUUCK you'), '******* you');
  assert.equal(m('sh1tty move'), '****** move');
  for (const fine of ['nice class, assist me', 'Scunthorpe is a town', 'ship it', 'assess this', 'shiitake', 'Hello world!', 'what the hell']) assert.equal(m(fine), fine, fine);
  assert.equal(chat.cleanChat('  hi‮   there \n\n'), 'hi there');
  assert.equal(Array.from(chat.cleanChat('x'.repeat(500))).length, 140);
  assert.equal(chat.cleanChat('\u0007\u0000   '), '');
  assert.equal(chat.cleanChat(42), '');
  assert.equal(chat.cleanChat('shit', { filter: false }), 'shit', 'the filter can be switched off');
  assert.equal(chat.cleanChat('<b>hi</b>'), '<b>hi</b>', 'kept as plain text: the browser shows it with textContent');
});

test('chat: only between rounds, only to your own room, cleaned, limited, and late joiners see the history', async () => {
  await withServer({ CHAT_GAP_MS: 150, SCHEDULE_OVERRIDE: [{ game: 'goldGrab', variant: 'classic' }] }, async ({ mk }) => {
    const a = await mk();
    const b = await mk();
    const elsewhere = await mk();
    const { code, playerId } = await ask(a, 'room:create', { name: 'Ann' });
    await ask(b, 'room:join', { code, name: 'Bob' });
    await ask(elsewhere, 'room:create', { name: 'Else' });
    await until(() => b.state && b.state.players.length === 2, 2000, 'joined');

    assert.equal((await ask(a, 'chat:send', { text: 'hello   everybody\n' })).ok, true);
    await until(() => a.chat.length === 1 && b.chat.length === 1, 2000, 'delivered');
    assert.deepEqual(b.chat[0], { n: 1, id: playerId, name: 'Ann', text: 'hello everybody' });
    await sleep(100);
    assert.equal(elsewhere.chat.length, 0, 'another room never sees it');

    await sleep(170);
    assert.equal((await ask(a, 'chat:send', { text: 'you shit' })).ok, true);
    await until(() => b.chat.length === 2, 2000, 'second');
    assert.equal(b.chat[1].text, 'you ****');

    // bad input
    await sleep(170);
    for (const bad of [null, {}, { text: 5 }, { text: '   ' }, 'plain string']) {
      assert.equal((await ask(a, 'chat:send', bad)).ok, false);
      await sleep(170);
    }
    const stranger = await mk();
    assert.equal((await ask(stranger, 'chat:send', { text: 'hi' })).ok, false, 'not in a room');

    // too fast
    await sleep(170);
    assert.equal((await ask(a, 'chat:send', { text: 'one' })).ok, true);
    const fast = await ask(a, 'chat:send', { text: 'two' });
    assert.equal(fast.ok, false);
    assert.match(fast.error, /Slow down/);

    // late joiner gets the history
    const c = await mk();
    await ask(c, 'room:join', { code, name: 'Cat' });
    const hist = await ask(c, 'chat:history');
    assert.equal(hist.ok, true);
    assert.deepEqual(hist.messages.map((m) => m.text), ['hello everybody', 'you ****', 'one']);
    assert.equal((await ask(stranger, 'chat:history')).ok, false);

    // never during a round
    await ask(a, 'room:rounds', 1);
    await ask(a, 'match:start', null);
    await until(() => a.state.phase === 'intro', 3000, 'intro');
    assert.equal((await ask(a, 'chat:send', { text: 'during intro' })).ok, false);
    await until(() => a.state.phase === 'playing', 5000, 'playing');
    const r = await ask(a, 'chat:send', { text: 'during the round' });
    assert.equal(r.ok, false);
    assert.match(r.error, /between rounds/);
    // ...but it opens again on the results screen
    await until(() => a.state.phase === 'results' || a.state.phase === 'final', 20000, 'results');
    await sleep(170);
    assert.equal((await ask(a, 'chat:send', { text: 'good game' })).ok, true);
  });
});

test('chat: a burst of messages is cut off, and history never grows beyond 40', async () => {
  await withServer({ CHAT_GAP_MS: 0 }, async ({ server, mk }) => {
    const a = await mk();
    const { code } = await ask(a, 'room:create', { name: 'Spammer' });
    let ok = 0;
    for (let i = 0; i < 12; i++) if ((await ask(a, 'chat:send', { text: 'spam ' + i })).ok) ok++;
    assert.equal(ok, chat.BURST, 'only a handful per 10 seconds');
    // the room keeps at most the last HISTORY messages
    const room = server.manager.get(code);
    for (let i = 0; i < 100; i++) room.postChat(room.hostId, 'm' + i, true), (room.players.get(room.hostId).chatTimes = []);
    assert.equal(room.chat.length, chat.HISTORY);
    assert.equal(room.chat[room.chat.length - 1].text, 'm99');
  });
});

test('chat: the server admin can switch it off for everybody, and read a room\'s chat; others cannot', async () => {
  await withServer({ ADMIN_CODE: 'open-sesame-9', CHAT_GAP_MS: 0 }, async ({ mk }) => {
    const a = await mk();
    const b = await mk();
    const admin = await mk();
    const { code } = await ask(a, 'room:create', { name: 'Ann' });
    await ask(b, 'room:join', { code, name: 'Bob' });
    await ask(a, 'chat:send', { text: 'hello' });
    assert.equal((await ask(a, 'admin:chatToggle', { on: false })).ok, false, 'players cannot');
    assert.equal((await ask(a, 'admin:chat', { code })).ok, false);
    await ask(admin, 'admin:login', { code: 'open-sesame-9' });
    const seen = await ask(admin, 'admin:chat', { code });
    assert.deepEqual(seen.messages.map((m) => m.text), ['hello']);
    assert.equal((await ask(admin, 'admin:status')).stats.chatOn, true);
    assert.equal((await ask(admin, 'admin:status')).rooms[0].chatCount, 1);

    assert.equal((await ask(admin, 'admin:chatToggle', { on: false })).chatOn, false);
    await until(() => a.chatEnabled.length === 1 && b.chatEnabled.length === 1, 2000, 'everybody told');
    assert.equal(a.chatEnabled[0].enabled, false);
    const off = await ask(a, 'chat:send', { text: 'still there?' });
    assert.equal(off.ok, false);
    assert.match(off.error, /switched off/);
    assert.equal((await ask(b, 'chat:history')).enabled, false);

    assert.equal((await ask(admin, 'admin:chatToggle', { on: true })).chatOn, true);
    assert.equal((await ask(a, 'chat:send', { text: 'back' })).ok, true);
  });
});

test('admin: the give-coins command is locked, validates the amount, and tells only the right browser', async () => {
  await withServer({ ADMIN_CODE: 'open-sesame-9' }, async ({ mk }) => {
    const host = await mk();
    const guest = await mk();
    const admin = await mk();
    const { code } = await ask(host, 'room:create', { name: 'Hosty' });
    const joined = await ask(guest, 'room:join', { code, name: 'Guesty' });
    // nobody can use it before the code was accepted, not even for themselves
    assert.equal((await ask(admin, 'admin:giveCoins', { amount: 500 })).ok, false);
    assert.equal((await ask(host, 'admin:giveCoins', { amount: 500, code, playerId: joined.playerId })).ok, false);
    await sleep(80);
    assert.equal(admin.coinGifts.length + host.coinGifts.length + guest.coinGifts.length, 0, 'nothing sent without login');
    await ask(admin, 'admin:login', { code: 'open-sesame-9' });
    // bad amounts
    for (const bad of [0, -5, 1.5, 1000000, NaN, 'lots', null, undefined, {}, [], '12']) {
      assert.equal((await ask(admin, 'admin:giveCoins', { amount: bad })).ok, false, `amount ${JSON.stringify(bad)} refused`);
    }
    assert.equal((await ask(admin, 'admin:giveCoins', null)).ok, false);
    await sleep(80);
    assert.equal(admin.coinGifts.length, 0);
    // coins for the admin
    const mine = await ask(admin, 'admin:giveCoins', { amount: 1234 });
    assert.deepEqual([mine.ok, mine.who], [true, 'you']);
    await until(() => admin.coinGifts.length === 1, 2000, 'admin coins');
    assert.deepEqual(admin.coinGifts[0], { amount: 1234 });
    assert.equal(host.coinGifts.length + guest.coinGifts.length, 0, 'nobody else gets it');
    // the largest allowed amount
    assert.equal((await ask(admin, 'admin:giveCoins', { amount: 999999 })).ok, true);
    // coins for one player of a room
    const toGuest = await ask(admin, 'admin:giveCoins', { amount: 50, code, playerId: joined.playerId });
    assert.deepEqual([toGuest.ok, toGuest.who], [true, 'Guesty']);
    await until(() => guest.coinGifts.length === 1, 2000, 'guest coins');
    assert.deepEqual(guest.coinGifts[0], { amount: 50 });
    assert.equal(host.coinGifts.length, 0);
    // unknown room / player
    assert.equal((await ask(admin, 'admin:giveCoins', { amount: 5, code: 'ZZZZ', playerId: 'nobody' })).ok, false);
    assert.equal((await ask(admin, 'admin:giveCoins', { amount: 5, code, playerId: 'nobody' })).ok, false);
    assert.equal((await ask(admin, 'admin:giveCoins', { amount: 5, code, playerId: { x: 1 } })).ok, false);
  });
});

test('admin: coins from the admin panel add to the wallet once, never past the wallet limit, and the panel has the controls', async () => {
  const fs = require('node:fs');
  const shop = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'shop.js')).href);
  const w = shop.emptyWallet();
  assert.equal(shop.credit(w, 1000, 'admin-a'), 1000);
  assert.equal(shop.credit(w, 1000, 'admin-a'), 0, 'the same key is never paid twice');
  assert.equal(shop.credit(w, 999999, 'admin-b'), 999999);
  assert.equal(w.coins, 999999, 'capped at the wallet limit');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="admin-coins-amount"') && html.includes('id="admin-coins-btn"'));
  const main = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'main.js'), 'utf8');
  assert.ok(main.includes("socket.on('admin:coins'") && main.includes("request('admin:giveCoins'"));
});
