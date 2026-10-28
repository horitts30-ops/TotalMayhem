'use strict';

// ---------------------------------------------------------------------------
// Central place for the numbers you are most likely to want to tweak.
// Change a value, restart the server (Ctrl+C, then `npm start`), and test.
// ---------------------------------------------------------------------------

module.exports = {
  // Network
  PORT: Number(process.env.PORT) || 3000,

  // Simulation: the server updates the game this many times per second and
  // sends every browser a snapshot of the world after each update.
  TICK_RATE: 30,

  // Rooms
  MAX_PLAYERS: 8,
  // 1 lets you test alone. Set to 2 when you only want "real" matches.
  MIN_PLAYERS_TO_START: 1,
  MAX_ROOMS: 200,

  // Match structure (all proposals - easy to change)
  DEFAULT_ROUNDS: 3,
  ALLOWED_ROUNDS: [1, 3, 5],
  INTRO_MS: 7000, // "how to play" card before each round
  RESULTS_MS: 9000, // funny results screen after each round
  PITSTOP_MS: 15000, // the power-up shop between rounds (0 turns power-ups off)
  ROUND_END_DELAY_MS: 1800, // pause after the last fall so everyone can see it

  // Disconnects
  RECONNECT_GRACE_MS: 30000, // how long a dropped player keeps their seat
  EMPTY_ROOM_TTL_MS: 60000, // how long a room with nobody connected lives

  // Admin panel: set the secret code with the ADMIN_CODE environment variable (6+ characters).
  // If it is not set, the server invents a random one at startup and prints it in the terminal.
  ADMIN_CODE: process.env.ADMIN_CODE || '',

  // Text chat between rounds (the server admin can also switch it off while running)
  CHAT_ENABLED: true,
  CHAT_GAP_MS: 1200, // least time between two messages from one player
  CHAT_FILTER: true, // mask a short list of swear words (see server/chat.js)

  // Emoji bubbles: the least time between two of them from one player
  EMOTE_GAP_MS: 600,

  // Safety: ignore a socket that spams more than this many inputs per second
  INPUT_RATE_LIMIT: 120,

  // Cosmetic choices that exist (the client draws them; the server only
  // checks that the numbers are in range).
  COLOR_COUNT: 12,
  HAT_COUNT: 22, // 16 normal + 6 you can only unlock with achievements
  SKIN_COUNT: 12, // 8 normal + 4 achievement skins
};
