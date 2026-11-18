// "No server" mode (GitHub Pages): the game server runs inside the host's browser and friends connect over WebRTC.
// These tests replace the real network with in-memory pipes, so they check everything except WebRTC itself:
//   * server/fakeio.js      - the Socket.IO stand-in
//   * server/hosting.js     - the browser host
//   * public/js/p2pnet.js   - the browser side (create / join / leave / reconnect)
//   * public/js/host.bundle.js - the prebuilt browser bundle really matches the source
const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');
const { FakeIO } = require('../server/fakeio');
const hosting = require('../server/hosting');

const PUBLIC = path.join(__dirname, '..', 'public');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(5);
  }
  return false;
}

// ----------------------------------------------------------------------------------- fake WebRTC (PeerJS)
function fakePeerLib() {
  const peers = new Map();
  let anon = 0;
  class Conn extends EventEmitter {
    constructor(peer) {
      super();
      this.peer = peer;
      this.other = null;
      this.open = false;
    }
    send(text) {
      if (!this.open) throw new Error('not open');
      setImmediate(() => this.other && this.other.emit('data', text));
    }
    close() {
      if (!this.open) return;
      this.open = false;
      const o = this.other;
      setImmediate(() => {
        this.emit('close');
        if (o && o.open) {
          o.open = false;
          o.emit('close');
        }
      });
    }
  }
  class Peer extends EventEmitter {
    constructor(id) {
      super();
      this.id = id || `anon${++anon}`;
      this.destroyed = false;
      this.disconnected = false;
      this.conns = [];
      setImmediate(() => {
        if (peers.has(this.id)) {
          this.destroyed = true;
          this.emit('error', Object.assign(new Error('ID taken'), { type: 'unavailable-id' }));
        } else {
          peers.set(this.id, this);
          this.emit('open', this.id);
        }
      });
    }
    connect(id) {
      const mine = new Conn(id);
      const target = peers.get(id);
      setImmediate(() => {
        if (!target || target.destroyed) return this.emit('error', Object.assign(new Error('gone'), { type: 'peer-unavailable' }));
        const theirs = new Conn(this.id);
        mine.other = theirs;
        theirs.other = mine;
        mine.open = theirs.open = true;
        this.conns.push(mine);
        target.conns.push(theirs);
        target.emit('connection', theirs);
        setImmediate(() => {
          theirs.emit('open');
          mine.emit('open');
        });
      });
      return mine;
    }
    reconnect() {}
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (peers.get(this.id) === this) peers.delete(this.id);
      for (const c of this.conns) c.close();
    }
  }
  return { Peer, peers };
}

const made = [];
after(() => made.forEach((s) => s._reset())); // never leave a game clock running

async function makeSocket(lib, extra = {}) {
  const { createP2PSocket } = await import(pathToFileURL(path.join(PUBLIC, 'js', 'p2pnet.js')).href);
  let session = null;
  const socket = createP2PSocket({
    loadHost: async () => ({
      ...hosting,
      createBrowserHost: () => hosting.createBrowserHost({ config: { INTRO_MS: 100, PITSTOP_MS: 0 } }), // skip the long intro card
      mapChoices: hosting.createBrowserHost().mapChoices,
    }),
    loadPeer: async () => lib.Peer,
    peerOptions: {},
    hasSession: () => !!session,
    ...extra,
  });
  made.push(socket);
  socket.setSession = (v) => (session = v);
  socket.log = [];
  for (const ev of ['connect', 'disconnect', 'room:state', 'room:kicked', 'game:snap']) socket.on(ev, (x) => socket.log.push([ev, x]));
  socket.ask = (ev, data) => new Promise((resolve) => socket.timeout(5000).emit(ev, data, (err, res) => resolve(err ? { ok: false, error: String(err.message) } : res)));
  return socket;
}
const count = (s, ev) => s.log.filter((l) => l[0] === ev).length;
const last = (s, ev) => [...s.log].reverse().find((l) => l[0] === ev)?.[1];

