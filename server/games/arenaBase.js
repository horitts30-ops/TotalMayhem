'use strict';

// ===========================================================================
// ARENA BASE  -  shared code for the "open arena" minigames
//
// Gold Grab, Hot Potato and Hill Hustle all happen in the same kind of arena:
// a flat rounded floor where blobs run, jump and shove each other. This class
// handles everything those games have in common:
//
//   * movement, jumping, soft collisions between players
//   * the shove (with a cooldown, knockback, stun and a short immunity so
//     nobody can be bullied non-stop)
//   * the 3-2-1 countdown, the clock, "somebody left", events
//   * turning a score into places and points, and the results rows
//
// A minigame only has to fill in the blanks (see "HOOKS" below). The room,
// lobby, results screens and network code never need to know which game it is:
// every minigame offers the same small interface as Crumble Floor:
//
//   new Game(participants, variantId, options)
//   game.setInput(id, input)   game.tick(dt)   game.snapshot()
//   game.isFinished()          game.results()  game.removePlayer(id)
//   static describe(variantId) static arena
//
// Like crumbleFloor.js, this file knows nothing about sockets or browsers, so
// it can be tested on its own.
// ===========================================================================

const { safeNumber } = require('../util');

// ----- Arena (same size and shape as Crumble Floor, so the client can reuse it)
const TILE = 64;
const COLS = 14;
const ROWS = 9;
const WORLD_W = COLS * TILE; // 896
const WORLD_H = ROWS * TILE; // 576

// ----- Shared "feel" numbers (match Crumble Floor so every game controls alike)
const TUNING = {
  radius: 18,
  speed: 235,
  groundAccel: 14,
  airAccel: 2.4,
  jumpSpeed: 430,
  gravity: 1350,
  jumpBuffer: 0.14,
  knockFriction: 4.5,

  shoveCooldown: 1.4,
  shoveRange: 80,
  shoveConeDot: 0.25,
  shoveSpeed: 540,
  shoveRecoil: 90,
  shoveBuffer: 0.15,
  shoveImmune: 1.0, // a shoved player cannot be shoved again for this long
  stunTime: 0.22,
  dodgeHeight: 18, // airborne players above this height cannot be shoved: JUMP TO DODGE

  countdown: 3,
};

// Which tiles of the 14x9 grid exist (rounded corners are empty).
function buildFloor() {
  const solid = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const nx = (c + 0.5 - COLS / 2) / (COLS / 2);
      const ny = (r + 0.5 - ROWS / 2) / (ROWS / 2);
      solid.push(nx * nx + ny * ny <= 1.25);
    }
  }
  return solid;
}
const FLOOR = buildFloor();

function tileSolid(x, y) {
  const c = Math.floor(x / TILE);
  const r = Math.floor(y / TILE);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  return FLOOR[r * COLS + c];
}

// A blob (radius ~14 for walls) fits here if the centre and its 4 sides are on the floor.
function walkable(x, y) {
  const m = 14;
  return tileSolid(x, y) && tileSolid(x - m, y) && tileSolid(x + m, y) && tileSolid(x, y - m) && tileSolid(x, y + m);
}

function placePoints(place, n) {
  return Math.max(1, Math.round((10 * (n - place + 1)) / n));
}

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

