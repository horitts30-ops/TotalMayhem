'use strict';

// ===========================================================================
// METEOR MAYHEM  -  minigame #6 (category: Survival)
//
// Red circles appear on the floor. A moment later a meteor lands on each one.
// Be somewhere else - or JUMP just as it lands, because the blast rolls
// underneath you. Getting hit knocks you flying and dizzy, but nobody is ever
// knocked out: the player who got hit the FEWEST times wins.
//
// Fair-play rules: the meteors do not "aim" at the last place player, there is
// a short invulnerable moment after a hit (no chain-bonking), and the storm
// starts gentle and speeds up so everybody gets a feel for it.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, r2 } = ArenaGame;

const TUNING = {
  maxTime: 60,
  firstAt: 1.2, // seconds after GO
  startEvery: 1.5, // seconds between meteors at the start...
  minEvery: 0.42, // ...down to this at the end
  rampTime: 50,
  fuse: 1.35, // warning time before impact
  radius: 74,
  aimAtPlayer: 0.55, // chance a meteor lands near a random player (so camping does not work)
  aimJitter: 110, // ...within this many pixels of them, never exactly on top
  blastSpeed: 470,
  hitStun: 0.8,
  hitImmune: 1.4,
  jumpClear: 34, // higher than this when it lands = you jumped over the blast
  doubleAfter: 30, // after this many seconds two land at once
  maxActive: 9,
};

const VARIANTS = {
  classic: {
    name: 'Meteor Mayhem',
    tagline: 'It is raining rocks. Rude.',
    theme: 'moon',
  },
  hail: {
    name: 'Meteor Mayhem: Icy Hail',
    tagline: 'Smaller. Faster. Slippery!',
    theme: 'icy',
    grip: 0.38,
    slide: 0.6,
    radius: 62,
    fuse: 1.15,
    startEvery: 1.2,
    minEvery: 0.36,
  },
};

