'use strict';

// ===========================================================================
// CROWN CHAOS  -  minigame #7 (category: Keep-away)
//
// There is ONE crown. Wear it and you score a point every second. Everybody
// else wants it, so they SHOVE you and it pops off and goes flying. But the
// crown gets HOT: wear it too long and it flings itself off by itself, so
// nobody can sit on it all game.
//
// Fair-play rules: the player who just lost the crown cannot grab it back for
// a moment, and a shoved crown holder has a short shield so they cannot be
// bullied without a break.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, r2 } = ArenaGame;

const TUNING = {
  maxTime: 60,
  pickupRadius: 30,
  holderSpeed: 0.9, // the crown is heavy
  overheat: 10, // seconds of continuous wearing before it flings itself off
  flingSpeed: 330,
  scatterFriction: 3.4,
  lockout: 1.3, // whoever just lost it cannot re-grab it for this long
  holderShield: 0.9, // after a shove: breathing room
};

const VARIANTS = {
  classic: {
    name: 'Crown Chaos',
    tagline: 'One crown. Everybody wants it. Nobody is sharing.',
    theme: 'candy',
  },
  hot: {
    name: 'Crown Chaos: Hot Crown',
    tagline: 'The crown is FLAMING. You cannot hold it for long!',
    theme: 'lava',
    overheat: 5,
    flingSpeed: 380,
    holderSpeed: 0.96,
  },
};

