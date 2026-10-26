'use strict';

// ===========================================================================
// GOLD GRAB  -  minigame #2 (category: Collecting)
//
// Coins pop up all over the arena. Run over them to grab them. SHOVE a rival
// and they drop some of theirs - up to three, and nobody can be shoved again
// for a second, so there is no endless bullying. Every so often a big JACKPOT
// coin appears, and it always appears closer to whoever is in last place.
// Most coins when the clock runs out wins.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { r1, r2 } = ArenaGame;

const TUNING = {
  maxTime: 60,
  coinCap: 12, // how many ordinary coins can be lying around
  spawnEvery: 0.55,
  jackpotValue: 5,
  jackpotFirst: 9, // seconds after GO
  jackpotEvery: 14,
  jackpotLife: 9,
  pickupRadius: 30,
  dropMax: 3, // most coins a single shove can knock loose
  dropLock: 1.2, // you cannot re-grab coins you just dropped for this long
  scatterSpeed: 250,
  coinFriction: 4,
};

const VARIANTS = {
  classic: {
    name: 'Gold Grab',
    tagline: 'Grab coins. Steal coins. Be a coin goblin.',
    theme: 'sunny',
  },
  jackpot: {
    name: 'Gold Grab: Jackpot Jam',
    tagline: 'Fewer coins. Bigger jackpots. Bigger arguments.',
    theme: 'pink',
    coinCap: 8,
    jackpotFirst: 6,
    jackpotEvery: 8,
    jackpotValue: 6,
  },
};

const INSTRUCTIONS = [
  'Run over coins to grab them. The most coins at the end wins!',
  'SHOVE a rival and they drop some coins. Grab them before they do!',
  'JUMP to dodge a shove. A big JACKPOT coin appears now and then.',
  'Last place? The jackpot spawns closest to YOU.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump (dodge)', keys: 'Space' },
  { label: 'Shove', keys: 'E or Shift' },
  { label: 'Mute', keys: 'M' },
];