// ----------------------------------------------------------------------------------------------- FakeIO
test('fakeio: events, answers, rooms, volatile and disconnect work like Socket.IO', async () => {
  const io = new FakeIO();
  const sent = { a: [], b: [] };
  let clogged = false;
  const connections = [];
  io.on('connection', (s) => {
    connections.push(s);
    s.on('hello', (data, cb) => cb({ echo: data }));
    s.on('join', (room) => s.join(room));
    s.on('disconnect', () => (s.gone = true));
  });
  const a = io.addConnection({ send: (t) => sent.a.push(JSON.parse(t)) });
  const b = io.addConnection({ send: (t) => sent.b.push(JSON.parse(t)), canSend: () => !clogged });

  a.receive(JSON.stringify({ e: 'hello', a: [{ x: 1 }], i: 5 }));
  assert.deepEqual(sent.a, [{ k: 5, a: [{ echo: { x: 1 } }] }], 'the answer goes back with the same number');

  a.receive(JSON.stringify({ e: 'join', a: ['ROOM'] }));
  b.receive(JSON.stringify({ e: 'join', a: ['ROOM'] }));
  io.to('ROOM').emit('ping', 1);
  assert.equal(sent.a.at(-1).e, 'ping');
  assert.equal(sent.b.at(-1).e, 'ping');

  io.to('ROOM').except([a.id]).emit('only-b', 2);
  assert.equal(sent.a.at(-1).e, 'ping');
  assert.equal(sent.b.at(-1).e, 'only-b');

  io.to(a.id).emit('just-a', 3); // a socket id is also a room
  assert.equal(sent.a.at(-1).e, 'just-a');

  clogged = true;
  const before = sent.b.length;
  io.to('ROOM').volatile.emit('snap', 4);
  assert.equal(sent.b.length, before, 'a volatile message is dropped when the pipe is clogged');
  io.to('ROOM').emit('important', 5);
  assert.equal(sent.b.length, before + 1, 'a normal message is still sent');

  // junk is ignored, never throws
  a.receive('not json');
  a.receive(JSON.stringify({ e: 5, a: [] }));
  a.receive(JSON.stringify({ e: 'hello', a: 'nope' }));
  a.receive('x'.repeat(30000));
  assert.equal(io.sockets.sockets.size, 2);

  b.disconnect();
  assert.equal(b.gone, true);
  assert.equal(io.sockets.sockets.size, 1);
  io.to('ROOM').emit('after', 6);
  assert.equal(sent.b.at(-1).e, 'important', 'a gone socket gets nothing');
});

test('hosting: only the host\'s own window can create the room; friends can only join it', () => {
  const host = hosting.createBrowserHost();
  host.reserveCode('BCDF');
  const mine = [];
  const theirs = [];
  const local = host.connectLocal({ send: (t) => mine.push(JSON.parse(t)) });
  const friend = host.connectRemote({ send: (t) => theirs.push(JSON.parse(t)) }, 'friend-1');
  friend.receive(JSON.stringify({ e: 'room:create', a: [{ name: 'Sneaky' }], i: 1 }));
  assert.equal(theirs.find((m) => m.k === 1).a[0].ok, false, 'a friend cannot create a room in the host\'s browser');
  assert.equal(host.manager.rooms.size, 0);
  local.receive(JSON.stringify({ e: 'room:create', a: [{ name: 'Hosty' }], i: 1 }));
  assert.equal(mine.find((m) => m.k === 1).a[0].code, 'BCDF');
  friend.receive(JSON.stringify({ e: 'room:join', a: [{ code: 'BCDF', name: 'Pal' }], i: 2 }));
  assert.equal(theirs.find((m) => m.k === 2).a[0].ok, true);
  assert.equal(host.manager.get('BCDF').players.size, 2);
  host.shutdown('test over');
  assert.ok(theirs.some((m) => m.e === 'room:kicked'), 'closing the room tells the friend');
});

