'use strict';

// ---------------------------------------------------------------------------
// Maps: the SHAPE of the floor for the open-arena minigames and Crumble Floor.
//
// A map is a 14 x 9 grid. '#' = solid floor, '.' = empty (you fall / cannot walk).
// To add a map: add one entry to MAP_LIST below. tests/maps.test.js checks that
// every map is one connected piece with enough room for 8 players, so a typo in
// a grid is caught before anyone plays it.
//
// Not every minigame uses maps: Color Call, Jump Rope, Lap Dash and Mole Stomp
// have their own fixed arenas. The games that do (Game.MAP_OK = true) get the
// floor, the spawn points and the centre from here.
// ---------------------------------------------------------------------------

const TILE = 64;
const COLS = 14;
const ROWS = 9;
const WORLD_W = COLS * TILE;
const WORLD_H = ROWS * TILE;
const MARGIN = 14; // a blob fits if its centre and 4 sides (this far out) are on solid floor

// The original rounded arena, kept exactly as it always was.
function classicRows() {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    let s = '';
    for (let c = 0; c < COLS; c++) {
      const nx = (c + 0.5 - COLS / 2) / (COLS / 2);
      const ny = (r + 0.5 - ROWS / 2) / (ROWS / 2);
      s += nx * nx + ny * ny <= 1.25 ? '#' : '.';
    }
    rows.push(s);
  }
  return rows;
}

const MAP_LIST = [
  { id: 'classic', name: 'Classic Oval', note: 'The original rounded arena.', rows: classicRows() },
  {
    id: 'plus',
    name: 'Plus Plaza',
    note: 'A big cross. The four arms are dead ends.',
    rows: [
      '....######....',
      '....######....',
      '....######....',
      '##############',
      '##############',
      '##############',
      '....######....',
      '....######....',
      '....######....',
    ],
  },
  {
    id: 'donut',
    name: 'Donut Hole',
    note: 'A ring around a pit. Run in circles.',
    rows: [
      '....######....',
      '..##########..',
      '.############.',
      '.####....####.',
      '.####....####.',
      '.####....####.',
      '.############.',
      '..##########..',
      '....######....',
    ],
  },
  {
    id: 'frame',
    name: 'Picture Frame',
    note: 'A thick frame with a bridge to the middle.',
    rows: [
      '##############',
      '##############',
      '##..........##',
      '##...####...##',
      '##############',
      '##...####...##',
      '##..........##',
      '##############',
      '##############',
    ],
  },
  {
    id: 'diamond',
    name: 'Diamond Dash',
    note: 'Pointy ends and a wide middle.',
    rows: [
      '......##......',
      '....######....',
      '..##########..',
      '.############.',
      '##############',
      '.############.',
      '..##########..',
      '....######....',
      '......##......',
    ],
  },
  {
    id: 'hourglass',
    name: 'Hourglass',
    note: 'Two big rooms and a tiny squeeze in the middle.',
    rows: [
      '##############',
      '.############.',
      '..##########..',
      '....######....',
      '......##......',
      '....######....',
      '..##########..',
      '.############.',
      '##############',
    ],
  },
  {
    id: 'stones',
    name: 'Stepping Stones',
    note: 'Five islands joined by narrow bridges.',
    rows: [
      '####......####',
      '####......####',
      '######..######',
      '.....####.....',
      '.....####.....',
      '.....####.....',
      '######..######',
      '####......####',
      '####......####',
    ],
  },
  {
    id: 'peaks',
    name: 'Twin Peaks',
    note: 'Two islands and one skinny bridge.',
    rows: [
      '.####....####.',
      '#####....#####',
      '#####....#####',
      '#####....#####',
      '##############',
      '#####....#####',
      '#####....#####',
      '#####....#####',
      '.####....####.',
    ],
  },
  {
    id: 'cheese',
    name: 'Swiss Cheese',
    note: 'Holes everywhere. Watch your step.',
    rows: [
      '....######....',
      '..##########..',
      '.###.####.###.',
      '.############.',
      '.####.##.####.',
      '.############.',
      '.###.####.###.',
      '..##########..',
      '....######....',
    ],
  },
  {
    id: 'field',
    name: 'Open Field',
    note: 'No corners to hide in. Wall to wall floor.',
    rows: Array.from({ length: ROWS }, () => '#'.repeat(COLS)),
  },
  {
    id: 'table',
    name: 'Tiny Table',
    note: 'Very small. Very crowded. Very shovey.',
    rows: [
      '..............',
      '..............',
      '....######....',
      '...########...',
      '...########...',
      '...########...',
      '....######....',
      '..............',
      '..............',
    ],
  },
];