// ===========================================================================
class ArenaGame {
  /**
   * @param {{id:string,name:string}[]} participants
   * @param {object} variant  the variant table entry (grip, slide, gravity, ...)
   * @param {{timeScale?:number, rng?:Function}} options  both are for automated tests
   * @param {{maxTime:number}} setup
   */
  constructor(participants, variant, options = {}, setup = { maxTime: 60 }) {
    this.v = variant;
    this.timeScale = options.timeScale > 0 ? options.timeScale : 1;
    this.rng = typeof options.rng === 'function' ? options.rng : Math.random;
    this.maxTime = setup.maxTime;

    this.time = -TUNING.countdown; // negative = 3-2-1 countdown
    this.finished = false;
    this._results = null;
    this.events = [];

    this.players = new Map();
    const n = participants.length;
    this.participantCount = n;
    participants.forEach((info, i) => {
      const angle = n === 1 ? Math.PI : (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = WORLD_W / 2 + Math.cos(angle) * (n === 1 ? 0 : TILE * 3.6);
      const y = WORLD_H / 2 + Math.sin(angle) * (n === 1 ? 0 : TILE * 2.4);
      const dx = WORLD_W / 2 - x;
      const dy = WORLD_H / 2 - y;
      const d = Math.hypot(dx, dy) || 1;
      this.players.set(info.id, {
        id: info.id,
        name: info.name,
        state: 'alive', // alive | left
        x,
        y,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        kx: 0,
        ky: 0,
        fx: n === 1 ? 1 : dx / d,
        fy: n === 1 ? 0 : dy / d,
        input: { mx: 0, my: 0, jump: false, shove: false },
        jumpBuf: 0,
        shoveBuf: 0,
        shoveCd: 0,
        shoveAnim: 0,
        immune: 0,
        stun: 0,
        speedMul: 1,
        abandoned: false,
        jumps: 0,
        shoves: 0,
        hitsTaken: 0,
        hitsDealt: 0,
      });
    });
  }

  // =========================================================== HOOKS (override)
  _onGo() {}
  _update(dt) {} // called every tick once the round is live
  _onHit(attacker, victim) {} // a shove connected
  _canHit(attacker, victim) {
    return victim.immune <= 0;
  }
  _onRemove(player) {}
  _rankKey(player) {
    return 0; // higher = better
  }
  _detail(player) {
    return '';
  }
  _titles(rows, byId) {} // give funny titles
  _playerSnapshot(p) {
    return {};
  }
  _extraSnapshot() {
    return {};
  }
  _hud() {
    return '';
  }
  _scoreOf(p) {
    return 0; // the number shown on the round-score chips
  }

  // =========================================================== helpers for games
  _randomPoint(margin = 20) {
    for (let i = 0; i < 60; i++) {
      const x = margin + this.rng() * (WORLD_W - margin * 2);
      const y = margin + this.rng() * (WORLD_H - margin * 2);
      if (walkable(x, y)) return { x, y };
    }
    return { x: WORLD_W / 2, y: WORLD_H / 2 };
  }

  _livePlayers() {
    return [...this.players.values()].filter((p) => p.state === 'alive');
  }

  // =========================================================== input
  setInput(id, raw) {
    const p = this.players.get(id);
    if (!p || !raw || typeof raw !== 'object') return;
    const next = {
      mx: safeNumber(raw.mx, -1, 1),
      my: safeNumber(raw.my, -1, 1),
      jump: raw.jump === true,
      shove: raw.shove === true,
    };
    // A quick tap that starts and ends between two ticks must not be lost.
    if (next.jump && !p.input.jump) p.jumpBuf = TUNING.jumpBuffer;
    if (next.shove && !p.input.shove) p.shoveBuf = TUNING.shoveBuffer;
    p.input = next;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p || p.state === 'left') return;
    p.abandoned = true;
    p.state = 'left';
    this.events.push({ k: 'left', id });
    this._onRemove(p);
  }

  // =========================================================== simulation
  tick(realDt) {
    const dt = realDt * this.timeScale;
    const before = this.time;
    this.time += dt;
    const live = this.time >= 0 && !this.finished;
    if (before < 0 && this.time >= 0) {
      this.events.push({ k: 'go' });
      this._onGo();
    }

    for (const p of this.players.values()) if (p.state === 'alive') this._stepPlayer(p, dt, live);
    this._resolveBumps();

    if (!live) return;
    this._update(dt);
    if (this.time >= this.maxTime || this._livePlayers().length === 0) this._finish();
  }

