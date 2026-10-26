// Shared look-and-feel constants for the browser.
// (The server only checks that a colour/hat NUMBER is in range; what it looks
// like is decided here, so you can restyle freely.)

// The game is drawn on a fixed-size "stage" and the whole stage is scaled to
// fit the window, so it looks the same on every screen size.
export const STAGE_W = 1024;
export const STAGE_H = 720;
// Where the arena's top-left corner sits on the stage.
export const OX = 64;
export const OY = 96;

export const COLORS = [
  { name: 'Tomato', hex: '#ff595e' },
  { name: 'Tangerine', hex: '#ff924c' },
  { name: 'Banana', hex: '#ffca3a' },
  { name: 'Lime', hex: '#8ac926' },
  { name: 'Ocean', hex: '#1982c4' },
  { name: 'Grape', hex: '#9b5de5' },
  { name: 'Bubblegum', hex: '#ff6fb5' },
  { name: 'Teal', hex: '#2ec4b6' },
  { name: 'Sky', hex: '#72ddf7' },
  { name: 'Lavender', hex: '#c8b6ff' },
  { name: 'Cocoa', hex: '#a0674b' },
  { name: 'Midnight', hex: '#3d3b6e' },
];

// Body patterns ("skins") drawn on top of the colour. Order matches the
// drawSkin() switch in renderer.js. The server only checks the number is in
// range (SKIN_COUNT in server/config.js).
export const SKINS = ['Plain', 'Spots', 'Stripes', 'Hearts', 'Stars', 'Zigzag', 'Checkers', 'Rainbow'];

export const HATS = [
  'No hat',
  'Party hat',
  'Crown',
  'Propeller cap',
  'Traffic cone',
  'Chef hat',
  'Bunny ears',
  'Top hat',
  'Wizard hat',
  'Cowboy hat',
  'Viking helmet',
  'Cat ears',
  'Halo',
  'Beanie',
  'Flower',
  'Pirate hat',
];

// One colour theme per minigame variant (each round looks different).
export const THEMES = {
  sunny: {
    bg: ['#37b4ff', '#7a5cff'],
    tileA: '#ffd166',
    tileB: '#ffc13b',
    side: '#d98a1f',
    crack: '#7a3b00',
    cloud: 'rgba(255,255,255,0.28)',
    ring: 'rgba(255,255,255,0.12)',
  },
  pink: {
    bg: ['#2b1055', '#e0409f'],
    tileA: '#ff9bd0',
    tileB: '#ff72b8',
    side: '#b02a73',
    crack: '#5a0f3a',
    cloud: 'rgba(255,200,240,0.22)',
    ring: 'rgba(255,255,255,0.10)',
  },
  icy: {
    bg: ['#0c3b94', '#74e0ff'],
    tileA: '#dcf7ff',
    tileB: '#b3ebff',
    side: '#5fb3d9',
    crack: '#2d6a8a',
    cloud: 'rgba(255,255,255,0.3)',
    ring: 'rgba(255,255,255,0.14)',
  },
  lava: {
    bg: ['#2a0707', '#ff5a1f'],
    tileA: '#7d4b3b',
    tileB: '#6b3e31',
    side: '#3a1a14',
    crack: '#ffb02e', // glowing cracks
    cloud: 'rgba(60,15,10,0.38)',
    ring: 'rgba(255,190,90,0.16)',
    deco: 'embers',
  },
  moon: {
    bg: ['#050a24', '#343a85'],
    tileA: '#cdd0de',
    tileB: '#b7bbcd',
    side: '#767c99',
    crack: '#343a58',
    cloud: 'rgba(170,185,255,0.13)',
    ring: 'rgba(180,200,255,0.14)',
    deco: 'plates',
  },
  candy: {
    bg: ['#ffd1ec', '#9be9ff'],
    tileA: '#fff1f7',
    tileB: '#ffd9ea',
    side: '#e48db5',
    crack: '#b0407a',
    cloud: 'rgba(255,255,255,0.55)',
    ring: 'rgba(255,120,190,0.2)',
    deco: 'sprinkles',
  },
  jungle: {
    bg: ['#0a3a2b', '#74d36f'],
    tileA: '#a3cf6b',
    tileB: '#8cbf55',
    side: '#4c7630',
    crack: '#2d4a12',
    cloud: 'rgba(225,255,205,0.22)',
    ring: 'rgba(255,255,255,0.1)',
    deco: 'leaves',
  },
};

export const INK = '#2a1a3c'; // the dark outline colour used everywhere

// The open-arena minigames (Gold Grab, Hot Potato, Hill Hustle) all use the
// same flat floor: every tile standing, rounded corners missing. This is the
// same shape the server uses (see buildFloor in server/games/arenaBase.js).
export const ARENA_COLS = 14;
export const ARENA_ROWS = 9;
export const ARENA_TILES = (() => {
  let s = '';
  for (let r = 0; r < ARENA_ROWS; r++) {
    for (let c = 0; c < ARENA_COLS; c++) {
      const nx = (c + 0.5 - ARENA_COLS / 2) / (ARENA_COLS / 2);
      const ny = (r + 0.5 - ARENA_ROWS / 2) / (ARENA_ROWS / 2);
      s += nx * nx + ny * ny <= 1.25 ? '0' : '_';
    }
  }
  return s;
})();