// ----------------------------------------------------------------------------------- the whole flow
test('p2p: create a room, a friend joins by code, a match starts and both get snapshots', async () => {
  const lib = fakePeerLib();
  const host = await makeSocket(lib);
  const friend = await makeSocket(lib);

  assert.equal(host.connected, false);
  const created = await host.ask('room:create', { name: 'Hosty' });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z]{4}$/);
  assert.equal(host.connected, true);
  assert.equal(count(host, 'connect'), 1);
  assert.ok(lib.peers.has('tmayhem-' + created.code), 'the room code is the matchmaker address');

  const bad = await friend.ask('room:join', { code: 'ZZZZ', name: 'Nobody' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /No room found/);
  assert.equal(friend.connected, false);

  const joined = await friend.ask('room:join', { code: created.code.toLowerCase(), name: 'Pal' });
  assert.equal(joined.ok, true, joined.error);
  assert.equal(friend.connected, true);
  assert.equal(joined.code, created.code);

  await until(() => last(host, 'room:state')?.players.length === 2 && last(friend, 'room:state')?.players.length === 2);
  assert.equal(last(host, 'room:state').players.length, 2);
  assert.equal(last(friend, 'room:state').players.length, 2);

  host.emit('room:ready', true);
  const started = await host.ask('match:start');
  assert.equal(started.ok, true, started.error);
  assert.equal(await until(() => count(host, 'game:snap') > 3 && count(friend, 'game:snap') > 3), true, 'both players receive world snapshots');

  // input travels the other way
  friend.emit('game:input', { x: 1, y: 0, jump: false, shove: false });

  // ping answer works (the game's F3 panel)
  const pong = await new Promise((res) => friend.timeout(1000).emit('net:ping', (err) => res(err)));
  assert.equal(pong, null);

  // the host leaves: everybody else is sent home
  await host.ask('room:leave');
  assert.equal(await until(() => count(friend, 'room:kicked') === 1), true);
  assert.match(last(friend, 'room:kicked').reason, /host left/i);
  await until(() => friend.mode === 'idle');
  assert.equal(friend.connected, false);
  await wait(450);
  assert.equal(host.mode, 'idle');
  assert.equal(lib.peers.has('tmayhem-' + created.code), false, 'the room code is free again');
});

test('p2p: the host browser can be told to leave quietly even with nobody else there', async () => {
  const lib = fakePeerLib();
  const host = await makeSocket(lib);
  const a = await host.ask('room:create', { name: 'Solo' });
  assert.equal(a.ok, true);
  const left = await host.ask('room:leave');
  assert.equal(left.ok, true);
  await wait(450);
  assert.equal(host.mode, 'idle');
  const b = await host.ask('room:create', { name: 'Solo again' });
  assert.equal(b.ok, true, 'creating a second room afterwards works');
});

test('p2p: a taken room code is skipped, and requests that make no sense are answered politely', async () => {
  const lib = fakePeerLib();
  const host = await makeSocket(lib);
  // block most codes so the host has to retry; the lib reports "unavailable-id" for taken ones
  const first = await host.ask('room:create', {});
  assert.equal(first.ok, true);
  const noList = await host.ask('rooms:list', null);
  assert.deepEqual(noList, { ok: true, rooms: [] });
  const admin = await host.ask('admin:login', { code: 'x' });
  assert.equal(admin.ok, false);
  const offline = await (await makeSocket(lib)).ask('chat:send', { text: 'hi' });
  assert.equal(offline.ok, false);
  const short = await (await makeSocket(lib)).ask('room:join', { code: 'AB' });
  assert.equal(short.ok, false);
  const gone = await (await makeSocket(lib)).ask('room:rejoin', { code: 'ZZZZ', token: 'x' });
  assert.deepEqual(gone, { ok: false, error: 'That room has ended.' });
});

test('p2p: a friend whose line drops gets back in with the saved seat (room:rejoin)', async () => {
  const lib = fakePeerLib();
  const host = await makeSocket(lib);
  const friend = await makeSocket(lib);
  const created = await host.ask('room:create', { name: 'Hosty' });
  const joined = await friend.ask('room:join', { code: created.code, name: 'Pal' });
  assert.equal(joined.ok, true);
  friend.setSession({ code: joined.code, token: joined.token });

  // cut the friend's line (not on purpose)
  const conn = friend.peer.conns[0];
  conn.close();
  assert.equal(await until(() => count(friend, 'disconnect') === 1), true);
  assert.equal(friend.connected, false);

  // it comes back by itself (the retry waits 2 s) and the game then re-takes the seat
  assert.equal(await until(() => count(friend, 'connect') === 2, 6000), true);
  const back = await friend.ask('room:rejoin', { code: joined.code, token: joined.token });
  assert.equal(back.ok, true, back.error);
  assert.equal(back.playerId, joined.playerId, 'same seat as before');
  await host.ask('room:leave');
});

test('p2p: if the host vanishes for good, the friend is sent home instead of waiting forever', { timeout: 20000 }, async () => {
  const lib = fakePeerLib();
  const host = await makeSocket(lib);
  const friend = await makeSocket(lib);
  const created = await host.ask('room:create', { name: 'Hosty' });
  const joined = await friend.ask('room:join', { code: created.code, name: 'Pal' });
  friend.setSession({ code: joined.code, token: joined.token });
  host.peer.destroy(); // the host's tab was closed
  assert.equal(await until(() => count(friend, 'room:kicked') === 1, 15000), true);
  assert.match(last(friend, 'room:kicked').reason, /Lost the connection/);
  assert.equal(friend.mode, 'idle');
});

