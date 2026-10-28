'use strict';

// ===========================================================================
// LAP DASH  -  minigame #11 (category: Racing)
//
// A race around an oval track, clockwise. Run through the glowing GATES in
// order; every gate counts. HURDLES block the track: JUMP over them (costs
// stamina) or run around the end, which is slower. Hit one and you trip.
//
// Most gates in 60 seconds wins. SHOVE rivals to slow them down. Fair-play
// rules: anybody far behind the leader gets a speed boost (a rubber band), and
// a shoved player has a second of immunity.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, WORLD_W, WORLD_H } = ArenaGame;

const TUNING = {
  maxTime: 60,
  gates: 6,
  trackA: 330, // half-width of the oval
  trackB: 190, // half-height
  gateRadius: 56,
  hurdleHalfLen: 78, // across the track
  hurdleHalfThick: 11,
  hurdleHeight: 22, // be this high to hop it
  tripStun: 0.65,
  hurdleGrace: 0.9,
  boostGap1: 4, // this many gates behind the leader: a little faster...
  boostGap2: 8, // ...and this many: faster still
  boost1: 1.08,
  boost2: 1.16,
  hurdleGaps: [0, 2, 4], // which gaps between gates have a hurdle in the middle
};

const VARIANTS = {
  classic: {
    name: 'Lap Dash',
    tagline: 'Round and round. Faster. FASTER.',
    theme: 'sunny',
  },
  gauntlet: {
    name: 'Lap Dash: Hurdle Gauntlet',
    tagline: 'There is a hurdle every few steps. Good luck.',
    theme: 'lava',
    hurdleGaps: [0, 1, 2, 3, 4, 5],
  },
};