class GoldGrab extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };

    this.coins = [];
    this.nextCoinId = 1;
    this.nextSpawn = 0.6;
    this.nextJackpot = this.cfg.jackpotFirst;
    for (const p of this.players.values()) {
      p.coins = 0;
      p.coinsLost = 0;
      p.coinsKnockedLoose = 0;
      p.jackpots = 0;
    }
  }

  // ---- info for the intro card + client --------------------------------------
  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'goldGrab',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Collecting',
    };
  }

  static get arena() {
    return ArenaGame.baseArena(TUNING.maxTime, { scoreLabel: 'coins', scoreDir: 'high' });
  }

  // ---- rules ---------------------------------------------------------------------
  _update(dt) {
    this._spawnCoins();
    this._moveCoins(dt);
    this._expireJackpots();
    this._pickups();
  }

  _spawnCoins() {
    let guard = 0;
    while (this.time >= this.nextSpawn && guard++ < 5) {
      this.nextSpawn += this.cfg.spawnEvery;
      if (this.coins.filter((c) => !c.jackpot && !c.dropped).length >= this.cfg.coinCap) continue;
      const pt = this._randomPoint(40);
      this.coins.push({ id: this.nextCoinId++, x: pt.x, y: pt.y, v: 1, vx: 0, vy: 0, jackpot: false, dropped: false, lockId: null, lockUntil: 0, born: this.time });
    }

    if (this.time >= this.nextJackpot) {
      this.nextJackpot += this.cfg.jackpotEvery;
      const pt = this._jackpotSpot();
      this.coins.push({ id: this.nextCoinId++, x: pt.x, y: pt.y, v: this.cfg.jackpotValue, vx: 0, vy: 0, jackpot: true, dropped: false, lockId: null, lockUntil: 0, born: this.time });
      this.events.push({ k: 'jackpot', x: r1(pt.x), y: r1(pt.y) });
    }
  }

  // Catch-up rule: try a few random spots and use the one nearest to whoever
  // has the fewest coins (if everybody is level, it is simply random).
  _jackpotSpot() {
    const live = this._livePlayers();
    const lowest = Math.min(...live.map((p) => p.coins));
    const losers = live.filter((p) => p.coins === lowest);
    const allLevel = losers.length === live.length;
    const candidates = [];
    for (let i = 0; i < 6; i++) candidates.push(this._randomPoint(60));
    if (allLevel || live.length === 0) return candidates[0];
    const target = losers[Math.floor(this.rng() * losers.length)];
    candidates.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y));
    return candidates[0];
  }

  _moveCoins(dt) {
    const decay = Math.exp(-TUNING.coinFriction * dt);
    for (const c of this.coins) {
      if (c.vx === 0 && c.vy === 0) continue;
      const nx = c.x + c.vx * dt;
      const ny = c.y + c.vy * dt;
      if (ArenaGame.walkable(nx, c.y)) c.x = nx;
      else c.vx = 0;
      if (ArenaGame.walkable(c.x, ny)) c.y = ny;
      else c.vy = 0;
      c.vx *= decay;
      c.vy *= decay;
      if (Math.abs(c.vx) < 4 && Math.abs(c.vy) < 4) {
        c.vx = 0;
        c.vy = 0;
      }
    }
  }

  _expireJackpots() {
    this.coins = this.coins.filter((c) => {
      if (c.jackpot && this.time - c.born > this.cfg.jackpotLife) {
        this.events.push({ k: 'jackpotGone', x: r1(c.x), y: r1(c.y) });
        return false;
      }
      return true;
    });
  }

  _pickups() {
    const R = TUNING.pickupRadius;
    const taken = new Set();
    for (const p of this._livePlayers()) {
      if (p.z > 30) continue; // in the air: cannot reach the floor
      for (const c of this.coins) {
        if (taken.has(c.id)) continue;
        if (c.lockId === p.id && this.time < c.lockUntil) continue;
        if (Math.hypot(c.x - p.x, c.y - p.y) > R) continue;
        taken.add(c.id);
        p.coins += c.v;
        if (c.jackpot) p.jackpots++;
        this.events.push({ k: 'coin', id: p.id, x: r1(c.x), y: r1(c.y), v: c.v, jackpot: c.jackpot });
      }
    }
    if (taken.size) this.coins = this.coins.filter((c) => !taken.has(c.id));
  }

  _onHit(attacker, victim) {
    const n = Math.min(victim.coins, this.cfg.dropMax);
    if (n <= 0) return;
    victim.coins -= n;
    victim.coinsLost += n;
    attacker.coinsKnockedLoose += n;
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      this.coins.push({
        id: this.nextCoinId++,
        x: victim.x,
        y: victim.y,
        v: 1,
        vx: Math.cos(a) * TUNING.scatterSpeed,
        vy: Math.sin(a) * TUNING.scatterSpeed,
        jackpot: false,
        dropped: true,
        lockId: victim.id,
        lockUntil: this.time + TUNING.dropLock,
        born: this.time,
      });
    }
    this.events.push({ k: 'drop', id: victim.id, n, x: r1(victim.x), y: r1(victim.y) });
  }

  _scoreOf(p) {
    return p.coins;
  }

  _rankKey(p) {
    return p.coins;
  }

  _detail(p) {
    return p.coins === 1 ? '1 coin' : `${p.coins} coins`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Coin Goblin', (pool) => pool.find((r) => r.place === 1 && P(r).coins >= 3) || null);
    this._give(rows, 'Pickpocket', (pool) => this._maxBy(pool, (r) => P(r).coinsKnockedLoose, 4));
    this._give(rows, 'Jackpot Hunter', (pool) => this._maxBy(pool, (r) => P(r).jackpots, 2));
    this._give(rows, 'Butterfingers', (pool) => this._maxBy(pool, (r) => P(r).coinsLost, 5));
    this._give(rows, 'Pogo Stick', (pool) => this._maxBy(pool, (r) => r.jumps, 12));
    this._give(rows, 'Empty Pockets', (pool) => {
      const last = pool.filter((r) => r.place === Math.max(...pool.map((x) => x.place)) && P(r).coins <= 3);
      return pool.length >= 3 && last.length === 1 ? last[0] : null;
    });
  }

  _hud() {
    if (this.time < 0) return '';
    if (this.coins.some((c) => c.jackpot)) return 'JACKPOT on the floor!';
    const left = Math.max(0, Math.ceil(this.nextJackpot - this.time));
    return `Jackpot in ${left}s`;
  }

  _extraSnapshot() {
    return {
      // [id, x, y, isJackpot, jackpotLifeLeft(0-1), dropped]
      cn: this.coins.map((c) => [
        c.id,
        r1(c.x),
        r1(c.y),
        c.jackpot ? 1 : 0,
        c.jackpot ? r2(Math.max(0, 1 - (this.time - c.born) / this.cfg.jackpotLife)) : 0,
        c.dropped ? 1 : 0,
      ]),
    };
  }
}

GoldGrab.GAME_ID = 'goldGrab';
GoldGrab.TUNING = TUNING;
GoldGrab.VARIANTS = VARIANTS;

module.exports = GoldGrab;
