'use strict';

// ===========================================================================
// MOLE STOMP  -  minigame #13 (category: Whack-a-mole)
//
// Nine burrows are dotted around the arena. A mound RUMBLES, then a mole pops
// up for a moment. JUMP and land on it to stomp it for a point! Watch out for
// the RED moles (they bite: you lose points) and the rare GOLD mole (worth 3).
//
// Jumping costs stamina, so you cannot hop everywhere. Whoever is in last place
// sees the golden mole pop up closest to them. Nobody is knocked out.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, r2 } = ArenaGame;

// Burrow positions (3 x 3). The browser uses the same numbers.
const BURROWS = [
  [224, 144], [448, 144], [672, 144],
  [224, 288], [448, 288], [672, 288],
  [224, 432], [448, 432], [672, 432],
];

const TUNING = {
  maxTime: 60,
  rumble: 0.55, // warning before the mole pops up
  lifeStart: 1.3, // how long a mole stays up...
  lifeEnd: 0.85, // ...shrinking to this by the end
  spawnStart: 0.95, // seconds between moles...
  spawnEnd: 0.55,
  maxActive: 4,
  stompRadius: 38,
  stompHeight: 30, // you must be below this (and coming down) to count
  redChance: 0.14,
  redPenalty: 2,
  redStun: 0.5,
  goldEvery: 15, // a gold mole appears about this often
  goldFirst: 10,
  goldValue: 3,
};

const VARIANTS = {
  classic: {
    name: 'Mole Stomp',
    tagline: 'Whack-a-mole, but YOU are the hammer.',
    theme: 'jungle',
  },
  frenzy: {
    name: 'Mole Stomp: Mole Frenzy',
    tagline: 'More moles. Faster moles. More red moles. Why.',
    theme: 'candy',
    spawnStart: 0.7,
    spawnEnd: 0.42,
    maxActive: 5,
    redChance: 0.2,
  },
};

