'use strict';

// ===========================================================================
// HILL HUSTLE  -  minigame #4 (category: King of the Hill)
//
// A glowing circle (the hill) sits somewhere in the arena. Stand on it ALONE
// to score. If two or more players are on it, nobody scores - so shove the
// others off! The hill hops to a new place every few seconds (with a warning
// ring first). Most time on the hill wins.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, r2 } = ArenaGame;

const TUNING = {
  maxTime: 60,
  radius: 88,
  moveEvery: 12,
  warnTime: 2.0, // the next spot is shown this long before the hill moves
  glideTime: 0.8,
  minHop: 220, // the new spot is at least this far from the old one
  shoveSpeed: 1.2, // shoves are a bit stronger here
};

const VARIANTS = {
  classic: {
    name: 'Hill Hustle',
    tagline: 'Stand on the hill. Alone. Good luck with that.',
    theme: 'jungle',
    moveEvery: 12,
    radius: 88,
  },
  moving: {
    name: 'Hill Hustle: Moving Day',
    tagline: 'The hill has places to be.',
    theme: 'moon',
    moveEvery: 7,
    radius: 80,
    gravity: 0.6, // floaty dodges
    jump: 0.8,
    slide: 0.7,
  },
};

const INSTRUCTIONS = [
  'Stand on the glowing hill ALONE to score points.',
  'Two or more players on it? Nobody scores. SHOVE rivals off!',
  'The hill hops to a new spot every few seconds. Watch for the warning ring.',
  'JUMP to dodge a shove. Most hill time wins.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (dodge)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

// Rage Bait mode: the same game, tuned to be much harder (see server/rage.js).
const RAGE = { radius: 60, moveEvery: 7, warnTime: 1.0, minHop: 320 };

class HillHustle extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, { shoveSpeed: TUNING.shoveSpeed, ...VARIANTS[id] }, options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };
    if (this.rage) Object.assign(this.cfg, RAGE);

    this.zone = { x: this.center.x, y: this.center.y };
    this.glide = null; // { fromX, fromY, toX, toY, t }
    this.next = null; // { x, y } shown as a warning
    this.nextMoveAt = this.cfg.moveEvery;
    this.occupants = [];
    this.holderId = null;
    this.contested = false;
    for (const p of this.players.values()) {
      p.hillTime = 0;
      p.contestedTime = 0;
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'hillHustle',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'King of the Hill',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'sec', scoreDir: 'high' });
  }

  // ---- rules ---------------------------------------------------------------------
  _update(dt) {
    this._moveZone(dt);

    this.occupants = this._livePlayers().filter(
      (p) => p.z <= 24 && Math.hypot(p.x - this.zone.x, p.y - this.zone.y) <= this.cfg.radius
    );
    if (this.occupants.length === 1) {
      const p = this.occupants[0];
      p.hillTime += dt;
      this.holderId = p.id;
      this.contested = false;
    } else {
      this.holderId = null;
      this.contested = this.occupants.length > 1;
      if (this.contested) for (const p of this.occupants) p.contestedTime += dt;
    }
  }

  _moveZone(dt) {
    if (this.glide) {
      this.glide.t += dt;
      const k = Math.min(1, this.glide.t / this.cfg.glideTime);
      const e = k * k * (3 - 2 * k); // smooth in and out
      this.zone.x = this.glide.fromX + (this.glide.toX - this.glide.fromX) * e;
      this.zone.y = this.glide.fromY + (this.glide.toY - this.glide.fromY) * e;
      if (k >= 1) this.glide = null;
    }

    if (!this.next && this.time >= this.nextMoveAt - this.cfg.warnTime) {
      this.next = this._pickSpot();
      this.events.push({ k: 'zoneWarn', x: r1(this.next.x), y: r1(this.next.y) });
    }
    if (this.next && this.time >= this.nextMoveAt) {
      this.glide = { fromX: this.zone.x, fromY: this.zone.y, toX: this.next.x, toY: this.next.y, t: 0 };
      this.next = null;
      this.nextMoveAt += this.cfg.moveEvery;
      this.events.push({ k: 'zoneMove' });
    }
  }

  // A spot that is fully inside the arena and a good hop away from the old one.
  _pickSpot() {
    const m = this.cfg.radius * 0.6 + 14;
    let best = null;
    for (let i = 0; i < 40; i++) {
      const pt = this._randomPoint(m);
      const d = Math.hypot(pt.x - this.zone.x, pt.y - this.zone.y);
      if (d >= this.cfg.minHop) return pt;
      if (!best || d > best.d) best = { x: pt.x, y: pt.y, d };
    }
    return { x: best.x, y: best.y };
  }

  _scoreOf(p) {
    return Math.floor(p.hillTime);
  }

  _rankKey(p) {
    return Math.round(p.hillTime * 10); // tenths of a second
  }

  _detail(p) {
    return `${p.hillTime.toFixed(1)}s on the hill`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'King of the Hill', (pool) => pool.find((r) => r.place === 1 && P(r).hillTime >= 3) || null);
    this._give(rows, 'Professional Pusher', (pool) => this._maxBy(pool, (r) => byId.get(r.id).hitsDealt, 6));
    this._give(rows, 'Hill Hugger', (pool) => this._maxBy(pool, (r) => P(r).contestedTime, 12));
    this._give(rows, 'Pogo Stick', (pool) => this._maxBy(pool, (r) => r.jumps, 12));
    this._give(rows, 'Flying Lesson', (pool) => this._maxBy(pool, (r) => r.hitsTaken, 6));
  }

  _hud() {
    if (this.time < 0) return '';
    if (this.contested) return 'Contested! Shove them off!';
    const h = this.holderId ? this.players.get(this.holderId) : null;
    if (h) return `${h.name} holds the hill`;
    return 'The hill is empty';
  }

  _extraSnapshot() {
    return {
      zone: {
        x: r1(this.zone.x),
        y: r1(this.zone.y),
        r: this.cfg.radius,
        ct: this.contested ? 1 : 0,
        hd: this.holderId,
        mv: this.glide ? 1 : 0,
        next: this.next
          ? {
              x: r1(this.next.x),
              y: r1(this.next.y),
              f: r2(Math.max(0, Math.min(1, 1 - (this.nextMoveAt - this.time) / this.cfg.warnTime))),
            }
          : null,
      },
    };
  }
}

HillHustle.GAME_ID = 'hillHustle';
HillHustle.TUNING = TUNING;
HillHustle.RAGE = RAGE;
HillHustle.VARIANTS = VARIANTS;

HillHustle.MAP_OK = true; // uses the floor shapes in server/maps.js
module.exports = HillHustle;
