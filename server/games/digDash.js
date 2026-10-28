'use strict';

// ===========================================================================
// DIG DASH  -  minigame #12 (category: Treasure hunt)
//
// Big X marks appear on the floor. Stand on one and keep still to dig. When the
// hole is finished you find out what was buried there: treasure worth 1 to 5
// points... or a BOMB that blasts everybody nearby and costs the digger points.
// Nobody knows what is under an X until it is dug up (the server keeps it secret).
//
// Two diggers on the same X? Only the first to finish gets it, and the other
// starts over. SHOVE a digger and their hole fills back in. A shoved player has
// a second of immunity, and nobody is ever out of the game.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, r2 } = ArenaGame;

const TUNING = {
  maxTime: 60,
  maxSpots: 8,
  startSpots: 6,
  spawnEvery: 1.4,
  minSpotGap: 90, // new X marks keep this far from each other
  digRadius: 38,
  digTime: 1.2, // seconds of standing still
  stillSpeed: 70, // you must move slower than this to keep digging
  bombChance: 0.1,
  bombPenalty: 2,
  blastRadius: 105,
  blastStun: 0.9,
  blastKnock: 380,
  // weights for treasure values 1, 2, 3, 5
  values: [
    [1, 40],
    [2, 30],
    [3, 20],
    [5, 10],
  ],
};

const VARIANTS = {
  classic: {
    name: 'Dig Dash',
    tagline: 'X marks the spot. Probably. Maybe a bomb.',
    theme: 'jungle',
  },
  bombs: {
    name: 'Dig Dash: Bomb Squad',
    tagline: 'Faster digging. Many more bombs. Brave fools only.',
    theme: 'lava',
    bombChance: 0.28,
    digTime: 0.95,
  },
};

