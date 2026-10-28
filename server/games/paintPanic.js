'use strict';

// ===========================================================================
// PAINT PANIC  -  minigame #8 (category: Territory)
//
// Every tile you walk over turns YOUR colour. Run around and paint as much of
// the floor as you can; the player who owns the most tiles when the clock runs
// out wins. Jumping lets you travel without painting.
//
// SHOVE a rival and the tiles around them splat over to YOUR colour. Fair-play
// rules: a shoved player has a second of immunity (so no endless splatting),
// and whoever is far behind gets a wider brush that paints two tiles at once.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, TILE, COLS, ROWS } = ArenaGame;

const TUNING = {
  maxTime: 60,
  paintHeight: 12, // above this you are flying and do not paint
  splatTiles: 3, // tiles that flip to the shover's colour when a shove connects
  catchUpGap: 8, // this many tiles behind the leader = wide brush
};

const VARIANTS = {
  classic: {
    name: 'Paint Panic',
    tagline: 'Walk it. Paint it. Own it.',
    theme: 'candy',
  },
  rush: {
    name: 'Paint Panic: Sugar Rush',
    tagline: 'Faster feet. Messier floor.',
    theme: 'pink',
    speed: 1.15,
  },
};

const INSTRUCTIONS = [
  'Every tile you walk over turns YOUR colour. Own the most tiles to win!',
  'SHOVE a rival and the tiles around them splat over to your colour.',
  'JUMP to travel without painting, or to dodge a shove.',
  'Far behind? You get a wide brush that paints two tiles at once.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (dodge)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

// Rage Bait mode: the same game, tuned to be much harder (see server/rage.js).
const RAGE = { splatTiles: 7, catchUpGap: 999 };

class PaintPanic extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };
    if (this.rage) Object.assign(this.cfg, RAGE);

    // Which tiles can be painted (the ones that exist in the rounded arena).
    this.paintable = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.paintable.push(ArenaGame.walkable(c * TILE + TILE / 2, r * TILE + TILE / 2));
      }
    }
    this.owner = new Array(COLS * ROWS).fill(-1); // player index, or -1
    this.order = []; // player ids, index = colour slot
    for (const p of this.players.values()) {
      p.idx = this.order.length;
      this.order.push(p.id);
      p.tiles = 0;
      p.painted = 0; // times you flipped a tile (any kind)
      p.lost = 0; // tiles other people took from you
      p.splats = 0; // tiles you flipped with a shove
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'paintPanic',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Territory',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'tiles', scoreDir: 'high' });
  }

  // ---- rules ---------------------------------------------------------------------
  _cellAt(x, y) {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
    const i = r * COLS + c;
    return this.paintable[i] ? i : -1;
  }

  // Gives tile `i` to player `p`. Returns true if the tile changed hands.
  _paint(p, i) {
    if (i < 0 || this.owner[i] === p.idx) return false;
    const prev = this.owner[i];
    if (prev >= 0) {
      const old = this.players.get(this.order[prev]);
      if (old) {
        old.tiles--;
        old.lost++;
      }
    }
    this.owner[i] = p.idx;
    p.tiles++;
    p.painted++;
    return true;
  }

  _update() {
    const live = this._livePlayers();
    const lead = live.reduce((m, p) => Math.max(m, p.tiles), 0);
    for (const p of live) {
      if (p.z > this.cfg.paintHeight) continue; // flying
      this._paint(p, this._cellAt(p.x, p.y));
      // Catch-up brush: also paint the tile just ahead of you.
      if (lead - p.tiles >= this.cfg.catchUpGap) {
        this._paint(p, this._cellAt(p.x + p.fx * TILE * 0.8, p.y + p.fy * TILE * 0.8));
      }
    }
  }

  // The tile under the victim, and the ones the shove pushes them across, flip.
  _onHit(attacker, victim) {
    const len = Math.hypot(victim.kx, victim.ky) || 1;
    const ux = victim.kx / len;
    const uy = victim.ky / len;
    let flipped = 0;
    for (let n = 0; n < this.cfg.splatTiles; n++) {
      if (this._paint(attacker, this._cellAt(victim.x + ux * TILE * n, victim.y + uy * TILE * n))) {
        attacker.splats++;
        flipped++;
      }
    }
    if (flipped) this.events.push({ k: 'splat', id: attacker.id, x: r1(victim.x), y: r1(victim.y), n: flipped });
  }

  // ---- scoring -------------------------------------------------------------------
  _scoreOf(p) {
    return p.tiles;
  }

  _rankKey(p) {
    return p.tiles;
  }

  _detail(p) {
    return p.tiles === 1 ? '1 tile' : `${p.tiles} tiles`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Picasso', (pool) => pool.find((r) => r.place === 1 && P(r).tiles >= 20) || null);
    this._give(rows, 'Splatter', (pool) => this._maxBy(pool, (r) => P(r).splats, 4));
    this._give(rows, 'Overpainted', (pool) => this._maxBy(pool, (r) => P(r).lost, 10));
    this._give(rows, 'Pogo Stick', (pool) => this._maxBy(pool, (r) => r.jumps, 12));
    this._give(rows, 'Tourist', (pool) => {
      const worst = Math.max(...pool.map((r) => r.place));
      const last = pool.filter((r) => r.place === worst && P(r).tiles <= 6);
      return pool.length >= 3 && last.length === 1 ? last[0] : null;
    });
  }

  _hud() {
    if (this.time < 0) return '';
    const live = this._livePlayers();
    if (live.length === 0) return '';
    const best = live.reduce((a, b) => (b.tiles > a.tiles ? b : a));
    return best.tiles > 0 ? `${best.name} owns ${best.tiles} tiles` : 'Paint the floor!';
  }

  _extraSnapshot() {
    // One character per tile: '.' = nobody's, '0'-'7' = the colour slot that owns it.
    let pt = '';
    for (let i = 0; i < this.owner.length; i++) pt += this.owner[i] < 0 ? '.' : String(this.owner[i]);
    return { pt, pi: this.order };
  }
}

PaintPanic.GAME_ID = 'paintPanic';
PaintPanic.TUNING = TUNING;
PaintPanic.RAGE = RAGE;
PaintPanic.VARIANTS = VARIANTS;

module.exports = PaintPanic;
