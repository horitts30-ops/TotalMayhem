// p2pnet.js - the "no server needed" connection (this is what makes GitHub Pages hosting possible).
//
// The page offers the same small interface as a Socket.IO client (on / emit / timeout().emit / connected), so the
// rest of the game does not know the difference. Behind it:
//
//   * "Create a room"  -> THIS browser becomes the game server. It loads host.bundle.js (the real game rules from
//                         server/), claims a 4-letter room code with the free PeerJS matchmaker, and waits for friends.
//   * "Join"           -> this browser opens a direct WebRTC connection to the host's browser (code = address).
//
// Messages are the same ones the Node server understands (see server/fakeio.js for the wire format).
//
// Everything outside the browser is injected through `deps`, so tests can run this file in Node.

const PREFIX = 'tmayhem-'; // the matchmaker address of a room is PREFIX + the 4-letter code
const CONNECT_TIMEOUT_MS = 15000;
const RECONNECT_TRIES = 15;
const RECONNECT_GAP_MS = 2000;
const MAX_GUESTS = 16;

const NO_ROOM = (code) => `No room found with code "${code || '????'}". Check the code and try again. (The host must keep their browser tab open.)`;

function normalizeCode(raw) {
  return String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

class P2PSocket {
  constructor(deps) {
    this.deps = deps;
    this.connected = false;
    this.mode = 'idle'; // 'idle' | 'host' | 'guest'
    this._listeners = new Map();
    this._acks = new Map();
    this._nextAck = 1;
    this._send = null; // function(text) for the current connection
    this._close = null;
    this.peer = null;
    this.host = null;
    this.code = null;
    this._busy = null; // promise while a connection is being set up
    this._gen = 0; // bumped on every reset so late callbacks from an old connection are ignored
  }

  // ---- the Socket.IO-shaped surface -------------------------------------------------------
  on(ev, fn) {
    if (!this._listeners.has(ev)) this._listeners.set(ev, []);
    this._listeners.get(ev).push(fn);
    return this;
  }

  off(ev, fn) {
    const l = this._listeners.get(ev);
    if (l) this._listeners.set(ev, l.filter((f) => f !== fn));
    return this;
  }

  once(ev, fn) {
    const w = (...a) => {
      this.off(ev, w);
      fn(...a);
    };
    return this.on(ev, w);
  }

  emit(ev, ...args) {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    this._dispatch(ev, args, cb ? (res) => cb(res) : null, 0);
    return this;
  }

  // socket.timeout(ms).emit(event, data, (err, answer) => ...)  - same shape as Socket.IO
  timeout(ms) {
    return {
      emit: (ev, ...args) => {
        const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        this._dispatch(ev, args, cb ? (res, err) => (err ? cb(err) : cb(null, res)) : null, ms);
        return this;
      },
    };
  }

  _fire(ev, ...args) {
    for (const fn of (this._listeners.get(ev) || []).slice()) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[net] handler for "${ev}" failed:`, err);
      }
    }
  }

  // ---- sending ------------------------------------------------------------------------------
  // reply(answer, error) is called at most once (or null when nobody wants the answer).
  async _dispatch(ev, args, reply, timeoutMs) {
    const answer = (res, err) => {
      if (reply) reply(res, err);
    };
    const fail = (msg) => answer({ ok: false, error: msg });
    const data = args[0];

    if (ev === 'rooms:list') return answer({ ok: true, rooms: [] }); // there is no public list without a server
    if (ev.startsWith('admin:')) return fail('The admin panel only exists on a server you run yourself.');

    try {
      if (ev === 'room:create') {
        await this._startHosting();
      } else if (ev === 'room:join' || ev === 'room:rejoin') {
        const code = normalizeCode(data && data.code);
        if (code.length !== 4) return fail(NO_ROOM(code));
        if (!(this.connected && this.mode === 'guest' && this.code === code)) await this._connectGuest(code);
      } else if (!this.connected) {
        return fail('Not connected yet.');
      }
    } catch (err) {
      const msg = (err && err.message) || 'Could not connect.';
      return fail(ev === 'room:rejoin' ? 'That room has ended.' : msg);
    }

    const msg = { e: ev, a: args };
    let timer = null;
    if (reply) {
      const id = this._nextAck++;
      msg.i = id;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this._acks.delete(id);
          answer(undefined, new Error('operation has timed out'));
        }, timeoutMs);
      }
      this._acks.set(id, (res) => {
        if (timer) clearTimeout(timer);
        if (ev === 'room:leave') this._afterLeave();
        answer(res);
      });
    } else if (ev === 'room:leave') {
      setTimeout(() => this._afterLeave(), 0);
    }
    this._sendText(JSON.stringify(msg));
  }

  _sendText(text) {
    if (!this._send) return;
    try {
      this._send(text);
    } catch (err) {
      /* the connection reports its own closing */
    }
  }

  // A message arrived from the host.
  _onText(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      return;
    }
    if (!msg) return;
    if (msg.k !== undefined) {
      const fn = this._acks.get(msg.k);
      if (fn) {
        this._acks.delete(msg.k);
        fn(Array.isArray(msg.a) ? msg.a[0] : undefined);
      }
      return;
    }
    if (typeof msg.e !== 'string' || !Array.isArray(msg.a)) return;
    this._fire(msg.e, ...msg.a);
    if (msg.e === 'room:kicked') setTimeout(() => this._reset(), 50); // the room is over for us
  }

  // ---- becoming the host ------------------------------------------------------------------
  _singleFlight(fn) {
    if (this._busy) return this._busy;
    const p = fn().finally(() => {
      if (this._busy === p) this._busy = null;
    });
    this._busy = p;
    return p;
  }

  _startHosting() {
    return this._singleFlight(async () => {
      this._reset();
      const gen = this._gen;
      const [hostLib, Peer] = await Promise.all([this.deps.loadHost(), this.deps.loadPeer()]);
      const { peer, code } = await this._claimCode(Peer, hostLib);
      if (gen !== this._gen) {
        peer.destroy();
        throw new Error('Cancelled.');
      }
      const host = hostLib.createBrowserHost();
      host.reserveCode(code);
      host.start();
      this.peer = peer;
      this.host = host;
      this.code = code;
      this.mode = 'host';

      peer.on('connection', (conn) => this._acceptGuest(host, conn, gen));
      peer.on('disconnected', () => {
        // lost the matchmaker: friends already connected are fine, but new ones could not find us, so reconnect
        const again = () => {
          if (gen !== this._gen || peer.destroyed) return;
          try {
            peer.reconnect();
          } catch (err) {
            /* try again below */
          }
          setTimeout(() => {
            if (gen === this._gen && peer.disconnected && !peer.destroyed) again();
          }, 3000);
        };
        setTimeout(again, 1000);
      });
      peer.on('error', () => {}); // errors about one friend must not break the room

      // The host's own game window talks to the game in this page directly (no network).
      const sock = host.connectLocal({ send: (text) => queueMicrotask(() => gen === this._gen && this._onText(text)) });
      this._send = (text) => queueMicrotask(() => gen === this._gen && sock.receive(text));
      this._close = () => sock.disconnect();
      this.connected = true;
      this._fire('connect');
    });
  }

  // Try random codes until the matchmaker says one is free (two rooms can never share a code).
  async _claimCode(Peer, hostLib) {
    const tried = new Set();
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = hostLib.randomRoomCode((c) => tried.has(c));
      if (!code) break;
      tried.add(code);
      try {
        const peer = await this._openPeer(Peer, PREFIX + code);
        return { peer, code };
      } catch (err) {
        if (!(err && err.type === 'unavailable-id')) throw this._friendly(err);
      }
    }
    throw new Error('Could not get a free room code. Please try again.');
  }

  _openPeer(Peer, id) {
    return new Promise((resolve, reject) => {
      let done = false;
      let peer;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.off('open', onOpen);
        peer.off('error', onError); // later errors (about one friend, say) must not tear the Peer down
        fn(v);
      };
      const onOpen = () => finish(resolve, peer);
      const onError = (err) => {
        try {
          peer.destroy();
        } catch (e) {
          /* ignore */
        }
        finish(reject, err);
      };
      const timer = setTimeout(() => {
        try {
          peer.destroy();
        } catch (err) {
          /* ignore */
        }
        finish(reject, Object.assign(new Error('timeout'), { type: 'timeout' }));
      }, CONNECT_TIMEOUT_MS);
      peer = new Peer(id, this.deps.peerOptions || {});
      peer.on('open', onOpen);
      peer.on('error', onError);
    });
  }

  _friendly(err) {
    const type = err && err.type;
    if (type === 'peer-unavailable') return new Error(NO_ROOM(''));
    if (type === 'browser-incompatible') return new Error('This browser cannot do peer-to-peer connections. Try a recent Chrome, Edge, Firefox or Safari.');
    return new Error('Could not reach the free matchmaking service (PeerJS). Check your internet connection, or a VPN or firewall that blocks WebRTC, and try again.');
  }

  _acceptGuest(host, conn, gen) {
    conn.on('open', () => {
      if (gen !== this._gen) return conn.close();
      if (host.io.sockets.sockets.size > MAX_GUESTS) return conn.close();
      const pipe = {
        send: (text) => conn.send(text),
        canSend: () => {
          const dc = conn.dataChannel;
          return !dc || dc.bufferedAmount < 128 * 1024;
        },
      };
      const sock = host.connectRemote(pipe, conn.peer);
      conn.on('data', (d) => {
        if (typeof d === 'string') sock.receive(d);
      });
      const gone = () => sock.disconnect();
      conn.on('close', gone);
      conn.on('error', gone);
    });
  }

  // ---- joining somebody else's room ------------------------------------------------------
  _connectGuest(code) {
    return this._singleFlight(async () => {
      if (this.mode !== 'guest') this._reset();
      else this._dropConnection(); // same or other room: start from a clean connection (the Peer is kept)
      const gen = this._gen;
      const Peer = await this.deps.loadPeer();
      await this._openConn(Peer, code, gen);
      this.mode = 'guest';
      this.code = code;
      this.connected = true;
      this._fire('connect');
    });
  }

  async _ensurePeer(Peer) {
    if (this.peer && !this.peer.destroyed) {
      if (this.peer.disconnected) {
        try {
          this.peer.reconnect();
        } catch (err) {
          /* a new Peer is made below if it did not work */
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      if (!this.peer.disconnected) return this.peer;
      try {
        this.peer.destroy();
      } catch (err) {
        /* ignore */
      }
    }
    try {
      this.peer = await this._openPeer(Peer, undefined);
    } catch (err) {
      throw this._friendly(err);
    }
    return this.peer;
  }

  async _openConn(Peer, code, gen) {
    const peer = await this._ensurePeer(Peer);
    if (gen !== this._gen) throw new Error('Cancelled.');
    await new Promise((resolve, reject) => {
      let done = false;
      const conn = peer.connect(PREFIX + code, { serialization: 'raw', reliable: true });
      const timer = setTimeout(() => finish(reject, new Error(NO_ROOM(code))), CONNECT_TIMEOUT_MS);
      const onPeerError = (err) => {
        if (err && err.type === 'peer-unavailable') finish(reject, Object.assign(new Error(NO_ROOM(code)), { gone: true }));
      };
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.off('error', onPeerError);
        if (fn === reject) {
          try {
            conn.close();
          } catch (err) {
            /* ignore */
          }
        }
        fn(v);
      };
      peer.on('error', onPeerError);
      conn.on('error', () => finish(reject, new Error(NO_ROOM(code))));
      conn.on('open', () => {
        if (gen !== this._gen) return finish(reject, new Error('Cancelled.'));
        finish(resolve);
        this._send = (text) => conn.send(text);
        this._close = () => conn.close();
        conn.on('data', (d) => {
          if (gen === this._gen && typeof d === 'string') this._onText(d);
        });
        conn.on('close', () => this._onGuestClosed(Peer, conn, gen));
      });
    });
  }

  _onGuestClosed(Peer, conn, gen) {
    if (gen !== this._gen || this.mode !== 'guest' || this._send === null) return;
    this._send = null;
    this._close = null;
    this.connected = false;
    this._failAcks();
    this._fire('disconnect');
    this._reconnectLoop(Peer, gen);
  }

  async _reconnectLoop(Peer, gen) {
    let gone = 0;
    for (let n = 0; n < RECONNECT_TRIES; n++) {
      await new Promise((r) => setTimeout(r, RECONNECT_GAP_MS));
      if (gen !== this._gen || this.mode !== 'guest') return;
      if (!this.deps.hasSession()) break; // no seat to get back to
      try {
        await this._openConn(Peer, this.code, gen);
        this.connected = true;
        this._fire('connect'); // the game then re-takes its seat with the saved token (room:rejoin)
        return;
      } catch (err) {
        if (gen !== this._gen) return;
        gone = err && err.gone ? gone + 1 : 0;
        this._fire('connect_error', err);
        if (gone >= 4) break; // the host's address no longer exists: the room is closed
      }
    }
    if (gen !== this._gen) return;
    this._reset();
    this._fire('room:kicked', { reason: 'Lost the connection to the host. The room may have been closed.' });
  }

  // ---- leaving / cleaning up ---------------------------------------------------------------
  _afterLeave() {
    if (this.mode === 'host' && this.host) {
      const host = this.host;
      host.shutdown('The host left, so the room closed.');
      const gen = this._gen;
      // give the "you were removed" messages a moment to reach everybody before the line is cut
      setTimeout(() => {
        if (gen === this._gen) this._reset();
      }, 400);
      // the host is no longer in a room: pretend to be offline until the next Create / Join
      this._send = null;
      this.connected = false;
    } else if (this.mode === 'guest') {
      this._reset();
    }
  }

  _dropConnection() {
    const close = this._close;
    this._send = null;
    this._close = null;
    this.connected = false;
    this._failAcks();
    this._gen++;
    if (close) {
      try {
        close();
      } catch (err) {
        /* ignore */
      }
    }
  }

  _failAcks() {
    const pending = [...this._acks.values()];
    this._acks.clear();
    for (const fn of pending) fn({ ok: false, error: 'Connection lost.' });
  }

  _reset() {
    const host = this.host;
    const peer = this.peer;
    this._dropConnection();
    this.host = null;
    this.peer = null;
    this.code = null;
    this.mode = 'idle';
    if (host) host.shutdown('The host closed the room.');
    if (peer) {
      try {
        peer.destroy();
      } catch (err) {
        /* ignore */
      }
    }
  }

  // for the F3 panel
  transportName() {
    if (!this.connected) return 'none';
    return this.mode === 'host' ? 'host (this browser)' : 'webrtc';
  }

  async maps() {
    try {
      const lib = await this.deps.loadHost();
      return lib.mapChoices();
    } catch (err) {
      return [];
    }
  }
}

export function createP2PSocket(deps) {
  return new P2PSocket(deps);
}
