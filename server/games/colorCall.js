'use strict';

// ===========================================================================
// COLOR CALL  -  minigame #9 (category: Musical zones)
//
// The arena is split into four coloured zones. A colour is called out and a
// timer starts: be standing in a SAFE zone when it hits zero, or you get
// splatted (dizzy for a second, no point). Every safe round scores a point.
// The calls get faster. Rivals can SHOVE you out of the safe zone at the last
// second, but a shoved player gets a short shield and nobody is ever out of the
// game: a splat only costs you that round's point.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, r2 } = ArenaGame;

const ZONE_NAMES = ['RED', 'BLUE', 'GREEN', 'YELLOW'];

const TUNING = {
  maxTime: 60,
  firstCall: 1.8, // seconds after GO before the first call
  callStart: 3.6, // seconds you get at the start...
  callStep: 0.17, // ...which shrinks by this much every round...
  callMin: 1.7, // ...down to this
  checkTime: 1.0, // how long the "who was safe" moment lasts
  restTime: 0.8,
  splatStun: 1.0,
  clutchWindow: 0.6, // moving into a safe zone this late counts as a "clutch"
  avoid: 0, // 0 = "go to this colour"; 2 = "avoid these two colours"
};

const VARIANTS = {
  classic: {
    name: 'Color Call',
    tagline: 'Get to the colour. Right now. No, the other one.',
    theme: 'sunny',
  },
  avoid: {
    name: 'Color Call: Anything But',
    tagline: 'Two colours are lava. Pick a safe one!',
    theme: 'icy',
    avoid: 2,
    callStart: 3.2,
  },
};