  _stepPlayer(p, dt, live) {
    p.shoveCd = Math.max(0, p.shoveCd - dt);
    p.shoveAnim = Math.max(0, p.shoveAnim - dt);
    p.immune = Math.max(0, p.immune - dt);
    p.stun = Math.max(0, p.stun - dt);

    const grounded = p.z <= 0;
    const stunned = p.stun > 0;
    const mx = live ? p.input.mx : 0;
    const my = live ? p.input.my : 0;
    const len = Math.hypot(mx, my);
    const nx = len > 1 ? mx / len : mx;
    const ny = len > 1 ? my / len : my;
    if (len > 0.1 && !stunned) {
      p.fx = mx / len;
      p.fy = my / len;
    }

    const speed = TUNING.speed * (this.v.speed || 1) * p.speedMul;
    const accel = grounded ? TUNING.groundAccel * (this.v.grip || 1) : TUNING.airAccel;
    if (!stunned) {
      const k = Math.min(1, accel * dt);
      p.vx += (nx * speed - p.vx) * k;
      p.vy += (ny * speed - p.vy) * k;
    }

    // jump (a jump pressed slightly early still counts)
    if (live && p.jumpBuf > 0) {
      if (grounded) {
        p.vz = TUNING.jumpSpeed * (this.v.jump || 1);
        p.z = 0.01;
        p.jumpBuf = 0;
        p.jumps++;
        this.events.push({ k: 'jump', id: p.id, x: r1(p.x), y: r1(p.y) });
      } else {
        p.jumpBuf = Math.max(0, p.jumpBuf - dt);
      }
    } else if (!live) {
      p.jumpBuf = 0;
    }

    // shove
    if (live && p.shoveBuf > 0) {
      if (p.shoveCd <= 0) {
        this._doShove(p);
        p.shoveBuf = 0;
      } else {
        p.shoveBuf = Math.max(0, p.shoveBuf - dt);
      }
    } else if (!live) {
      p.shoveBuf = 0;
    }

    // move, one axis at a time so you slide along the edge of the arena
    const dx = (p.vx + p.kx) * dt;
    const dy = (p.vy + p.ky) * dt;
    if (walkable(p.x + dx, p.y)) p.x += dx;
    else {
      p.vx = 0;
      p.kx = 0;
    }
    if (walkable(p.x, p.y + dy)) p.y += dy;
    else {
      p.vy = 0;
      p.ky = 0;
    }
    const decay = Math.exp(-TUNING.knockFriction * (this.v.slide || 1) * dt);
    p.kx *= decay;
    p.ky *= decay;

    // gravity / landing
    if (!grounded || p.vz > 0) {
      p.vz -= TUNING.gravity * (this.v.gravity || 1) * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0;
        p.vz = 0;
        this.events.push({ k: 'land', id: p.id, x: r1(p.x), y: r1(p.y) });
      }
    }
  }

  _doShove(p) {
    p.shoveCd = TUNING.shoveCooldown;
    p.shoveAnim = 0.28;
    p.shoves++;
    let hits = 0;
    for (const q of this.players.values()) {
      if (q === p || q.state !== 'alive') continue;
      if (q.z > TUNING.dodgeHeight) continue; // jumped over it!
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > TUNING.shoveRange) continue;
      if (d > 1) {
        const dot = (dx * p.fx + dy * p.fy) / d;
        if (dot < TUNING.shoveConeDot) continue;
      }
      if (!this._canHit(p, q)) continue;
      let kx = p.fx * 0.6 + (d > 1 ? dx / d : p.fx) * 0.4;
      let ky = p.fy * 0.6 + (d > 1 ? dy / d : p.fy) * 0.4;
      const kl = Math.hypot(kx, ky) || 1;
      const power = TUNING.shoveSpeed * (this.v.shoveSpeed || 1);
      q.kx = (kx / kl) * power;
      q.ky = (ky / kl) * power;
      q.stun = TUNING.stunTime;
      q.immune = TUNING.shoveImmune;
      q.hitsTaken++;
      p.hitsDealt++;
      hits++;
      this.events.push({ k: 'hit', id: q.id, by: p.id, x: r1(q.x), y: r1(q.y) });
      this._onHit(p, q);
    }
    p.kx -= p.fx * TUNING.shoveRecoil;
    p.ky -= p.fy * TUNING.shoveRecoil;
    this.events.push({ k: 'shove', id: p.id, x: r1(p.x), y: r1(p.y), fx: r2(p.fx), fy: r2(p.fy), hits });
  }

  // Players are soft, bouncy blobs. You CAN jump over another player.
  _resolveBumps() {
    const list = this._livePlayers();
    const minD = TUNING.radius * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (Math.abs(a.z - b.z) > 26) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 0.01) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (minD - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        if (walkable(a.x - ux * push, a.y - uy * push)) {
          a.x -= ux * push;
          a.y -= uy * push;
        }
        if (walkable(b.x + ux * push, b.y + uy * push)) {
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
  }

  // =========================================================== ending + results
  _finish() {
    if (this.finished) return;
    this.finished = true;
    this._results = this._computeResults();
    this.events.push({ k: 'end' });
  }

  isFinished() {
    return this.finished;
  }

  results() {
    if (!this._results) this._results = this._computeResults();
    return this._results;
  }

  _computeResults() {
    const entries = [...this.players.values()].map((p) => ({
      p,
      key: p.abandoned ? -Infinity : this._rankKey(p),
    }));
    entries.sort((a, b) => b.key - a.key);
    const n = entries.length;
    let place = 1;
    entries.forEach((e, i) => {
      if (i > 0 && e.key !== entries[i - 1].key) place = i + 1;
      e.place = place;
    });
    this._placeOf = new Map(entries.map((e) => [e.p.id, e.place]));

    const rows = entries.map((e) => {
      const p = e.p;
      const base = p.abandoned ? 0 : placePoints(e.place, n);
      return {
        id: p.id,
        place: e.place,
        points: base,
        basePoints: base,
        koBonus: 0,
        survived: !p.abandoned,
        abandoned: p.abandoned,
        detail: p.abandoned ? '' : this._detail(p),
        jumps: p.jumps,
        shoves: p.shoves,
        hitsTaken: p.hitsTaken,
        title: '',
      };
    });
    const byId = new Map([...this.players.values()].map((p) => [p.id, p]));
    this._titles(rows, byId);
    return rows;
  }

  // Titles: each player gets at most one, each title goes to one player.
  _give(rows, title, picker) {
    const pool = rows.filter((r) => !r.title && !r.abandoned);
    const best = picker(pool);
    if (best) best.title = title;
  }

  _maxBy(pool, f, min) {
    let best = null;
    for (const r of pool) if (f(r) >= min && (!best || f(r) > f(best))) best = r;
    return best;
  }

  // =========================================================== snapshot
  snapshot() {
    const winners = this.finished && this._placeOf ? this._placeOf : null;
    const ps = [];
    for (const p of this.players.values()) {
      ps.push({
        id: p.id,
        x: r1(p.x),
        y: r1(p.y),
        z: r1(p.z),
        vx: Math.round(p.vx + p.kx),
        vy: Math.round(p.vy + p.ky),
        vz: Math.round(p.vz),
        fx: r2(p.fx),
        fy: r2(p.fy),
        st: p.state,
        fl: 0,
        sh: p.shoveAnim > 0 ? r2(p.shoveAnim / 0.28) : 0,
        im: p.immune > 0 ? 1 : 0,
        sn: p.stun > 0 ? 1 : 0,
        sl: 0,
        cd: r2(p.shoveCd),
        rs: this._scoreOf(p),
        ...(winners && winners.get(p.id) === 1 && !p.abandoned ? { md: 'happy' } : {}),
        ...this._playerSnapshot(p),
      });
    }
    const events = this.events;
    this.events = [];
    return {
      t: r2(this.time),
      fin: this.finished,
      alive: this._livePlayers().length,
      gid: this.constructor.GAME_ID,
      hud: this._hud(),
      ps,
      ev: events,
      ...this._extraSnapshot(),
    };
  }

  // =========================================================== static info
  // Subclasses call this to build their `arena` info (sent to the client once).
  static baseArena(maxTime, extra = {}) {
    return {
      cols: COLS,
      rows: ROWS,
      tile: TILE,
      width: WORLD_W,
      height: WORLD_H,
      maxTime,
      shoveCooldown: TUNING.shoveCooldown,
      gooCooldown: 1,
      scoreLabel: '',
      scoreDir: 'high',
      jumpLabel: 'Jump (dodge)',
      shoveLabel: 'Shove',
      ...extra,
    };
  }
}

ArenaGame.TUNING = TUNING;
ArenaGame.TILE = TILE;
ArenaGame.COLS = COLS;
ArenaGame.ROWS = ROWS;
ArenaGame.WORLD_W = WORLD_W;
ArenaGame.WORLD_H = WORLD_H;
ArenaGame.walkable = walkable;
ArenaGame.placePoints = placePoints;
ArenaGame.r1 = r1;
ArenaGame.r2 = r2;

module.exports = ArenaGame;