// ------------------------------------------------------------------ helpers
function solidGrid(rows) {
  const out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) out.push(rows[r][c] === '#');
  return out;
}

function makeWalkable(solid) {
  const tileSolid = (x, y) => {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    return solid[r * COLS + c];
  };
  const m = MARGIN;
  return (x, y) => tileSolid(x, y) && tileSolid(x - m, y) && tileSolid(x + m, y) && tileSolid(x, y - m) && tileSolid(x, y + m);
}

// Spread-out starting points: the first is the tile farthest from the middle,
// each next one is the tile farthest from every point already chosen. Because
// of that, ANY number of players (2..8) gets a fair, spread-out start.
function buildSpawns(solid, count) {
  const cells = [];
  for (let i = 0; i < solid.length; i++) {
    if (solid[i]) cells.push({ x: (i % COLS) * TILE + TILE / 2, y: Math.floor(i / COLS) * TILE + TILE / 2 });
  }
  const chosen = [];
  let best = null;
  let bestD = -1;
  for (const c of cells) {
    const d = Math.hypot((c.x - WORLD_W / 2) / 1.5, c.y - WORLD_H / 2);
    if (d > bestD + 1e-9) {
      bestD = d;
      best = c;
    }
  }
  chosen.push(best);
  while (chosen.length < Math.min(count, cells.length)) {
    best = null;
    bestD = -1;
    for (const c of cells) {
      let d = Infinity;
      for (const s of chosen) d = Math.min(d, Math.hypot(c.x - s.x, c.y - s.y));
      if (d > bestD + 1e-9) {
        bestD = d;
        best = c;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

// The middle of the map if you can stand there, otherwise the nearest floor.
function buildCenter(solid, walkable) {
  if (walkable(WORLD_W / 2, WORLD_H / 2)) return { x: WORLD_W / 2, y: WORLD_H / 2 };
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < solid.length; i++) {
    if (!solid[i]) continue;
    const x = (i % COLS) * TILE + TILE / 2;
    const y = Math.floor(i / COLS) * TILE + TILE / 2;
    const d = Math.hypot(x - WORLD_W / 2, y - WORLD_H / 2);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

const MAPS = {};
for (const m of MAP_LIST) {
  const solid = solidGrid(m.rows);
  const walkable = makeWalkable(solid);
  MAPS[m.id] = {
    id: m.id,
    name: m.name,
    note: m.note,
    rows: m.rows,
    solid,
    walkable,
    center: buildCenter(solid, walkable),
    // the classic map keeps its original ellipse start (spawns = null)
    spawns: m.id === 'classic' ? null : buildSpawns(solid, 8),
  };
}

const MAP_IDS = MAP_LIST.map((m) => m.id);

function getMap(id) {
  return MAPS[id] || MAPS.classic;
}

// For the lobby drop-down.
function mapChoices() {
  return MAP_LIST.map((m) => ({ id: m.id, name: m.name, note: m.note }));
}

// Picks a map for one round. `pick` is the host's choice ('random' or a map id).
// "random" is the classic arena a third of the time, otherwise any other map.
function chooseMap(pick, rng = Math.random) {
  if (pick && pick !== 'random' && MAPS[pick]) return pick;
  if (rng() < 0.33) return 'classic';
  const others = MAP_IDS.filter((id) => id !== 'classic');
  return others[Math.min(others.length - 1, Math.floor(rng() * others.length))];
}

module.exports = { MAPS, MAP_IDS, getMap, mapChoices, chooseMap, makeWalkable, TILE, COLS, ROWS };