const INSTRUCTIONS = [
  'Red circles show where meteors are about to land. Run out of them!',
  'Jump right as one lands and you hop over the blast.',
  'Nobody is ever out. The fewest hits when time runs out wins!',
  'You can still SHOVE rivals into the circles. Quick, but sneaky!',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (hop the blast)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

// Rage Bait mode: the same game, tuned to be much harder (see server/rage.js).
const RAGE = { firstAt: 0.8, startEvery: 0.95, minEvery: 0.26, fuse: 0.95, radius: 98, blastSpeed: 820, hitStun: 1.1, hitImmune: 0.7, doubleAfter: 12, maxActive: 14, aimAtPlayer: 0.75 };

class MeteorMayhem extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };
    if (this.rage) Object.assign(this.cfg, RAGE);

    this.meteors = []; // warning circles that have not landed yet
    this.nextId = 1;
    this.nextAt = this.cfg.firstAt;
    this.landed = 0;
    for (const p of this.players.values()) {
      p.hits = 0; // meteor hits (shoves do not count)
      p.lastHitAt = -1;
      p.dodges = 0; // jumped over a blast
      p.near = 0; // landed close by without being hit
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'meteorMayhem',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Survival',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'hits', scoreDir: 'low', jumpLabel: 'Jump (hop blasts)' });
  }

  // ---- rules -----------------------------------------------------------------
  _gap() {
    const k = Math.min(1, this.time / this.cfg.rampTime);
    return this.cfg.startEvery + (this.cfg.minEvery - this.cfg.startEvery) * k;
  }

  _update(dt) {
    let guard = 0;
    while (this.time >= this.nextAt && guard++ < 4) {
      this.nextAt += this._gap();
      const n = this.time > this.cfg.doubleAfter ? 2 : 1;
      for (let i = 0; i < n; i++) this._spawn();
    }
    for (const m of this.meteors) m.t += dt;
    const landing = this.meteors.filter((m) => m.t >= this.cfg.fuse);
    if (landing.length) {
      this.meteors = this.meteors.filter((m) => m.t < this.cfg.fuse);
      for (const m of landing) this._land(m);
    }
  }

  _spawn() {
    if (this.meteors.length >= this.cfg.maxActive) return;
    const live = this._livePlayers();
    let pt;
    if (live.length > 0 && this.rng() < this.cfg.aimAtPlayer) {
      const target = live[Math.floor(this.rng() * live.length)];
      const a = this.rng() * Math.PI * 2;
      const d = 30 + this.rng() * this.cfg.aimJitter;
      pt = { x: target.x + Math.cos(a) * d, y: target.y + Math.sin(a) * d };
      if (!ArenaGame.walkable(pt.x, pt.y)) pt = this._randomPoint(40);
    } else {
      pt = this._randomPoint(40);
    }
    this.meteors.push({ id: this.nextId++, x: pt.x, y: pt.y, t: 0 });
    this.events.push({ k: 'warn', x: r1(pt.x), y: r1(pt.y) });
  }

  _land(m) {
    this.landed++;
    const R = this.cfg.radius;
    let hits = 0;
    for (const p of this._livePlayers()) {
      const dx = p.x - m.x;
      const dy = p.y - m.y;
      const d = Math.hypot(dx, dy);
      if (d > R + 45) continue;
      if (d > R) {
        p.near++; // a close call
        continue;
      }
      if (p.z > this.cfg.jumpClear) {
        p.dodges++; // hopped over it!
        this.events.push({ k: 'dodge', id: p.id, x: r1(p.x), y: r1(p.y) });
        continue;
      }
      if (p.immune > 0) continue; // just got hit: a breather
      const len = d || 1;
      p.kx = (dx / len) * this.cfg.blastSpeed;
      p.ky = (dy / len) * this.cfg.blastSpeed;
      if (d < 1) {
        p.kx = this.cfg.blastSpeed;
        p.ky = 0;
      }
      p.stun = this.cfg.hitStun;
      p.immune = this.cfg.hitImmune;
      p.hits++;
      p.lastHitAt = this.time;
      hits++;
      this.events.push({ k: 'meteorHit', id: p.id, x: r1(p.x), y: r1(p.y) });
    }
    this.events.push({ k: 'impact', x: r1(m.x), y: r1(m.y), r: R, hits });
  }

  _canHit(attacker, victim) {
    return victim.immune <= 0;
  }

  // ---- scoring -------------------------------------------------------------------
  // Fewest hits wins; if tied, the one who went longest without a hit is ahead.
  _rankKey(p) {
    const since = p.hits === 0 ? this.cfg.maxTime : Math.min(this.cfg.maxTime, Math.max(0, p.lastHitAt));
    return -p.hits * 1000 + since;
  }

  _scoreOf(p) {
    return p.hits;
  }

  _detail(p) {
    return p.hits === 0 ? 'untouched!' : p.hits === 1 ? '1 hit' : `${p.hits} hits`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Untouchable', (pool) => pool.find((r) => r.place === 1 && P(r).hits === 0 && pool.length >= 2) || null);
    this._give(rows, 'Meteor Magnet', (pool) => this._maxBy(pool, (r) => P(r).hits, 4));
    this._give(rows, 'Sky Hopper', (pool) => this._maxBy(pool, (r) => P(r).dodges, 3));
    this._give(rows, 'Close Call Champ', (pool) => this._maxBy(pool, (r) => P(r).near, 5));
  }

  _hud() {
    if (this.time < 0) return '';
    return this.meteors.length > 0 ? 'Look out below!' : 'Calm... for now';
  }

  _extraSnapshot() {
    return {
      // [id, x, y, radius, fraction of the warning that has passed (0-1)]
      mt: this.meteors.map((m) => [m.id, r1(m.x), r1(m.y), this.cfg.radius, r2(Math.min(1, m.t / this.cfg.fuse))]),
    };
  }
}

MeteorMayhem.GAME_ID = 'meteorMayhem';
MeteorMayhem.TUNING = TUNING;
MeteorMayhem.RAGE = RAGE;
MeteorMayhem.VARIANTS = VARIANTS;

module.exports = MeteorMayhem;
