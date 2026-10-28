'use strict';

// ===========================================================================
// HOT POTATO  -  minigame #3 (category: Tag)
//
// One player carries a ticking bomb. SHOVE somebody to pass it to them!
// When the fuse runs out it blows up in the holder's hands: one "boom" for
// them, a big shockwave for everyone nearby, and a new bomb for somebody who
// has had the fewest booms (so it stays fair). Nobody is ever eliminated:
// everyone plays the whole round. Fewest booms wins (ties: whoever held the
// bomb for less time).
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, r2 } = ArenaGame;

const TUNING = {
  maxTime: 60,
  firstAssign: 1.0, // seconds after GO before the first bomb appears
  nextAssign: 1.0, // pause after an explosion
  fuseStart: 9,
  fuseMin: 5,
  fuseDecay: 0.05, // the fuse gets shorter the longer the round goes on
  holderSpeed: 1.12, // the bomb holder runs a little faster (so they can chase)
  passImmune: 0.9, // you cannot be handed the bomb straight back
  boomStun: 1.4,
  boomRadius: 150,
  boomKnock: 520,
};

const VARIANTS = {
  classic: {
    name: 'Hot Potato',
    tagline: 'Pass the bomb. Do not be holding it.',
    theme: 'lava',
  },
  icy: {
    name: 'Hot Potato: Ice Rink',
    tagline: 'It is a bomb. On ice. What could go wrong?',
    theme: 'icy',
    grip: 0.3,
    slide: 0.55,
  },
};

