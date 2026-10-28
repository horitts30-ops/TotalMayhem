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
const { AdminLock, cleanAnnouncement } = require('./admin');
const { EMOTES } = require('./emotes');
const { mapChoices } = require('./maps');

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
  app.get('/api/maps', (req, res) => res.json(mapChoices())); // the lobby's map picker reads this

  const manager = new RoomManager(io, cfg, options.gameOptions);
  const admin = new AdminLock(cfg.ADMIN_CODE);
  const startedAt = Date.now();

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
      const player = room.addPlayer({ name: data.name, color: data.color, hat: data.hat, skin: data.skin, back: data.back });
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
        player = room.addPlayer({ name: data.name, color: data.color, hat: data.hat, skin: data.skin, back: data.back });
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
        back: data && data.back,
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

    on('room:public', (on_, cb) => {
      const { room, player } = lookup();
      if (!room) return cbOf(cb)({ ok: false, error: 'Not in a room.' });
      const err = room.setPublic(player.id, on_ === true);
      cbOf(cb)(err ? { ok: false, error: err } : { ok: true, isPublic: room.isPublic });
    });

    // The home page asks for the list of public rooms. Limited to a few asks
    // per second so nobody can hammer the server with it.
    let listWindow = 0;
    let listCount = 0;
    on('rooms:list', (data, cb) => {
      cb = cbOf(typeof data === 'function' ? data : cb);
      const now = Date.now();
      if (now - listWindow >= 2000) {
        listWindow = now;
        listCount = 0;
      }
      if (++listCount > 4) return cb({ ok: false, error: 'Slow down a little.' });
      cb({ ok: true, rooms: manager.listPublic() });
    });

    // ---- emoji bubbles: a fixed list, one every 0.6 s per player ------------------------
    let lastEmote = 0;
    on('chat:emoji', (i) => {
      const { room, player } = lookup();
      if (!room) return;
      const now = Date.now();
      if (now - lastEmote < cfg.EMOTE_GAP_MS) return; // too fast: ignore
      if (!Number.isInteger(i) || i < 0 || i >= EMOTES.length) return;
      lastEmote = now;
      io.to(room.code).emit('chat:emoji', { id: player.id, e: i });
    });

    // ---- text chat between rounds (see server/chat.js for the safety rules) ----------------
    on('chat:send', (data, cb) => {
      cb = cbOf(cb);
      const { room, player } = lookup();
      if (!room) return cb({ ok: false, error: 'Not in a room.' });
      const err = room.postChat(player.id, data && typeof data === 'object' ? data.text : '', manager.chatOn);
      cb(err ? { ok: false, error: err } : { ok: true });
    });
    on('chat:history', (data, cb) => {
      cb = cbOf(typeof data === 'function' ? data : cb);
      const { room } = lookup();
      if (!room) return cb({ ok: false, error: 'Not in a room.' });
      cb({ ok: true, messages: room.chat, enabled: manager.chatOn });
    });

    // ---- admin panel: nothing works until the secret code was accepted on THIS connection ----
    const addr = socket.handshake && socket.handshake.address ? String(socket.handshake.address) : 'unknown';
    const isAdmin = () => socket.data.admin === true;
    const adminOnly = (cb, fn) => {
      cb = cbOf(cb);
      if (!isAdmin()) return cb({ ok: false, error: 'Not allowed.' });
      return fn(cb);
    };
    on('admin:login', (data, cb) => {
      cb = cbOf(cb);
      const res = admin.attempt(addr, data && typeof data === 'object' ? data.code : '');
      if (res.ok) {
        socket.data.admin = true;
        log(`[admin] login accepted (${addr})`);
        return cb({ ok: true });
      }
      log(`[admin] WRONG code from ${addr}`);
      cb({ ok: false, error: res.locked ? `Too many wrong tries. Try again in ${res.locked} seconds.` : 'That code is not right.', locked: res.locked || 0 });
    });
    on('admin:logout', (data, cb) => {
      socket.data.admin = false;
      cbOf(typeof data === 'function' ? data : cb)({ ok: true });
    });
    on('admin:status', (data, cb) =>
      adminOnly(typeof data === 'function' ? data : cb, (reply) => {
        const rooms = manager.overview();
        let players = 0;
        let connected = 0;
        for (const r of manager.rooms.values()) {
          players += r.players.size;
          connected += r.connectedPlayers().length;
        }
        reply({
          ok: true,
          stats: {
            uptimeSec: Math.round((Date.now() - startedAt) / 1000),
            rooms: manager.rooms.size,
            maxRooms: cfg.MAX_ROOMS,
            players,
            connected,
            sockets: io.engine ? io.engine.clientsCount : 0,
            memoryMB: Math.round(process.memoryUsage().rss / 1048576),
            node: process.version,
            chatOn: manager.chatOn,
          },
          rooms,
        });
      })
    );
    on('admin:chat', (data, cb) =>
      adminOnly(cb, (reply) => {
        const room = manager.get(normalizeCode(data && data.code));
        reply(room ? { ok: true, messages: room.chat } : { ok: false, error: 'That room is gone.' });
      })
    );
    on('admin:chatToggle', (data, cb) =>
      adminOnly(cb, (reply) => {
        manager.chatOn = data && data.on === true;
        log(`[admin] chat is now ${manager.chatOn ? 'ON' : 'OFF'}`);
        io.emit('chat:enabled', { enabled: manager.chatOn });
        reply({ ok: true, chatOn: manager.chatOn });
      })
    );
    on('admin:kick', (data, cb) =>
      adminOnly(cb, (reply) => {
        const ok = manager.kickPlayer(normalizeCode(data && data.code), data && typeof data.playerId === 'string' ? data.playerId : '');
        log(`[admin] kick ${data && data.code}/${data && data.playerId}: ${ok}`);
        reply(ok ? { ok: true } : { ok: false, error: 'That player is no longer there.' });
      })
    );
    on('admin:close', (data, cb) =>
      adminOnly(cb, (reply) => {
        const ok = manager.closeRoom(normalizeCode(data && data.code));
        log(`[admin] close room ${data && data.code}: ${ok}`);
        reply(ok ? { ok: true } : { ok: false, error: 'That room is already gone.' });
      })
    );
    on('admin:announce', (data, cb) =>
      adminOnly(cb, (reply) => {
        const text = cleanAnnouncement(data && data.text);
        if (!text) return reply({ ok: false, error: 'Write a message first.' });
        io.emit('server:announce', { text });
        log(`[admin] announcement: ${text}`);
        reply({ ok: true });
      })
    );

    on('room:rage', (on_, cb) => {
      const { room, player } = lookup();
      if (!room) return cbOf(cb)({ ok: false, error: 'Not in a room.' });
      const err = room.setRage(player.id, on_ === true);
      cbOf(cb)(err ? { ok: false, error: err } : { ok: true, rage: room.rage });
    });

    on('room:map', (pick, cb) => {
      const { room, player } = lookup();
      if (!room) return cbOf(cb)({ ok: false, error: 'Not in a room.' });
      const err = room.setMap(player.id, typeof pick === 'string' ? pick.slice(0, 20) : '');
      cbOf(cb)(err ? { ok: false, error: err } : { ok: true, mapPick: room.mapPick });
    });

    on('room:max', (n, cb) => {
      const { room, player } = lookup();
      if (!room) return cbOf(cb)({ ok: false, error: 'Not in a room.' });
      const err = room.setMaxPlayers(player.id, n);
      cbOf(cb)(err ? { ok: false, error: err } : { ok: true, maxPlayers: room.maxPlayers });
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
    admin,
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