const INSTRUCTIONS = [
  'Grab the crown! Every second you wear it scores a point.',
  'SHOVE the crown wearer and the crown pops off. Grab it before they do!',
  'The crown gets hot and flings itself off if you wear it too long.',
  'JUMP to dodge a shove. Most points when the clock runs out wins!',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (dodge)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

// Rage Bait mode: the same game, tuned to be much harder (see server/rage.js).
const RAGE = { overheat: 6, holderSpeed: 0.8, lockout: 0.7, holderShield: 0.4 };

class CrownChaos extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };
    if (this.rage) Object.assign(this.cfg, RAGE);

    this.crown = { x: ArenaGame.WORLD_W / 2, y: ArenaGame.WORLD_H / 2, vx: 0, vy: 0, holder: null, heat: 0, lockId: null, lockUntil: 0 };
    for (const p of this.players.values()) {
      p.held = 0; // seconds wearing the crown
      p.grabs = 0;
      p.crownsKnocked = 0; // crowns this player shoved off somebody
      p.longest = 0;
      p.streak = 0;
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'crownChaos',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Keep-away',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'points', scoreDir: 'high' });
  }

  // ---- rules -----------------------------------------------------------------
  _holder() {
    return this.crown.holder ? this.players.get(this.crown.holder) : null;
  }

  _update(dt) {
    const c = this.crown;
    const holder = this._holder();
    if (holder && holder.state === 'alive') {
      c.x = holder.x;
      c.y = holder.y;
      holder.held += dt;
      holder.streak += dt;
      holder.longest = Math.max(holder.longest, holder.streak);
      c.heat = Math.min(1, holder.streak / this.cfg.overheat);
      if (holder.streak >= this.cfg.overheat) this._drop(holder, null, 'hot');
    } else {
      if (holder) this._drop(holder, null, 'left');
      this._slide(dt);
      this._tryPickup();
    }
    for (const p of this.players.values()) p.speedMul = this.crown.holder === p.id ? this.cfg.holderSpeed : 1;
  }

  _slide(dt) {
    const c = this.crown;
    c.heat = 0;
    if (c.vx === 0 && c.vy === 0) return;
    const nx = c.x + c.vx * dt;
    const ny = c.y + c.vy * dt;
    if (ArenaGame.walkable(nx, c.y)) c.x = nx;
    else c.vx = -c.vx * 0.5;
    if (ArenaGame.walkable(c.x, ny)) c.y = ny;
    else c.vy = -c.vy * 0.5;
    const decay = Math.exp(-this.cfg.scatterFriction * dt);
    c.vx *= decay;
    c.vy *= decay;
    if (Math.abs(c.vx) < 5 && Math.abs(c.vy) < 5) {
      c.vx = 0;
      c.vy = 0;
    }
  }

  _tryPickup() {
    const c = this.crown;
    let best = null;
    let bestD = this.cfg.pickupRadius;
    for (const p of this._livePlayers()) {
      if (p.z > 30) continue;
      if (c.lockId === p.id && this.time < c.lockUntil) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d <= bestD) {
        best = p;
        bestD = d;
      }
    }
    if (!best) return;
    c.holder = best.id;
    c.vx = 0;
    c.vy = 0;
    best.streak = 0;
    best.grabs++;
    this.events.push({ k: 'crown', id: best.id, x: r1(best.x), y: r1(best.y) });
  }

  // The crown leaves its wearer. `by` is the shover (or null if it overheated / they left).
  _drop(holder, by, why) {
    const c = this.crown;
    c.holder = null;
    c.lockId = holder.id;
    c.lockUntil = this.time + this.cfg.lockout;
    c.heat = 0;
    holder.streak = 0;
    const ang = by ? Math.atan2(holder.y - by.y, holder.x - by.x) + (this.rng() - 0.5) * 1.2 : this.rng() * Math.PI * 2;
    c.vx = Math.cos(ang) * this.cfg.flingSpeed;
    c.vy = Math.sin(ang) * this.cfg.flingSpeed;
    c.x = holder.x;
    c.y = holder.y;
    this.events.push({ k: why === 'hot' ? 'overheat' : 'crownDrop', id: holder.id, x: r1(holder.x), y: r1(holder.y) });
  }

  _canHit(attacker, victim) {
    return victim.immune <= 0;
  }

  _onHit(attacker, victim) {
    if (this.crown.holder !== victim.id) return;
    attacker.crownsKnocked++;
    victim.immune = Math.max(victim.immune, this.cfg.holderShield + 0.3);
    this._drop(victim, attacker, 'shove');
  }

  _onRemove(p) {
    if (this.crown.holder === p.id) this._drop(p, null, 'left');
  }

  // ---- scoring -------------------------------------------------------------------
  _scoreOf(p) {
    return Math.floor(p.held);
  }

  _rankKey(p) {
    return Math.floor(p.held * 10) / 10;
  }

  _detail(p) {
    return `${Math.floor(p.held)}s with the crown`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Crown Hog', (pool) => pool.find((r) => r.place === 1 && P(r).held >= 8) || null);
    this._give(rows, 'Crown Snatcher', (pool) => this._maxBy(pool, (r) => P(r).crownsKnocked, 3));
    this._give(rows, 'Hot Head', (pool) => this._maxBy(pool, (r) => P(r).longest, this.cfg.overheat - 0.5));
    this._give(rows, 'Never Royal', (pool) => {
      const last = pool.filter((r) => P(r).held < 1);
      return rows.length >= 3 && last.length === 1 ? last[0] : null;
    });
  }

  _hud() {
    if (this.time < 0) return '';
    const h = this._holder();
    if (!h) return 'The crown is loose!';
    return `${h.name} has the crown`;
  }

  _playerSnapshot(p) {
    return this.crown.holder === p.id ? { cr: 1 } : {};
  }

  _extraSnapshot() {
    const c = this.crown;
    return {
      // x, y, holder id (or ''), heat (0-1), is it flying?
      crown: { x: r1(c.x), y: r1(c.y), hd: c.holder || '', heat: r2(c.heat), mv: c.vx !== 0 || c.vy !== 0 ? 1 : 0 },
    };
  }
}

CrownChaos.GAME_ID = 'crownChaos';
CrownChaos.TUNING = TUNING;
CrownChaos.RAGE = RAGE;
CrownChaos.VARIANTS = VARIANTS;

module.exports = CrownChaos;