const INSTRUCTIONS = [
  'One player holds a ticking bomb. When the fuse ends, BOOM!',
  'Holding it? SHOVE someone to pass it on.',
  'Not holding it? Run away, or JUMP to dodge the shove!',
  'Fewest booms wins. Nobody gets knocked out of the round.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (dodge)', keys: 'Space' },
  { label: 'Shove / Pass bomb', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

// Rage Bait mode: the same game, tuned to be much harder (see server/rage.js).
const RAGE = { fuseStart: 6, fuseMin: 3, fuseDecay: 0.06, boomStun: 1.9, boomRadius: 190, boomKnock: 820, passImmune: 0.45, holderSpeed: 1.05, nextAssign: 0.5 };

class HotPotato extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...(this.rage ? RAGE : {}) };
    this.holderId = null;
    this.fuse = 0;
    this.fuseMax = 1;
    this.assignAt = this.cfg.firstAssign;
    for (const p of this.players.values()) {
      p.strikes = 0;
      p.holdTime = 0;
      p.passes = 0;
      p.passImmune = 0; // time until which this player cannot be handed the bomb
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'hotPotato',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Tag',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, {
      scoreLabel: 'booms',
      scoreDir: 'low',
      shoveLabel: 'Shove / pass',
    });
  }

  // ---- rules ---------------------------------------------------------------------
  get holder() {
    return this.holderId ? this.players.get(this.holderId) : null;
  }

  _update(dt) {
    for (const p of this.players.values()) p.speedMul = 1;

    let h = this.holder;
    if (h && h.state !== 'alive') {
      this._reassign(); // the holder left
      h = this.holder;
    }

    if (!h) {
      if (this.time >= this.assignAt) this._assignBomb(null);
      return;
    }
    h.speedMul = this.cfg.holderSpeed;
    h.holdTime += dt;
    this.fuse -= dt;
    if (this.fuse <= 0) this._boom(h);
  }

  _newFuse() {
    return Math.max(this.cfg.fuseMin, this.cfg.fuseStart - this.cfg.fuseDecay * Math.max(0, this.time));
  }

  // Give the bomb to a random player among those with the fewest booms.
  _assignBomb(excludeId) {
    let pool = this._livePlayers().filter((p) => p.id !== excludeId);
    if (pool.length === 0) pool = this._livePlayers(); // solo practice: the bomb stays with you
    if (pool.length === 0) return;
    const fewest = Math.min(...pool.map((p) => p.strikes));
    const cand = pool.filter((p) => p.strikes === fewest);
    const pick = cand[Math.floor(this.rng() * cand.length)];
    this.holderId = pick.id;
    this.fuseMax = this._newFuse();
    this.fuse = this.fuseMax;
    pick.passImmune = this.time + this.cfg.passImmune;
    this.events.push({ k: 'bomb', id: pick.id, x: r1(pick.x), y: r1(pick.y), start: true });
  }

  _reassign() {
    const old = this.holderId;
    this.holderId = null;
    const live = this._livePlayers();
    if (live.length === 0) return;
    // keep the fuse that was already burning, just hand it to someone fair
    const fuseLeft = this.fuse;
    this._assignBomb(old);
    if (this.holderId) this.fuse = Math.min(this.fuse, Math.max(2, fuseLeft));
  }

  _boom(h) {
    h.strikes++;
    h.stun = this.cfg.boomStun;
    h.kx = 0;
    h.ky = 0;
    this.events.push({ k: 'boom', id: h.id, x: r1(h.x), y: r1(h.y) });
    for (const q of this._livePlayers()) {
      if (q === h) continue;
      const dx = q.x - h.x;
      const dy = q.y - h.y;
      const d = Math.hypot(dx, dy);
      if (d > this.cfg.boomRadius) continue;
      const ux = d > 1 ? dx / d : 1;
      const uy = d > 1 ? dy / d : 0;
      const k = 1 - d / this.cfg.boomRadius / 2; // weaker the further away
      q.kx = ux * this.cfg.boomKnock * k;
      q.ky = uy * this.cfg.boomKnock * k;
      q.stun = Math.max(q.stun, 0.3);
    }
    this.holderId = null;
    this.assignAt = this.time + this.cfg.nextAssign;
    this.lastBoomId = h.id;
  }

  // Only the bomb holder can pass the bomb; a pass ignores the shove-immunity
  // of the target but respects "no instant hand-back".
  _canHit(attacker, victim) {
    if (attacker.id === this.holderId) return victim.passImmune <= this.time;
    return victim.immune <= 0;
  }

  _onHit(attacker, victim) {
    if (attacker.id !== this.holderId) return;
    this.holderId = victim.id;
    victim.passImmune = this.time + this.cfg.passImmune;
    attacker.passImmune = this.time + this.cfg.passImmune; // ...and you cannot be handed it straight back
    attacker.passes++;
    this.events.push({ k: 'bomb', id: victim.id, from: attacker.id, x: r1(victim.x), y: r1(victim.y) });
  }

  _onRemove(p) {
    if (this.holderId === p.id && this.time >= 0 && !this.finished) this._reassign();
  }

  _scoreOf(p) {
    return p.strikes;
  }

  // higher is better: fewest booms first, then the shortest time holding the bomb
  _rankKey(p) {
    return -(p.strikes * 1000 + Math.round(p.holdTime * 10) / 10);
  }

  _detail(p) {
    return p.strikes === 0 ? 'no booms!' : p.strikes === 1 ? '1 boom' : `${p.strikes} booms`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Hot Potato Hero', (pool) => pool.find((r) => r.place === 1) || null);
    this._give(rows, 'Pass Master', (pool) => this._maxBy(pool, (r) => P(r).passes, 4));
    this._give(rows, 'Human Firework', (pool) => this._maxBy(pool, (r) => P(r).strikes, 3));
    this._give(rows, 'Dodge Wizard', (pool) => this._maxBy(pool, (r) => r.jumps, 12));
    this._give(rows, 'Bomb Magnet', (pool) => this._maxBy(pool, (r) => P(r).holdTime, 22));
  }

  _hud() {
    if (this.time < 0) return '';
    const h = this.holder;
    if (!h) return 'New bomb incoming...';
    return `${h.name} has the bomb! ${Math.max(0, this.fuse).toFixed(1)}s`;
  }

  _playerSnapshot(p) {
    return p.id === this.holderId ? { bm: 1, md: 'scared' } : {};
  }

  _extraSnapshot() {
    return {
      bomb: this.holderId ? { id: this.holderId, fuse: r2(Math.max(0, this.fuse)), max: r2(this.fuseMax) } : null,
    };
  }
}

HotPotato.GAME_ID = 'hotPotato';
HotPotato.TUNING = TUNING;
HotPotato.RAGE = RAGE;
HotPotato.VARIANTS = VARIANTS;

module.exports = HotPotato;
