'use strict';

// ---------------------------------------------------------------------------
// The web server + Socket.IO wiring.
//
// createGameServer() builds everything but does not start listening, which
// lets the automated tests start a private copy on a random port.
// ---------------------------------------------------------------------------

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const BASE_CONFIG = require('./config');
const { RoomManager } = require('./room');
const { normalizeCode, cleanName } = require('./util');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createGameServer(options = {}) {
  const cfg = { ...BASE_CONFIG, ...(options.config || {}) };
  const log = options.quiet ? () => {} : (...a) => console.log(...a);

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    pingInterval: 10000,
    pingTimeout: 8000,
    maxHttpBufferSize: 20000, // inputs are tiny; refuse big payloads
  });

  app.disable('x-powered-by');
  app.use(express.static(PUBLIC_DIR));
  app.get('/health', (req, res) => res.type('text').send('ok'));

  const manager = new RoomManager(io, cfg, options.gameOptions);

  // ------------------------------------------------------------- sockets
  io.on('connection', (socket) => {
    let windowStart = Date.now();
    let windowCount = 0;

    const lookup = () => {
      const room = manager.get(socket.data.roomCode);
      const player = room ? room.players.get(socket.data.playerId) : null;
      if (!room || !player || player.socketId !== socket.id) return { room: null, player: null };
      return { room, player };
    };

    // Wrap every handler so one bad message can never crash the server.
    const on = (event, handler) => {
      socket.on(event, (...args) => {
        try {
          handler(...args);
        } catch (err) {
          log(`[error] handler "${event}":`, err && err.message);
          const cb = args[args.length - 1];
          if (typeof cb === 'function') cb({ ok: false, error: 'Something went wrong on the server.' });
        }
      });
    };
    const cbOf = (cb) => (typeof cb === 'function' ? cb : () => {});

    // Lets the game measure its own ping (shown with the F3 overlay).
    socket.on('net:ping', (cb) => {
      if (typeof cb === 'function') cb();
    });

    const leaveCurrentRoom = (remove) => {
      const { room, player } = lookup();
      if (room && player) {
        if (remove) room.removePlayer(player.id);
        else room.handleDisconnect(player.id);
      }
      if (socket.data.roomCode) socket.leave(socket.data.roomCode);
      socket.data.roomCode = null;
      socket.data.playerId = null;
    };

    const attach = (room, player) => {
      room.markConnected(player, socket.id);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);
    };

    on('room:create', (data, cb) => {
      cb = cbOf(cb);
      data = data && typeof data === 'object' ? data : {};
      if (socket.data.roomCode) leaveCurrentRoom(true);
      const room = manager.create();
      if (!room) return cb({ ok: false, error: 'The server is busy right now. Please try again in a minute.' });
      const player = room.addPlayer({ name: data.name, color: data.color, hat: data.hat, skin: data.skin });
      attach(room, player);
      log(`[room ${room.code}] created by ${player.name}`);
      cb({ ok: true, code: room.code, playerId: player.id, token: player.token });
      room.broadcastState();
    });

    on('room:join', (data, cb) => {
      cb = cbOf(cb);
      data = data && typeof data === 'object' ? data : {};
      const code = normalizeCode(data.code);
      const room = manager.get(code);
      if (code.length !== 4 || !room) return cb({ ok: false, error: `No room found with code "${code || '????'}". Check the code and try again.` });
      if (socket.data.roomCode) leaveCurrentRoom(true);
      let player;
      try {
        player = room.addPlayer({ name: data.name, color: data.color, hat: data.hat, skin: data.skin });
      } catch (err) {
        return cb({ ok: false, error: err.message });
      }
      attach(room, player);
      log(`[room ${room.code}] ${player.name} joined (${room.players.size} players, phase: ${room.phase})`);
      cb({ ok: true, code: room.code, playerId: player.id, token: player.token, lateJoin: room.phase !== 'lobby' && room.phase !== 'final' });
      room.broadcastState();
    });

    on('room:rejoin', (data, cb) => {
      cb = cbOf(cb);
      data = data && typeof data === 'object' ? data : {};
      const room = manager.get(normalizeCode(data.code));
      const player = room ? room.findByToken(data.token) : null;
      if (!room || !player) return cb({ ok: false, error: 'That room has ended.' });
      if (player.socketId && player.socketId !== socket.id) {
        const old = io.sockets.sockets.get(player.socketId);
        if (old) {
          old.leave(room.code);
          old.data.roomCode = null;
          old.data.playerId = null;
          old.emit('room:kicked', { reason: 'You opened this game somewhere else.' });
        }
      }
      attach(room, player);
      log(`[room ${room.code}] ${player.name} reconnected`);
      cb({ ok: true, code: room.code, playerId: player.id, token: player.token });
      room.broadcastState();
    });

    on('room:leave', (data, cb) => {
      leaveCurrentRoom(true);
      cbOf(cb)({ ok: true });
    });

    on('room:customize', (data) => {
      const { room, player } = lookup();
      if (!room) return;
      room.setCustomization(player.id, {
        name: data && data.name !== undefined ? cleanName(data.name) || undefined : undefined,
        color: data && data.color,
        hat: data && data.hat,
        skin: data && data.skin,
      });
    });

    // Pit stop (power-up shop between rounds). The server owns the purse.
    on('shop:buy', (id, cb) => {
      cb = cbOf(cb);
      const { room, player } = lookup();
      if (!room) return cb({ ok: false, error: 'Not in a room.' });
      const err = room.buyPowerup(player.id, typeof id === 'string' ? id : '');
      cb(err ? { ok: false, error: err } : { ok: true });
    });
    on('shop:refund', (id, cb) => {
      cb = cbOf(cb);
      const { room, player } = lookup();
      if (!room) return cb({ ok: false, error: 'Not in a room.' });
      const err = room.refundPowerup(player.id, typeof id === 'string' ? id : '');
      cb(err ? { ok: false, error: err } : { ok: true });
    });
    on('shop:done', (data) => {
      const { room, player } = lookup();
      if (room) room.setShopDone(player.id, data !== false);
    });

    on('room:ready', (data) => {
      const { room, player } = lookup();
      if (room) room.setReady(player.id, data === true || (data && data.ready === true));
    });

    on('room:rounds', (n, cb) => {
      const { room, player } = lookup();
      if (!room) return cbOf(cb)({ ok: false, error: 'Not in a room.' });
      const err = room.setRounds(player.id, n);
      cbOf(cb)(err ? { ok: false, error: err } : { ok: true });
    });

    on('match:start', (data, cb) => {
      cb = cbOf(typeof data === 'function' ? data : cb);
      const { room, player } = lookup();
      if (!room) return cb({ ok: false, error: 'Not in a room.' });
      const err = room.startMatch(player.id);
      if (!err) log(`[room ${room.code}] match started (${room.rounds} rounds, ${room.connectedPlayers().length} players)`);
      cb(err ? { ok: false, error: err } : { ok: true });
    });

    on('match:toLobby', (data, cb) => {
      cb = cbOf(typeof data === 'function' ? data : cb);
      const { room, player } = lookup();
      if (!room) return cb({ ok: false, error: 'Not in a room.' });
      const err = room.backToLobby(player.id);
      cb(err ? { ok: false, error: err } : { ok: true });
    });

    on('game:input', (data) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        windowCount = 0;
      }
      if (++windowCount > cfg.INPUT_RATE_LIMIT) return; // spam: ignore
      const { room, player } = lookup();
      if (room) room.setInput(player.id, data);
    });

    socket.on('disconnect', () => {
      const { room, player } = lookup();
      if (room && player) {
        log(`[room ${room.code}] ${player.name} disconnected`);
        room.handleDisconnect(player.id);
      }
    });
  });

  // ------------------------------------------------------------ game loop
  // Fixed-timestep loop: the simulation always advances in equal slices so the
  // game feels the same on every computer.
  const STEP = 1 / cfg.TICK_RATE;
  let last = Date.now();
  let acc = 0;
  let timer = null;

  function loop() {
    const now = Date.now();
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    manager.update(now);
    let stepped = false;
    while (acc >= STEP) {
      for (const room of manager.rooms.values()) room.step(STEP);
      acc -= STEP;
      stepped = true;
    }
    if (stepped) for (const room of manager.rooms.values()) room.flushSnapshot();
  }

  return {
    app,
    httpServer,
    io,
    manager,
    cfg,
    start(port = cfg.PORT, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          last = Date.now();
          // Wake up ~3x per tick. A single 33 ms timer that fires a few ms late
          // makes the world advance in uneven bursts (felt as judder); waking
          // often lets each fixed step run right on time.
          timer = setInterval(loop, Math.max(4, Math.floor(1000 / cfg.TICK_RATE / 3)));
          resolve(httpServer.address().port);
        });
      });
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      return new Promise((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}

module.exports = { createGameServer };