const INSTRUCTIONS = [
  'Stand on an X and keep still to dig. Finish the hole to find the treasure!',
  'Treasure is worth 1-5 points. But some holes hide a BOMB!',
  'Two diggers on one X? Only the first to finish gets it.',
  'SHOVE a digger and their hole fills back in. Most points wins.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (dodge)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

// Rage Bait mode: the same game, tuned to be much harder (see server/rage.js).
const RAGE = { bombChance: 0.3, digTime: 1.7, stillSpeed: 50, blastRadius: 150, blastKnock: 700, spawnEvery: 2.2, maxSpots: 6, startSpots: 4, bombPenalty: 3 };

class DigDash extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };
    if (this.rage) Object.assign(this.cfg, RAGE);

    this.spots = [];
    this.nextSpotId = 1;
    this.nextSpawn = 0;
    this.spawned = false;
    for (const p of this.players.values()) {
      p.points = 0;
      p.dugT = 0; // seconds spent digging the current hole
      p.dugSpot = 0; // which X (id) you are digging
      p.digs = 0;
      p.bombsHit = 0;
      p.bestFind = 0;
      p.interrupted = 0;
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'digDash',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Treasure hunt',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'points', scoreDir: 'high', digRadius: TUNING.digRadius });
  }

  // ---- rules ---------------------------------------------------------------------
  _update(dt) {
    if (!this.spawned) {
      this.spawned = true;
      for (let i = 0; i < this.cfg.startSpots; i++) this._addSpot();
      this.nextSpawn = this.time + this.cfg.spawnEvery;
    }
    if (this.time >= this.nextSpawn) {
      this.nextSpawn = this.time + this.cfg.spawnEvery;
      if (this.spots.length < this.cfg.maxSpots) this._addSpot();
    }
    for (const p of this._livePlayers()) this._dig(p, dt);
  }

  _addSpot() {
    for (let tries = 0; tries < 30; tries++) {
      const pt = this._randomPoint(50);
      if (this.spots.every((s) => Math.hypot(s.x - pt.x, s.y - pt.y) >= this.cfg.minSpotGap)) {
        this.spots.push({ id: this.nextSpotId++, x: pt.x, y: pt.y, ...this._bury() });
        return;
      }
    }
  }

  // What is under a new X. Only the server ever knows (it is never sent).
  _bury() {
    if (this.rng() < this.cfg.bombChance) return { bomb: true, value: 0 };
    const total = this.cfg.values.reduce((s, [, w]) => s + w, 0);
    let roll = this.rng() * total;
    for (const [v, w] of this.cfg.values) {
      roll -= w;
      if (roll < 0) return { bomb: false, value: v };
    }
    return { bomb: false, value: 1 };
  }

  _dig(p, dt) {
    const still = Math.hypot(p.vx, p.vy) < this.cfg.stillSpeed && p.z <= 0 && p.stun <= 0;
    let spot = null;
    if (still) {
      let bestD = this.cfg.digRadius;
      for (const s of this.spots) {
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d <= bestD) {
          bestD = d;
          spot = s;
        }
      }
    }
    if (!spot) {
      if (p.dugT > 0 && p.dugSpot) p.interrupted++;
      p.dugT = 0;
      p.dugSpot = 0;
      return;
    }
    if (p.dugSpot !== spot.id) {
      p.dugSpot = spot.id;
      p.dugT = 0;
    }
    p.dugT += dt;
    if (p.dugT >= this.cfg.digTime) this._finishDig(p, spot);
  }

  _finishDig(p, spot) {
    this.spots = this.spots.filter((s) => s.id !== spot.id);
    for (const q of this.players.values()) {
      if (q.dugSpot === spot.id) {
        q.dugSpot = 0;
        q.dugT = 0;
      }
    }
    p.digs++;
    if (spot.bomb) {
      p.bombsHit++;
      p.points = Math.max(0, p.points - this.cfg.bombPenalty);
      for (const q of this._livePlayers()) {
        const dx = q.x - spot.x;
        const dy = q.y - spot.y;
        const d = Math.hypot(dx, dy);
        if (d > this.cfg.blastRadius) continue;
        q.stun = Math.max(q.stun, this.cfg.blastStun);
        const ux = d > 1 ? dx / d : 1;
        const uy = d > 1 ? dy / d : 0;
        q.kx = ux * this.cfg.blastKnock;
        q.ky = uy * this.cfg.blastKnock;
        q.dugT = 0;
        q.dugSpot = 0;
      }
      this.events.push({ k: 'dugBomb', id: p.id, x: r1(spot.x), y: r1(spot.y) });
    } else {
      p.points += spot.value;
      p.bestFind = Math.max(p.bestFind, spot.value);
      this.events.push({ k: 'dug', id: p.id, x: r1(spot.x), y: r1(spot.y), v: spot.value });
    }
  }

  _onHit(attacker, victim) {
    if (victim.dugT > 0) victim.interrupted++;
    victim.dugT = 0;
    victim.dugSpot = 0;
  }

  // ---- scoring -------------------------------------------------------------------
  _scoreOf(p) {
    return p.points;
  }

  _rankKey(p) {
    return p.points;
  }

  _detail(p) {
    return `${p.points} point${p.points === 1 ? '' : 's'}`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Treasure Hunter', (pool) => pool.find((r) => r.place === 1 && P(r).points >= 10) || null);
    this._give(rows, 'Kaboom', (pool) => this._maxBy(pool, (r) => P(r).bombsHit, 2));
    this._give(rows, 'Lucky Duck', (pool) => this._maxBy(pool, (r) => P(r).bestFind, 5));
    this._give(rows, 'Digger Dog', (pool) => this._maxBy(pool, (r) => P(r).digs, 7));
    this._give(rows, 'Hole Filler', (pool) => this._maxBy(pool, (r) => P(r).interrupted, 4));
  }

  _hud() {
    if (this.time < 0) return '';
    return 'Stand still on an X to dig!';
  }

  _playerSnapshot(p) {
    return p.dugT > 0 ? { dp: r2(Math.min(1, p.dugT / this.cfg.digTime)) } : {};
  }

  _extraSnapshot() {
    // [id, x, y] - what is buried is a secret until somebody digs it up.
    return { ds: this.spots.map((s) => [s.id, r1(s.x), r1(s.y)]) };
  }
}

DigDash.GAME_ID = 'digDash';
DigDash.TUNING = TUNING;
DigDash.RAGE = RAGE;
DigDash.VARIANTS = VARIANTS;

DigDash.MAP_OK = true; // uses the floor shapes in server/maps.js
module.exports = DigDash;
