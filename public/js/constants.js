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
];

export const HATS = [
  'No hat',
  'Party hat',
  'Crown',
  'Propeller cap',
  'Traffic cone',
  'Chef hat',
  'Bunny ears',
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
};

export const INK = '#2a1a3c'; // the dark outline colour used everywhere
