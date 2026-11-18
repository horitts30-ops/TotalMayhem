'use strict';

// ---------------------------------------------------------------------------
// fakeio.js - a tiny stand-in for the part of Socket.IO's *server* that the game uses.
//
// Why it exists: GitHub Pages can only serve plain files, so there is no Node server. Instead, the browser of
// the person who creates a room runs the game rules (server/core.js) and acts as the server. The other players
// connect to that browser directly (WebRTC). core.js and room.js talk to "io" and "socket" objects, so this
// file gives them objects with the same shape, but instead of a network port they hand messages to whatever
// "pipe" you give them (a WebRTC data channel in the real game, a plain function in the tests).
//
// A pipe is just:  send(text) -> void   and (optional)   canSend() -> boolean   (false = the pipe is clogged)
//
// Wire format (JSON text, one message per string):
//   browser -> host:   { e: "room:join", a: [data], i: 7 }      i = "please answer", the answer comes back as
//   host -> browser:   { k: 7, a: [answer] }
//   host -> browser:   { e: "room:state", a: [state] }           plain event
// ---------------------------------------------------------------------------

const { randomId } = require('./util');

const MAX_MESSAGE_CHARS = 20000; // same limit the real server uses for incoming messages

class FakeSocket {
  constructor(io, pipe, info = {}) {
    this.io = io;
    this.id = randomId(8);
    this.data = {};
    this.handshake = { address: info.address || 'peer' };
    this.connected = true;
    this._pipe = pipe;
    this._handlers = new Map();
    this._rooms = new Set([this.id]);
  }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(fn);
    return this;
  }

  join(room) {
    this._rooms.add(room);
    this.io._join(room, this);
  }

  leave(room) {
    this._rooms.delete(room);
    this.io._leave(room, this);
  }

  emit(event, ...args) {
    this._write(JSON.stringify({ e: event, a: args }), false);
    return true;
  }

  // "volatile": if the pipe is clogged, drop this message instead of piling it up
  get volatile() {
    return { emit: (event, ...args) => this._write(JSON.stringify({ e: event, a: args }), true) };
  }

  _write(text, volatile) {
    if (!this.connected) return;
    try {
      if (volatile && this._pipe.canSend && !this._pipe.canSend()) return;
      this._pipe.send(text);
    } catch (err) {
      /* a broken pipe is handled when it reports "closed" */
    }
  }

  // The pipe received a text message from the browser on the other end.
  receive(text) {
    if (!this.connected || typeof text !== 'string' || text.length > MAX_MESSAGE_CHARS) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      return;
    }
    if (!msg || typeof msg.e !== 'string' || !Array.isArray(msg.a)) return;
    const list = this._handlers.get(msg.e);
    if (!list) return;
    const args = msg.a.slice(0, 4);
    if (Number.isInteger(msg.i)) {
      let answered = false;
      args.push((...res) => {
        if (answered) return; // an answer can only be given once
        answered = true;
        this._write(JSON.stringify({ k: msg.i, a: res }), false);
      });
    }
    for (const fn of list.slice()) fn(...args);
  }

  // The pipe closed (or the server wants this player gone).
  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this.io._remove(this);
    for (const fn of this._handlers.get('disconnect') || []) {
      try {
        fn('transport close');
      } catch (err) {
        /* ignore */
      }
    }
  }
}

class Targets {
  constructor(io, names) {
    this.io = io;
    this.names = names;
    this.skip = new Set();
    this.isVolatile = false;
  }

  except(list) {
    for (const n of [].concat(list || [])) this.skip.add(n);
    return this;
  }

  get volatile() {
    this.isVolatile = true;
    return this;
  }

  emit(event, ...args) {
    const text = JSON.stringify({ e: event, a: args }); // built once, sent to everybody
    const done = new Set();
    for (const name of this.names) {
      for (const s of this.io._members(name)) {
        if (done.has(s.id) || this.skip.has(s.id)) continue;
        done.add(s.id);
        s._write(text, this.isVolatile);
      }
    }
    return true;
  }
}

class FakeIO {
  constructor() {
    this._rooms = new Map(); // room name -> Set of sockets
    this._connectionHandlers = [];
    this.sockets = { sockets: new Map() }; // same path real Socket.IO uses: io.sockets.sockets.get(id)
    const self = this;
    this.engine = {
      get clientsCount() {
        return self.sockets.sockets.size;
      },
    };
  }

  on(event, fn) {
    if (event === 'connection') this._connectionHandlers.push(fn);
    return this;
  }

  // A new browser connected through `pipe`. Returns the socket; feed it with socket.receive(text).
  addConnection(pipe, info) {
    const socket = new FakeSocket(this, pipe, info);
    this.sockets.sockets.set(socket.id, socket);
    for (const fn of this._connectionHandlers) fn(socket);
    return socket;
  }

  to(name) {
    return new Targets(this, [name]);
  }

  emit(event, ...args) {
    return new Targets(this, [...this.sockets.sockets.keys()]).emit(event, ...args);
  }

  close(cb) {
    for (const s of [...this.sockets.sockets.values()]) s.disconnect();
    if (cb) cb();
  }

  // ---- internals -------------------------------------------------------------
  _join(room, socket) {
    if (!this._rooms.has(room)) this._rooms.set(room, new Set());
    this._rooms.get(room).add(socket);
  }

  _leave(room, socket) {
    const set = this._rooms.get(room);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this._rooms.delete(room);
  }

  _members(name) {
    const direct = this.sockets.sockets.get(name); // every socket is also a "room" named after its own id
    if (direct) return [direct];
    const set = this._rooms.get(name);
    return set ? [...set] : [];
  }

  _remove(socket) {
    this.sockets.sockets.delete(socket.id);
    for (const room of [...socket._rooms]) this._leave(room, socket);
  }
}

module.exports = { FakeIO, FakeSocket };
