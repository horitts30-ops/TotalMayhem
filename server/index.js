'use strict';

// Entry point: `npm start` runs this file.

const os = require('os');
const { createGameServer } = require('./app');
const config = require('./config');

const server = createGameServer();

server
  .start(config.PORT)
  .then((port) => {
    console.log('');
    console.log('  TOTAL MAYHEM server is running!');
    console.log('');
    console.log(`  On this computer:   http://localhost:${port}`);
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  On your Wi-Fi/LAN:  http://${net.address}:${port}   (friends on the same network)`);
        }
      }
    }
    console.log('');
    const lock = server.admin;
    if (lock.tooShort) console.log('  (ADMIN_CODE is too short - it needs 6+ characters - so a random one is used instead.)');
    if (lock.generated) {
      console.log(`  ADMIN CODE (only for you; new every start): ${lock.code}`);
      console.log('  Use it with the small "Admin" link on the title screen.');
      console.log('  To pick your own: set ADMIN_CODE (see the README, "Admin panel").');
    } else {
      console.log('  Admin panel: ON (the code is the ADMIN_CODE you set).');
    }
    console.log('');
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  })
  .catch((err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${config.PORT} is already in use (is the game already running in another terminal?).`);
      console.error('  Close the other one, or pick another port:');
      console.error('    Mac/Linux:   PORT=3001 npm start');
      console.error('    Windows PowerShell:   $env:PORT=3001; npm start\n');
    } else {
      console.error('Could not start the server:', err);
    }
    process.exit(1);
  });

process.on('SIGINT', () => {
  console.log('\nShutting down. Bye!');
  process.exit(0);
});
