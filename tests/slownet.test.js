// Players whose network blocks WebSockets (so they fall back to slow HTTP polling) must still get the game.
// This is what a friend saw as "only the clouds, no map": every picture was being thrown away for them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioc } = require('socket.io-client');
const { createGameServer } = require('../server/app');
const { decodeSnap } = require('../server/snapcodec');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function ask(sock, ev, data) {
  return new Promise((resolve) => sock.emit(ev, data, resolve));
}

async function room(transports, extra = {}) {
  const server = createGameServer({ quiet: true, config: { INTRO_MS: 300, ...extra } });
  const port = await server.start(0, '127.0.0.1');
  const connect = () => ioc(`http://127.0.0.1:${port}`, { transports, forceNew: true, reconnection: false });
  return { server, port, connect };
}

async function playAndCount(transports, game) {
  const { server, connect } = await room(transports, { SCHEDULE_OVERRIDE: [{ game, variant: 'classic' }] });
  const a = connect();
  const b = connect();
  try {
    await new Promise((r) => a.on('connect', r));
    await new Promise((r) => b.on('connect', r));
    const made = await ask(a, 'room:create', { name: 'Host', color: 0, hat: 0, skin: 0, back: 0 });
    assert.ok(made.ok, JSON.stringify(made));
    const joined = await ask(b, 'room:join', { code: made.code, name: 'Friend', color: 1, hat: 0, skin: 0, back: 0 });
    assert.ok(joined.ok, JSON.stringify(joined));
    // the second player is the one on the slow connection being tested
    let snaps = 0;
    let withPlayers = 0;
    b.on('game:snap', (raw) => {
      snaps++;
      const s = decodeSnap(raw);
      if (s.ps && s.ps.length === 2) withPlayers++;
    });
    b.emit('room:ready', true);
    const start = await ask(a, 'match:start', {});
    assert.ok(start.ok, JSON.stringify(start));
    await wait(3500);
    return { snaps, withPlayers, transport: b.io.engine.transport.name };
  } finally {
    a.close();
    b.close();
    await server.stop();
  }
}

test('slow network: a player stuck on HTTP polling still receives game snapshots (not just the background)', async () => {
  const r = await playAndCount(['polling'], 'goldGrab');
  assert.equal(r.transport, 'polling');
  assert.ok(r.snaps >= 5, `polling player got ${r.snaps} snapshots`);
  assert.ok(r.withPlayers >= 5, 'and they contain the players');
});

test('slow network: a polling player gets the secret per-player views of Prop Hunt too', async () => {
  const r = await playAndCount(['polling'], 'propHunt');
  assert.ok(r.snaps >= 5, `polling player got ${r.snaps} snapshots in Prop Hunt`);
});

test('fast network: a WebSocket player still gets the full 30-a-second stream', async () => {
  const r = await playAndCount(['websocket'], 'goldGrab');
  assert.equal(r.transport, 'websocket');
  assert.ok(r.snaps >= 40, `websocket player got ${r.snaps} snapshots`);
});

test('slow network: a polling player never gets MORE pictures than the server makes (nothing is sent twice or queued up)', async () => {
  const r = await playAndCount(['polling'], 'goldGrab');
  assert.ok(r.snaps <= 3.5 * 30 + 5, `polling player got ${r.snaps}`);
});

test('the browser is told to really fall back to polling when WebSockets are blocked', () => {
  const fs = require('fs');
  const net = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'js', 'net.js'), 'utf8');
  assert.match(net, /tryAllTransports:\s*true/);
});
