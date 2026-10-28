'use strict';

// ===========================================================================
// JUMP ROPE JAM  -  minigame #10 (category: Timing)
//
// A giant rope spins around the middle of the arena like a clock hand. It
// sweeps past every player twice per turn. JUMP over it to score a point; get
// caught and you are tangled (stunned for a moment, no point).
//
// The rope speeds up as the round goes on. Every jump costs STAMINA, so near
// the end nobody can hop every pass: you have to pick your moments - and
// SHOVING costs stamina too. Nobody is ever knocked out; a tangled player gets
// a short grace period so they cannot be hit again straight away.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, r2, WORLD_W, WORLD_H } = ArenaGame;

const TUNING = {
  maxTime: 60,
  length: 480, // reaches the whole arena
  hub: 30, // the middle stays safe (but scores nothing)
  ropeHeight: 22, // you must be at least this high to clear it
  startSpeed: 1.35, // radians per second
  ramp: 0.032, // speed gained per second
  maxSpeed: 3.3,
  tangleStun: 0.5,
  tangleKnock: 260,
  graceTime: 0.7, // after being tangled the rope cannot catch you again for this long
  flipEvery: 0, // 0 = never reverses
  flipWarn: 1.4,
  flipTurn: 0.7, // how long the turn-around takes
};

const VARIANTS = {
  classic: {
    name: 'Jump Rope Jam',
    tagline: 'Jump. Jump. Jump. Oh no, you are tired.',
    theme: 'sunny',
  },
  wild: {
    name: 'Jump Rope Jam: Wild Rope',
    tagline: 'The rope changes its mind. A lot.',
    theme: 'moon',
    flipEvery: 11,
    startSpeed: 1.25,
  },
};