const INSTRUCTIONS = [
  'Race clockwise around the track. Run through every gate IN ORDER!',
  'JUMP over hurdles (it costs stamina) or run around the end. Hit one and you trip.',
  'SHOVE rivals to slow them down. Far behind? You get a speed boost.',
  'Most gates in 60 seconds wins.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (hurdles)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

const CX = WORLD_W / 2;
const CY = WORLD_H / 2;

// A point on the oval at angle `t` (scale `s` = 1 is the middle of the track).
function ovalPoint(cfg, t, s = 1) {
  return { x: CX + Math.cos(t) * cfg.trackA * s, y: CY + Math.sin(t) * cfg.trackB * s };
}

// Where the gates and hurdles are. Shared with the browser through the arena info.
function buildTrack(cfg) {
  const n = cfg.gates;
  const start = -Math.PI / 2 - 0.16; // the start line is just before the top of the oval
  const gates = [];
  for (let k = 0; k < n; k++) {
    const t = start + ((k + 1) * Math.PI * 2) / n;
    const p = ovalPoint(cfg, t);
    gates.push({ x: Math.round(p.x), y: Math.round(p.y), t });
  }
  const hurdles = [];
  for (const g of cfg.hurdleGaps) {
    const t = start + ((g + 1.5) * Math.PI * 2) / n; // halfway between gate g and g+1
    const p = ovalPoint(cfg, t);
    // direction of travel (clockwise on screen = angle increasing) and the way across the track
    let tx = -Math.sin(t) * cfg.trackA;
    let ty = Math.cos(t) * cfg.trackB;
    const tl = Math.hypot(tx, ty);
    tx /= tl;
    ty /= tl;
    hurdles.push({ x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(tx * 1000) / 1000, ty: Math.round(ty * 1000) / 1000 });
  }
  return { cx: CX, cy: CY, a: cfg.trackA, b: cfg.trackB, start, gateRadius: cfg.gateRadius, gates, hurdles, hurdleHalfLen: cfg.hurdleHalfLen, hurdleHalfThick: cfg.hurdleHalfThick };
}

class LapDash extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };
    this.track = buildTrack(this.cfg);

    // Line everybody up across the start line, facing the way to run.
    const n = this.players.size;
    let i = 0;
    for (const p of this.players.values()) {
      const s = n === 1 ? 1 : 0.8 + (0.4 * i) / (n - 1);
      const pt = ovalPoint(this.cfg, this.track.start, s);
      p.x = pt.x;
      p.y = pt.y;
      p.fx = -Math.sin(this.track.start) * this.cfg.trackA;
      p.fy = Math.cos(this.track.start) * this.cfg.trackB;
      const fl = Math.hypot(p.fx, p.fy);
      p.fx /= fl;
      p.fy /= fl;
      p.gates = 0; // gates passed in total (6 = one lap)
      p.lastGateAt = 0;
      p.trips = 0;
      p.tripGrace = 0;
      p.boosted = 0; // seconds spent with a rubber-band boost
      i++;
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'lapDash',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Racing',
    };
  }

  // The track depends on the variant, so the browser reads it from the arena info
  // that is sent with each round (see room.js) - `arena` here is for the classic one.
  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'gates', scoreDir: 'high', track: buildTrack({ ...TUNING }) });
  }

  static arenaFor(variantId) {
    const v = VARIANTS[variantId] || VARIANTS.classic;
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'gates', scoreDir: 'high', track: buildTrack({ ...TUNING, ...v }) });
  }

  // ---- rules ---------------------------------------------------------------------
  _update(dt) {
    const live = this._livePlayers();
    const lead = live.reduce((m, p) => Math.max(m, p.gates), 0);
    const n = this.cfg.gates;
    for (const p of live) {
      p.tripGrace = Math.max(0, p.tripGrace - dt);

      // rubber band: the further behind you are, the faster you run
      const gap = lead - p.gates;
      p.speedMul = gap >= this.cfg.boostGap2 ? this.cfg.boost2 : gap >= this.cfg.boostGap1 ? this.cfg.boost1 : 1;
      if (p.speedMul > 1) p.boosted += dt;

      // the next gate
      const g = this.track.gates[p.gates % n];
      if (Math.hypot(p.x - g.x, p.y - g.y) <= this.cfg.gateRadius) {
        p.gates++;
        p.lastGateAt = this.time;
        this.events.push({ k: 'gate', id: p.id, x: g.x, y: g.y, n: p.gates, lap: p.gates % n === 0 ? 1 : 0 });
      }

      // hurdles
      if (p.z < this.cfg.hurdleHeight && p.tripGrace <= 0) {
        for (const h of this.track.hurdles) {
          const dx = p.x - h.x;
          const dy = p.y - h.y;
          const along = dx * h.tx + dy * h.ty; // along the direction of travel
          const across = -dx * h.ty + dy * h.tx; // across the track
          if (Math.abs(along) <= this.cfg.hurdleHalfThick + 14 && Math.abs(across) <= this.cfg.hurdleHalfLen) {
            p.trips++;
            p.tripGrace = this.cfg.hurdleGrace;
            p.stun = Math.max(p.stun, this.cfg.tripStun);
            p.vx *= 0.15;
            p.vy *= 0.15;
            this.events.push({ k: 'trip', id: p.id, x: r1(p.x), y: r1(p.y) });
            break;
          }
        }
      }
    }
  }

  // ---- scoring -------------------------------------------------------------------
  _scoreOf(p) {
    return p.gates;
  }

  _rankKey(p) {
    // more gates first; whoever got there earlier wins a tie
    return p.gates + (1 - Math.min(1, p.lastGateAt / (this.maxTime + 1))) * 0.5;
  }

  _detail(p) {
    const laps = Math.floor(p.gates / this.cfg.gates);
    return `${p.gates} gates (${laps} lap${laps === 1 ? '' : 's'})`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Speed Demon', (pool) => pool.find((r) => r.place === 1 && P(r).gates >= this.cfg.gates * 3) || null);
    this._give(rows, 'Hurdle Hitter', (pool) => this._maxBy(pool, (r) => P(r).trips, 4));
    this._give(rows, 'Pogo Stick', (pool) => this._maxBy(pool, (r) => r.jumps, 12));
    this._give(rows, 'Comeback Kid', (pool) => this._maxBy(pool, (r) => P(r).boosted, 12));
    this._give(rows, 'Shover', (pool) => this._maxBy(pool, (r) => byId.get(r.id).hitsDealt, 3));
  }

  _hud() {
    if (this.time < 0) return '';
    const live = this._livePlayers();
    if (live.length === 0) return '';
    const best = live.reduce((a, b) => (b.gates > a.gates ? b : a));
    return best.gates > 0 ? `${best.name} leads: lap ${Math.floor(best.gates / this.cfg.gates) + 1}` : 'Go go go!';
  }

  _playerSnapshot(p) {
    return { gt: p.gates };
  }
}

LapDash.GAME_ID = 'lapDash';
LapDash.TUNING = TUNING;
LapDash.VARIANTS = VARIANTS;
LapDash.buildTrack = buildTrack;

module.exports = LapDash;
