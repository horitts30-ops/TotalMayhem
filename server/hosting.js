'use strict';

// ---------------------------------------------------------------------------
// hosting.js - the game server, packaged to run INSIDE a browser tab (GitHub Pages mode).
//
// `npm run build:host` bundles this file (and everything it needs from server/) into public/js/host.bundle.js.
// The browser of the person who clicks "Create a room" loads that bundle, runs the game from it, and the other
// players connect to this browser over WebRTC. See public/js/p2pnet.js for the browser side of the wiring.
// ---------------------------------------------------------------------------

const { FakeIO } = require('./fakeio');
const { createGameCore } = require('./core');
const { mapChoices } = require('./maps');
const { makeRoomCode } = require('./util');

// Browsers slow timers down a lot in a background tab (about 1 tick per second), which would freeze the game for
// everybody while the host looks at another tab. Timers inside a Web Worker are not slowed that much, so the
// worker does the ticking. (Where there is no Worker, such as in the automated tests, a normal timer is used.)
function startTicker(fn, ms) {
  try {
    if (typeof Worker === 'function' && typeof Blob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL) {
      const url = URL.createObjectURL(new Blob([`setInterval(function(){postMessage(0)},${ms});`], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = () => fn();
      return () => {
        w.terminate();
        URL.revokeObjectURL(url);
      };
    }
  } catch (err) {
    /* fall through to a plain timer */
  }
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}

function createBrowserHost(options = {}) {
  const io = new FakeIO();
  let reservedCode = null;
  const core = createGameCore({
    io,
    config: { MAX_ROOMS: 1, ...(options.config || {}) },
    log: options.log || (() => {}),
    gameOptions: options.gameOptions,
    hooks: {
      // Only the person whose browser this is may create the room; friends who connect can only join it.
      canCreate: (socket) => socket.data.local === true,
      pickCode: () => reservedCode,
    },
  });
  let stopTicker = null;
  let closed = false;

  return {
    io,
    core,
    manager: core.manager,

    // The room code is also the WebRTC address, so it is reserved with the matchmaker BEFORE the room is made.
    reserveCode(code) {
      reservedCode = code;
    },

    // The host's own game window. Not a network connection: it talks straight to the game inside this page.
    connectLocal(pipe) {
      const socket = io.addConnection(pipe, { address: 'host' });
      socket.data.local = true;
      return socket;
    },

    // A friend connected over WebRTC.
    connectRemote(pipe, address) {
      return io.addConnection(pipe, { address: address || 'peer' });
    },

    start() {
      core.resetClock();
      const ms = Math.max(4, Math.floor(1000 / core.cfg.TICK_RATE / 3));
      stopTicker = startTicker(core.loop, ms);
    },

    // Tell everybody the room is over, then stop the clock.
    shutdown(reason) {
      if (closed) return;
      closed = true;
      for (const code of [...core.manager.rooms.keys()]) core.manager.closeRoom(code, reason || 'The host closed the room.');
      if (stopTicker) stopTicker();
      stopTicker = null;
    },

    mapChoices,
  };
}

// A random 4-letter room code (consonants only), skipping codes for which `isTaken(code)` is true.
function randomRoomCode(isTaken) {
  return makeRoomCode(isTaken || (() => false));
}

module.exports = { createBrowserHost, randomRoomCode };