const INSTRUCTIONS = [
  'A giant rope spins around the middle. JUMP over it to score a point!',
  'Get caught and you are tangled: dizzy for a moment and no point.',
  'Every jump uses STAMINA, and the rope gets faster. Pick your moments!',
  'SHOVE costs stamina too. Most clears wins.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (clear the rope)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

const TWO_PI = Math.PI * 2;
// Turns any angle into the range (-PI, PI].
function wrapPi(a) {
  let x = a % TWO_PI;
  if (x > Math.PI) x -= TWO_PI;
  else if (x <= -Math.PI) x += TWO_PI;
  return x;
}

// Did a line that turned from angle `from` by `delta` radians sweep over the direction `phi`?
function sweptOver(from, delta, phi) {
  const d = wrapPi(phi - from);
  return delta >= 0 ? d > 0 && d <= delta : d < 0 && d >= delta;
}

// Rage Bait mode: the same game, tuned to be much harder (see server/rage.js).
const RAGE = { startSpeed: 2.1, ramp: 0.05, maxSpeed: 4.6, tangleKnock: 560, tangleStun: 0.8, graceTime: 0.45 };

class JumpRope extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };
    if (this.rage) Object.assign(this.cfg, RAGE);

    this.cx = WORLD_W / 2;
    this.cy = WORLD_H / 2;
    this.angle = 0;
    this.dir = 1; // 1 or -1; eases between them when the rope reverses
    this.omega = this.cfg.startSpeed;
    this.flipAt = this.cfg.flipEvery > 0 ? this.cfg.flipEvery : Infinity;
    this.flipWarned = false;
    this.turnLeft = 0; // time left in a reversal
    this.turnFrom = 1;
    for (const p of this.players.values()) {
      p.clears = 0;
      p.tangles = 0;
      p.grace = 0;
      p.hubTime = 0;
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'jumpRope',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Timing',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'clears', scoreDir: 'high', rope: { length: TUNING.length, hub: TUNING.hub, height: TUNING.ropeHeight } });
  }

  // ---- rules ---------------------------------------------------------------------
  _speed() {
    return Math.min(this.cfg.maxSpeed, this.cfg.startSpeed + this.cfg.ramp * Math.max(0, this.time));
  }

  _update(dt) {
    // reversing (Wild Rope)
    if (this.cfg.flipEvery > 0) {
      if (!this.flipWarned && this.time >= this.flipAt - this.cfg.flipWarn) {
        this.flipWarned = true;
        this.events.push({ k: 'flipWarn' });
      }
      if (this.time >= this.flipAt) {
        this.flipAt += this.cfg.flipEvery;
        this.flipWarned = false;
        this.turnLeft = this.cfg.flipTurn;
        this.turnFrom = this.dir;
        this.events.push({ k: 'flip' });
      }
    }
    let dirNow = this.dir;
    if (this.turnLeft > 0) {
      this.turnLeft = Math.max(0, this.turnLeft - dt);
      const k = 1 - this.turnLeft / this.cfg.flipTurn; // 0 -> 1
      dirNow = this.turnFrom * Math.cos(k * Math.PI); // 1 -> 0 -> -1: slows, stops, reverses
      if (this.turnLeft === 0) {
        this.dir = -this.turnFrom;
        dirNow = this.dir;
      }
    }

    this.omega = this._speed();
    const delta = this.omega * dirNow * dt;
    const from = this.angle;
    this.angle = wrapPi(this.angle + delta);

    for (const p of this._livePlayers()) {
      p.grace = Math.max(0, p.grace - dt);
      const dx = p.x - this.cx;
      const dy = p.y - this.cy;
      const r = Math.hypot(dx, dy);
      if (r < this.cfg.hub) {
        p.hubTime += dt;
        continue;
      }
      if (r > this.cfg.length) continue;
      const phi = Math.atan2(dy, dx);
      const hit = sweptOver(from, delta, phi) || sweptOver(from, delta, phi + Math.PI);
      if (!hit || p.grace > 0) continue;
      if (p.z >= this.cfg.ropeHeight) {
        p.clears++;
        this.events.push({ k: 'clear', id: p.id, x: r1(p.x), y: r1(p.y) });
      } else {
        this._tangle(p, phi, delta >= 0 ? 1 : -1);
      }
    }
  }

  _tangle(p, phi, sign) {
    p.tangles++;
    p.grace = this.cfg.graceTime;
    p.stun = Math.max(p.stun, this.cfg.tangleStun);
    // the rope flicks you along in the direction it is turning
    p.kx = -Math.sin(phi) * sign * this.cfg.tangleKnock;
    p.ky = Math.cos(phi) * sign * this.cfg.tangleKnock;
    this.events.push({ k: 'tangle', id: p.id, x: r1(p.x), y: r1(p.y) });
  }

  // ---- scoring -------------------------------------------------------------------
  _scoreOf(p) {
    return p.clears;
  }

  _rankKey(p) {
    return p.clears * 100 - p.tangles; // fewer tangles breaks a tie
  }

  _detail(p) {
    return `${p.clears} clear${p.clears === 1 ? '' : 's'}, ${p.tangles} tangle${p.tangles === 1 ? '' : 's'}`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Rope Master', (pool) => pool.find((r) => r.place === 1 && P(r).clears >= 10) || null);
    this._give(rows, 'Hub Hider', (pool) => this._maxBy(pool, (r) => P(r).hubTime, 18));
    this._give(rows, 'Tangled Up', (pool) => this._maxBy(pool, (r) => P(r).tangles, 4));
    this._give(rows, 'Pogo Stick', (pool) => this._maxBy(pool, (r) => r.jumps, 15));
    this._give(rows, 'Shover', (pool) => this._maxBy(pool, (r) => byId.get(r.id).hitsDealt, 3));
  }

  _hud() {
    if (this.time < 0) return '';
    if (this.flipWarned) return 'REVERSE incoming!';
    return `Rope speed ${(this.omega / this.cfg.startSpeed).toFixed(1)}x`;
  }

  _extraSnapshot() {
    return {
      // a: angle, w: speed (radians/second), len: reach. fl: 1 while a reversal is about to happen
      rp: { a: Math.round(this.angle * 1000) / 1000, w: r2(this.omega), len: this.cfg.length, fl: this.flipWarned ? 1 : 0 },
    };
  }
}

JumpRope.GAME_ID = 'jumpRope';
JumpRope.TUNING = TUNING;
JumpRope.RAGE = RAGE;
JumpRope.VARIANTS = VARIANTS;
JumpRope.sweptOver = sweptOver;

module.exports = JumpRope;