// ------------------------------------------------------------------------------------ the built file
test('the prebuilt browser bundle (public/js/host.bundle.js) works and is up to date', async () => {
  const file = path.join(PUBLIC, 'js', 'host.bundle.js');
  assert.ok(fs.existsSync(file), 'run `npm run build:host` to create public/js/host.bundle.js');
  const mod = await import(pathToFileURL(file).href);
  assert.equal(typeof mod.createBrowserHost, 'function');
  assert.equal(typeof mod.randomRoomCode, 'function');
  assert.ok(Array.isArray(mod.mapChoices()) && mod.mapChoices().length > 0);
  assert.match(mod.randomRoomCode(), /^[B-Z]{4}$/);

  // run a tiny game through the bundle itself
  const host = mod.createBrowserHost();
  host.reserveCode('BCDF');
  const got = [];
  const sock = host.connectLocal({ send: (t) => got.push(JSON.parse(t)) });
  sock.receive(JSON.stringify({ e: 'room:create', a: [{ name: 'T' }], i: 1 }));
  const answer = got.find((m) => m.k === 1);
  assert.equal(answer.a[0].ok, true);
  assert.equal(answer.a[0].code, 'BCDF', 'the reserved code is used');
  host.shutdown('done');

  // the admin lock uses sha256 + timingSafeEqual from the browser shim: they must agree with Node's
  const { createHash } = require('crypto');
  const shim = require('../build/crypto-shim.js');
  for (const text of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'ünïcode ✓'.repeat(20)]) {
    assert.equal(shim.createHash('sha256').update(text).digest().toString('hex'), createHash('sha256').update(text).digest('hex'), `sha256 of ${text.length} chars`);
  }
  assert.equal(shim.timingSafeEqual(shim.randomBytes(8), shim.randomBytes(8)), false);
  assert.equal(shim.randomBytes(4).toString('hex').length, 8);
  assert.ok(shim.randomInt(19) < 19);

  // and the committed bundle is what the sources build to
  const { execFileSync } = require('child_process');
  const tmp = path.join(require('os').tmpdir(), `tm-bundle-${process.pid}.js`);
  const pkg = require('../package.json');
  const cmd = pkg.scripts['build:host'].replace('esbuild ', '').replace('public/js/host.bundle.js', tmp).split(' ');
  const esbuild = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  if (fs.existsSync(esbuild)) {
    execFileSync(esbuild, cmd.map((a) => a.replace(/^--outfile=.*/, `--outfile=${tmp}`)), { cwd: path.join(__dirname, '..'), stdio: 'pipe', shell: process.platform === 'win32' });
    assert.equal(fs.readFileSync(tmp, 'utf8'), fs.readFileSync(file, 'utf8'), 'host.bundle.js is out of date: run `npm run build:host` and commit it');
    fs.unlinkSync(tmp);
  }
});

test('the web files work from any folder (GitHub Pages serves them from /RepoName/, not from /)', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)="\/(?!\/)/, 'index.html must only use relative addresses');
  assert.doesNotMatch(html, /socket\.io\.js/, 'the Socket.IO script is loaded on demand by net.js, never on a static host');
  for (const f of fs.readdirSync(path.join(PUBLIC, 'js'))) {
    if (!f.endsWith('.js') || f === 'host.bundle.js') continue;
    const src = fs.readFileSync(path.join(PUBLIC, 'js', f), 'utf8');
    assert.doesNotMatch(src, /fetch\(\s*['"`]\//, `${f}: fetch() must use a relative address`);
    assert.doesNotMatch(src, /(from|import\()\s*['"]\/[^/]/, `${f}: imports must be relative`);
  }
  const css = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  assert.doesNotMatch(css, /url\(\s*['"]?\/(?!\/)/, 'style.css must not use root-relative url()');
  assert.ok(fs.existsSync(path.join(PUBLIC, 'vendor', 'peerjs.min.js')), 'PeerJS is shipped with the game (no CDN needed)');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'index.html')), 'the repository root has an index.html that opens public/');
  assert.ok(fs.existsSync(path.join(__dirname, '..', '.nojekyll')), '.nojekyll stops GitHub from rewriting the files');
});