const INSTRUCTIONS = [
  'A colour is called. Stand in a SAFE zone before the timer hits zero!',
  'If you are not safe you get splatted: dizzy for a second, and no point.',
  'SHOVE rivals out of the safe zone at the last second!',
  'The calls get faster. Most safe rounds wins.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (dodge)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

// Zone numbers: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
function zoneAt(x, y) {
  return (x < ArenaGame.WORLD_W / 2 ? 0 : 1) + (y < ArenaGame.WORLD_H / 2 ? 0 : 2);
}

// Rage Bait mode: the same game, tuned to be much harder (see server/rage.js).
const RAGE = { callStart: 2.6, callStep: 0.2, callMin: 1.0, checkTime: 0.8, restTime: 0.5, splatStun: 1.4 };

class ColorCall extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };
    if (this.rage) Object.assign(this.cfg, RAGE);

    this.round = 0;
    this.phase = 'rest'; // rest -> call -> check -> rest ...
    this.phaseLeft = this.cfg.firstCall;
    this.callLen = 0;
    this.target = -1; // the called colour (or the first avoided one)
    this.safe = []; // safe zone numbers for this call
    this.avoidSet = []; // lava zones (only in the "Anything But" version)
    this.unsafeEarly = new Set(); // who was NOT safe shortly before the deadline
    this.clutchChecked = false;
    for (const p of this.players.values()) {
      p.safeRounds = 0;
      p.missed = 0;
      p.clutches = 0;
      p.streak = 0;
      p.bestStreak = 0;
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'colorCall',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Musical zones',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'safe', scoreDir: 'high', zoneNames: ZONE_NAMES });
  }

  // ---- rules ---------------------------------------------------------------------
  _update(dt) {
    this.phaseLeft -= dt;
    if (this.phase === 'call') {
      if (!this.clutchChecked && this.phaseLeft <= this.cfg.clutchWindow) {
        this.clutchChecked = true;
        this.unsafeEarly = new Set(this._livePlayers().filter((p) => !this.safe.includes(zoneAt(p.x, p.y))).map((p) => p.id));
      }
      if (this.phaseLeft <= 0) this._judge();
    } else if (this.phaseLeft <= 0) {
      if (this.phase === 'check') this._startRest();
      else this._startCall();
    }
  }

  _startRest() {
    this.phase = 'rest';
    this.phaseLeft = this.cfg.restTime;
  }

  _startCall() {
    this.round++;
    this.phase = 'call';
    this.callLen = Math.max(this.cfg.callMin, this.cfg.callStart - (this.round - 1) * this.cfg.callStep);
    this.phaseLeft = this.callLen;
    this.clutchChecked = false;
    this.unsafeEarly = new Set();
    this.target = Math.floor(this.rng() * 4);
    if (this.cfg.avoid > 0) {
      // two colours are lava: the target and one other
      const other = (this.target + 1 + Math.floor(this.rng() * 3)) % 4;
      const bad = new Set([this.target, other]);
      this.avoidSet = [...bad].sort();
      this.safe = [0, 1, 2, 3].filter((z) => !bad.has(z));
    } else {
      this.avoidSet = [];
      this.safe = [this.target];
    }
    this.events.push({ k: 'call', zones: this.safe, bad: this.avoidSet, t: r1(this.callLen) });
  }

  _judge() {
    this.phase = 'check';
    this.phaseLeft = this.cfg.checkTime;
    for (const p of this._livePlayers()) {
      const ok = this.safe.includes(zoneAt(p.x, p.y));
      if (ok) {
        p.safeRounds++;
        p.streak++;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        if (this.unsafeEarly.has(p.id)) p.clutches++;
        this.events.push({ k: 'safe', id: p.id, x: r1(p.x), y: r1(p.y) });
      } else {
        p.missed++;
        p.streak = 0;
        p.stun = Math.max(p.stun, this.cfg.splatStun);
        p.vx = 0;
        p.vy = 0;
        this.events.push({ k: 'miss', id: p.id, x: r1(p.x), y: r1(p.y) });
      }
    }
  }

  // ---- scoring -------------------------------------------------------------------
  _scoreOf(p) {
    return p.safeRounds;
  }

  _rankKey(p) {
    return p.safeRounds;
  }

  _detail(p) {
    return `${p.safeRounds} safe round${p.safeRounds === 1 ? '' : 's'}`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Color Genius', (pool) => pool.find((r) => r.place === 1 && P(r).missed === 0 && P(r).safeRounds >= 5) || null);
    this._give(rows, 'Clutch Player', (pool) => this._maxBy(pool, (r) => P(r).clutches, 3));
    this._give(rows, 'Color Blind', (pool) => this._maxBy(pool, (r) => P(r).missed, 4));
    this._give(rows, 'Bouncer', (pool) => this._maxBy(pool, (r) => byId.get(r.id).hitsDealt, 4));
    this._give(rows, 'Streak Machine', (pool) => this._maxBy(pool, (r) => P(r).bestStreak, 6));
  }

  _hud() {
    if (this.time < 0) return '';
    if (this.phase === 'call') {
      const secs = Math.max(0, Math.ceil(this.phaseLeft));
      if (this.avoidSet.length) return `Avoid ${this.avoidSet.map((z) => ZONE_NAMES[z]).join(' + ')}! ${secs}`;
      return `Get to ${ZONE_NAMES[this.target]}! ${secs}`;
    }
    if (this.phase === 'check') return 'Splat check!';
    return this.round === 0 ? 'Get ready...' : 'Next call coming...';
  }

  _extraSnapshot() {
    return {
      // ph: phase, l: seconds left, d: length of this call, z: safe zones, bad: lava zones, n: call number
      cc: { ph: this.phase, l: r2(Math.max(0, this.phaseLeft)), d: r2(this.callLen), z: this.safe, bad: this.avoidSet || [], n: this.round },
    };
  }
}

ColorCall.GAME_ID = 'colorCall';
ColorCall.TUNING = TUNING;
ColorCall.RAGE = RAGE;
ColorCall.VARIANTS = VARIANTS;
ColorCall.ZONE_NAMES = ZONE_NAMES;
ColorCall.zoneAt = zoneAt;

module.exports = ColorCall;
