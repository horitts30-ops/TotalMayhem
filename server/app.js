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

const { createGameCore } = require('./core');
const { mapChoices } = require('./maps');
const { compressedStatic } = require('./static');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createGameServer(options = {}) {
  const log = options.quiet ? () => {} : (...a) => console.log(...a);

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    pingInterval: 10000,
    pingTimeout: 8000,
    maxHttpBufferSize: 20000, // inputs are tiny; refuse big payloads
  });

  app.disable('x-powered-by');
  const fast = compressedStatic(PUBLIC_DIR); // smaller downloads (server/static.js); express.static below handles the rest
  app.use(fast);
  app.use(express.static(PUBLIC_DIR, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  app.get('/health', (req, res) => res.type('text').send('ok'));
  app.get('/api/maps', (req, res) => res.json(mapChoices())); // the lobby's map picker reads this

  // All the game rules and messages live in core.js (shared with the in-browser host).
  const core = createGameCore({ io, config: options.config, log, gameOptions: options.gameOptions });
  const { cfg, manager, admin, loop } = core;

  let timer = null;

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
          core.resetClock();
          // Wake up ~3x per tick. A single 33 ms timer that fires a few ms late
          // makes the world advance in uneven bursts (felt as judder); waking
          // often lets each fixed step run right on time.
          timer = setInterval(loop, Math.max(4, Math.floor(1000 / cfg.TICK_RATE / 3)));
          resolve(httpServer.address().port);
          if (!options.quiet) setTimeout(() => fast.warm(), 300); // compress the web files in the background
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