const INSTRUCTIONS = [
  'A mound rumbles, then a mole pops up. JUMP and land on it to stomp it!',
  'RED moles bite: stomp one and you lose points. Gold moles are worth 3.',
  'Jumping uses stamina, so choose your jumps carefully.',
  'SHOVE rivals to stop them stomping. Most points wins!',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (stomp!)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

class MoleStomp extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };

    this.moles = [];
    this.nextId = 1;
    this.nextSpawn = 0.5;
    this.nextGold = this.cfg.goldFirst;
    for (const p of this.players.values()) {
      p.points = 0;
      p.stomps = 0;
      p.bites = 0;
      p.golds = 0;
      p.wasAir = false;
    }
  }

  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'moleStomp',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Whack-a-mole',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'points', scoreDir: 'high', burrows: BURROWS });
  }

  // ---- rules ---------------------------------------------------------------------
  _progress() {
    return Math.max(0, Math.min(1, this.time / this.maxTime));
  }

  _life() {
    const k = this._progress();
    return this.cfg.lifeStart + (this.cfg.lifeEnd - this.cfg.lifeStart) * k;
  }

  _update() {
    this._spawn();
    this._expire();
    this._stomps();
    for (const p of this._livePlayers()) p.wasAir = p.z > 0.5;
  }

  _freeBurrows() {
    const used = new Set(this.moles.map((m) => m.b));
    return BURROWS.map((_, i) => i).filter((i) => !used.has(i));
  }

  _spawn() {
    let guard = 0;
    while (this.time >= this.nextSpawn && guard++ < 3) {
      const k = this._progress();
      this.nextSpawn += this.cfg.spawnStart + (this.cfg.spawnEnd - this.cfg.spawnStart) * k;
      if (this.moles.length >= this.cfg.maxActive) continue;
      const free = this._freeBurrows();
      if (free.length === 0) continue;
      let kind = 'mole';
      let b = free[Math.floor(this.rng() * free.length)];
      if (this.time >= this.nextGold) {
        this.nextGold += this.cfg.goldEvery;
        kind = 'gold';
        b = this._goldBurrow(free);
      } else if (this.rng() < this.cfg.redChance) {
        kind = 'red';
      }
      this.moles.push({ id: this.nextId++, b, kind, born: this.time, life: this._life() });
      this.events.push({ k: 'rumble', x: BURROWS[b][0], y: BURROWS[b][1], kind });
    }
  }

  // Catch-up: the golden mole pops up at the free burrow closest to whoever is in last place.
  _goldBurrow(free) {
    const live = this._livePlayers();
    if (live.length < 2) return free[Math.floor(this.rng() * free.length)];
    const low = Math.min(...live.map((p) => p.points));
    const losers = live.filter((p) => p.points === low);
    if (losers.length === live.length) return free[Math.floor(this.rng() * free.length)];
    const target = losers[Math.floor(this.rng() * losers.length)];
    let best = free[0];
    let bestD = Infinity;
    for (const i of free) {
      const d = Math.hypot(BURROWS[i][0] - target.x, BURROWS[i][1] - target.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  _expire() {
    this.moles = this.moles.filter((m) => {
      if (this.time - m.born > this.cfg.rumble + m.life) {
        this.events.push({ k: 'moleGone', x: BURROWS[m.b][0], y: BURROWS[m.b][1] });
        return false;
      }
      return true;
    });
  }

  _stomps() {
    const gone = new Set();
    for (const m of this.moles) {
      if (this.time - m.born < this.cfg.rumble) continue; // still rumbling
      const [bx, by] = BURROWS[m.b];
      let best = null;
      let bestD = this.cfg.stompRadius;
      for (const p of this._livePlayers()) {
        const landing = p.wasAir && p.z <= 0.5;
        const falling = p.z > 0.5 && p.z <= this.cfg.stompHeight && p.vz < -30;
        if (!landing && !falling) continue;
        const d = Math.hypot(p.x - bx, p.y - by);
        if (d <= bestD) {
          bestD = d;
          best = p;
        }
      }
      if (!best) continue;
      gone.add(m.id);
      if (m.kind === 'red') {
        best.bites++;
        best.points = Math.max(0, best.points - this.cfg.redPenalty);
        best.stun = Math.max(best.stun, this.cfg.redStun);
        this.events.push({ k: 'bite', id: best.id, x: bx, y: by });
      } else {
        const v = m.kind === 'gold' ? this.cfg.goldValue : 1;
        best.points += v;
        best.stomps++;
        if (m.kind === 'gold') best.golds++;
        this.events.push({ k: 'stomp', id: best.id, x: bx, y: by, v, gold: m.kind === 'gold' ? 1 : 0 });
      }
    }
    if (gone.size) this.moles = this.moles.filter((m) => !gone.has(m.id));
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
    this._give(rows, 'Whack Master', (pool) => pool.find((r) => r.place === 1 && P(r).points >= 8) || null);
    this._give(rows, 'Gold Digger', (pool) => this._maxBy(pool, (r) => P(r).golds, 2));
    this._give(rows, 'Red Alert', (pool) => this._maxBy(pool, (r) => P(r).bites, 2));
    this._give(rows, 'Pogo Stick', (pool) => this._maxBy(pool, (r) => r.jumps, 14));
    this._give(rows, 'Mole Menace', (pool) => this._maxBy(pool, (r) => P(r).stomps, 7));
  }

  _hud() {
    if (this.time < 0) return '';
    return this.moles.some((m) => m.kind === 'gold') ? 'GOLD MOLE!' : 'Jump on the moles!';
  }

  _extraSnapshot() {
    // [id, burrow, state (0 rumbling, 1 up), kind (0 normal, 1 red, 2 gold), how far through its state (0-1)]
    return {
      mo: this.moles.map((m) => {
        const age = this.time - m.born;
        const up = age >= this.cfg.rumble;
        const frac = up ? (age - this.cfg.rumble) / m.life : age / this.cfg.rumble;
        return [m.id, m.b, up ? 1 : 0, m.kind === 'red' ? 1 : m.kind === 'gold' ? 2 : 0, r2(Math.max(0, Math.min(1, frac)))];
      }),
    };
  }
}

MoleStomp.GAME_ID = 'moleStomp';
MoleStomp.TUNING = TUNING;
MoleStomp.VARIANTS = VARIANTS;
MoleStomp.BURROWS = BURROWS;

module.exports = MoleStomp;
