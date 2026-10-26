'use strict';

// ===========================================================================
// CRUMBLE FLOOR  -  minigame #1 (category: Survival)
//
// The arena is a grid of tiles. Tiles crack, then fall away, faster and faster.
// Stay on the floor. JUMP over holes. SHOVE rivals off the edge.
// Fallen players become ghosts and drop goo puddles that slow the survivors.
//
// This file contains ONLY the rules of this minigame. It knows nothing about
// sockets, rooms or browsers, which is what lets us test it in isolation and
// (in Milestone 3) add more minigames that follow the same shape:
//
//   new Game(participants, variantId, options)
//   game.setInput(playerId, input)    <- latest controls from a player
//   game.tick(dt)                     <- advance the simulation
//   game.snapshot()                   <- what clients need to draw the world
//   game.isFinished() / game.results()
//   game.removePlayer(playerId)       <- somebody disconnected
//   static describe(variantId)        <- name + instructions for the intro card
// ===========================================================================

const { safeNumber } = require('../util');

// ----- Arena ---------------------------------------------------------------
const TILE = 64;
const COLS = 14;
const ROWS = 9;
const WORLD_W = COLS * TILE; // 896
const WORLD_H = ROWS * TILE; // 576

// Tile kinds (kept in the `kind` array)
const SOLID = 0;
const CRACKING = 1;
const GONE = 2; // fell during this round
const VOID = 3; // never existed (the rounded corners)

// ----- Tuning (all the "feel" numbers live here) ----------------------------
const TUNING = {
  radius: 18,
  speed: 235, // pixels per second
  groundAccel: 14,
  airAccel: 2.4, // low on purpose: you commit to a jump
  jumpSpeed: 430,
  gravity: 1350, // => about 0.64s in the air, ~68px high, ~150px far
  coyoteTime: 0.09, // can still jump this long after leaving the ground
  jumpBuffer: 0.14, // a jump pressed slightly early still counts
  holeGrace: 0.09, // walking off an edge: tiny delay before falling
  knockFriction: 4.5,

  shoveCooldown: 1.4,
  shoveRange: 80,
  shoveConeDot: 0.25, // roughly +-75 degrees in front of you
  shoveSpeed: 540,
  shoveRecoil: 90,
  shoveBuffer: 0.15,
  shoveImmune: 1.0, // a shoved player cannot be shoved again for this long
  stunTime: 0.22,
  koWindow: 3.0, // shove someone, they fall within 3s => you get the KO

  fallTime: 0.85,

  slowFactor: 0.45,
  slowTime: 1.8,
  puddleImmune: 3.0, // after being splatted, no splat again for this long
  puddleRadius: 34,
  puddleForm: 0.7, // warning time while the puddle "forms"
  puddleLife: 8,
  puddleAmmo: 3,
  puddleCooldown: 2.5,
  ghostSpeed: 220,

  countdown: 3, // seconds of 3-2-1 before the floor starts to crumble
  firstCrack: 2.0, // seconds after GO before the first tiles crack
  maxTime: 75, // round ends at this time at the latest
};

// ----- Variants (same rules, different twist) --------------------------------
const VARIANTS = {
  classic: {
    name: 'Crumble Floor',
    tagline: 'The floor is not lava. It is worse: it is gone.',
    crack: 1.0, // multiplies how long tiles take to fall
    interval: 1.0, // multiplies the time between waves
    grip: 1.0, // ground acceleration multiplier
    slide: 1.0, // knockback friction multiplier (lower = slides further)
    theme: 'sunny',
  },
  speedy: {
    name: 'Crumble Floor: Rush Hour',
    tagline: 'Same floor. Much less patience.',
    crack: 0.7,
    interval: 0.72,
    grip: 1.0,
    slide: 1.0,
    theme: 'pink',
  },
  slippery: {
    name: 'Crumble Floor: Butter Mode',
    tagline: 'Everything is slippery. Nothing is sacred.',
    crack: 1.0,
    interval: 0.9,
    grip: 0.22,
    slide: 0.5,
    theme: 'icy',
  },
};

const INSTRUCTIONS = [
  'Stay on the floor! Tiles crack, then fall away.',
  'JUMP over holes. You cannot fall while you are in the air.',
  'SHOVE rivals toward the edge for bonus points.',
  'Fell off? Become a ghost and drop goo puddles to slow the survivors.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Jump', keys: 'Space' },
  { label: 'Shove / Drop goo', keys: 'E or Shift' },
];

// ----- Helpers ----------------------------------------------------------------
function buildKinds() {
  const kinds = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const nx = (c + 0.5 - COLS / 2) / (COLS / 2);
      const ny = (r + 0.5 - ROWS / 2) / (ROWS / 2);
      kinds.push(nx * nx + ny * ny <= 1.25 ? SOLID : VOID);
    }
  }
  return kinds;
}

function placePoints(place, n) {
  return Math.max(1, Math.round((10 * (n - place + 1)) / n));
}

function r1(n) {
  return Math.round(n * 10) / 10;
}
function r2(n) {
  return Math.round(n * 100) / 100;
}

// ===========================================================================
class CrumbleFloor {
  /**
   * @param {{id:string, name:string}[]} participants
   * @param {string} variantId  one of the keys of VARIANTS
   * @param {{timeScale?:number}} options  timeScale is for automated tests
   */
  constructor(participants, variantId = 'classic', options = {}) {
    this.variantId = VARIANTS[variantId] ? variantId : 'classic';
    this.v = VARIANTS[this.variantId];
    this.timeScale = options.timeScale > 0 ? options.timeScale : 1;

    this.time = -TUNING.countdown; // negative = 3-2-1 countdown
    this.finished = false;
    this._results = null;
    this.events = [];

    this.kind = buildKinds();
    this.crackT = new Array(COLS * ROWS).fill(0);
    this.crackDur = new Array(COLS * ROWS).fill(1);
    this.nextWaveAt = TUNING.firstCrack;

    this.puddles = [];
    this.nextPuddleId = 1;

    this.players = new Map();
    const n = participants.length;
    this.participantCount = n;
    participants.forEach((info, i) => {
      // Spread players around an ellipse, all facing the middle.
      const angle = n === 1 ? Math.PI : (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = WORLD_W / 2 + Math.cos(angle) * (n === 1 ? 0 : TILE * 3.6);
      const y = WORLD_H / 2 + Math.sin(angle) * (n === 1 ? 0 : TILE * 2.4);
      const dx = WORLD_W / 2 - x;
      const dy = WORLD_H / 2 - y;
      const d = Math.hypot(dx, dy) || 1;
      this.players.set(info.id, {
        id: info.id,
        name: info.name,
        state: 'alive', // alive | falling | ghost | left
        x,
        y,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        kx: 0,
        ky: 0, // knockback velocity (decays)
        fx: n === 1 ? 1 : dx / d,
        fy: n === 1 ? 0 : dy / d,
        input: { mx: 0, my: 0, jump: false, shove: false },
        jumpBuf: 0,
        shoveBuf: 0,
        coyote: 0,
        holeT: 0,
        landed: false,
        shoveCd: 0,
        shoveAnim: 0,
        stun: 0,
        immune: 0,
        slow: 0,
        puddleImmune: 0,
        fallT: 0,
        fvx: 0,
        fvy: 0,
        outAt: null,
        lastShovedBy: null,
        lastShovedAt: -999,
        puddleAmmo: TUNING.puddleAmmo,
        puddleCd: 0,
        abandoned: false,
        // stats (used for scoring and funny titles)
        kos: 0,
        jumps: 0,
        shoves: 0,
        hitsTaken: 0,
        puddleHits: 0,
      });
    });
  }

  // ---- Information for the intro card --------------------------------------
  static describe(variantId = 'classic') {
    const v = VARIANTS[variantId] || VARIANTS.classic;
    return {
      gameId: 'crumbleFloor',
      variantId: VARIANTS[variantId] ? variantId : 'classic',
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Survival',
    };
  }

  static get arena() {
    return {
      cols: COLS,
      rows: ROWS,
      tile: TILE,
      width: WORLD_W,
      height: WORLD_H,
      maxTime: TUNING.maxTime,
      // Sent so the HUD can draw cooldown bars without hard-coding the numbers.
      shoveCooldown: TUNING.shoveCooldown,
      gooCooldown: TUNING.puddleCooldown,
    };
  }

  // ---- Input -----------------------------------------------------------------
  setInput(id, raw) {
    const p = this.players.get(id);
    if (!p || !raw || typeof raw !== 'object') return;
    const next = {
      mx: safeNumber(raw.mx, -1, 1),
      my: safeNumber(raw.my, -1, 1),
      jump: raw.jump === true,
      shove: raw.shove === true,
    };
    // Detect "button just pressed" the moment the message arrives, so a very
    // quick tap that starts and ends between two server ticks is not lost.
    if (next.jump && !p.input.jump) p.jumpBuf = TUNING.jumpBuffer;
    if (next.shove && !p.input.shove) p.shoveBuf = TUNING.shoveBuffer;
    p.input = next;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p || p.state === 'left') return;
    if (p.state === 'alive') {
      p.abandoned = true;
      p.outAt = this.time;
    }
    p.state = 'left';
    this.events.push({ k: 'left', id });
  }

  // ---- Simulation --------------------------------------------------------------
  tick(realDt) {
    const dt = realDt * this.timeScale;
    const before = this.time;
    this.time += dt;
    if (before < 0 && this.time >= 0) this.events.push({ k: 'go' });

    if (this.time >= 0 && !this.finished) this._updateWaves();
    this._updateTiles(dt);

    for (const p of this.players.values()) this._updatePlayer(p, dt);
    this._resolveBumps();
    for (const p of this.players.values()) this._checkFooting(p, dt);
    this._updatePuddles(dt);

    if (!this.finished) this._checkEnd();
  }

  _updateWaves() {
    if (this.time < this.nextWaveAt) return;
    const t = this.time;
    const count = 3 + Math.floor(t / 16);
    const crackDur = Math.max(0.9, 1.4 - t * 0.009) * this.v.crack;
    const interval = Math.max(0.9, 1.8 - t * 0.015) * this.v.interval;

    let picked = 0;
    for (let i = 0; i < count; i++) {
      const idx = this._pickTile();
      if (idx < 0) break;
      this.kind[idx] = CRACKING;
      this.crackT[idx] = 0;
      this.crackDur[idx] = crackDur;
      picked++;
    }
    if (picked > 0) this.events.push({ k: 'crack', n: picked });
    this.nextWaveAt = t + interval;
  }

  // Prefer tiles next to existing holes/edges so the floor erodes organically,
  // but keep some pure randomness so it stays unpredictable.
  _pickTile() {
    const solid = [];
    const nearHole = [];
    for (let idx = 0; idx < this.kind.length; idx++) {
      if (this.kind[idx] !== SOLID) continue;
      solid.push(idx);
      const c = idx % COLS;
      const r = Math.floor(idx / COLS);
      const nb = [
        c > 0 ? this.kind[idx - 1] : VOID,
        c < COLS - 1 ? this.kind[idx + 1] : VOID,
        r > 0 ? this.kind[idx - COLS] : VOID,
        r < ROWS - 1 ? this.kind[idx + COLS] : VOID,
      ];
      if (nb.some((k) => k !== SOLID)) nearHole.push(idx);
    }
    if (solid.length === 0) return -1;
    const pool = nearHole.length > 0 && Math.random() < 0.6 ? nearHole : solid;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _updateTiles(dt) {
    for (let idx = 0; idx < this.kind.length; idx++) {
      if (this.kind[idx] !== CRACKING) continue;
      this.crackT[idx] += dt;
      if (this.crackT[idx] >= this.crackDur[idx]) {
        this.kind[idx] = GONE;
        this.events.push({ k: 'fall', idx });
      }
    }
  }

  _solidAt(x, y) {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    const k = this.kind[r * COLS + c];
    return k === SOLID || k === CRACKING;
  }

  _updatePlayer(p, dt) {
    p.shoveCd = Math.max(0, p.shoveCd - dt);
    p.shoveAnim = Math.max(0, p.shoveAnim - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.immune = Math.max(0, p.immune - dt);
    p.slow = Math.max(0, p.slow - dt);
    p.puddleImmune = Math.max(0, p.puddleImmune - dt);
    p.puddleCd = Math.max(0, p.puddleCd - dt);
    p.landed = false;

    if (p.state === 'alive') this._moveAlive(p, dt);
    else if (p.state === 'falling') this._moveFalling(p, dt);
    else if (p.state === 'ghost') this._moveGhost(p, dt);
  }

  _moveAlive(p, dt) {
    const inp = p.input;
    let mx = inp.mx;
    let my = inp.my;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const stunned = p.stun > 0;
    if (len > 0.15 && !stunned) {
      p.fx = mx / Math.hypot(mx, my);
      p.fy = my / Math.hypot(mx, my);
    }

    const grounded = p.z <= 0 && p.vz <= 0;
    const speed = TUNING.speed * (p.slow > 0 ? TUNING.slowFactor : 1);
    const accel = grounded ? TUNING.groundAccel * this.v.grip : TUNING.airAccel;
    if (!stunned) {
      const k = Math.min(1, accel * dt);
      p.vx += (mx * speed - p.vx) * k;
      p.vy += (my * speed - p.vy) * k;
    }

    // --- Jump -------------------------------------------------------------
    if (grounded) p.coyote = TUNING.coyoteTime;
    else p.coyote = Math.max(0, p.coyote - dt);

    if (p.jumpBuf > 0) {
      if (grounded || p.coyote > 0) {
        p.vz = TUNING.jumpSpeed;
        p.z = 0.01;
        p.coyote = 0;
        p.jumpBuf = 0;
        p.holeT = 0;
        p.jumps++;
        this.events.push({ k: 'jump', id: p.id, x: r1(p.x), y: r1(p.y) });
      } else {
        p.jumpBuf = Math.max(0, p.jumpBuf - dt);
      }
    }

    // --- Shove ------------------------------------------------------------
    if (p.shoveBuf > 0) {
      if (this.time >= 0 && p.shoveCd <= 0) {
        this._doShove(p);
        p.shoveBuf = 0;
      } else {
        p.shoveBuf = Math.max(0, p.shoveBuf - dt);
      }
    }

    // --- Move -------------------------------------------------------------
    p.x += (p.vx + p.kx) * dt;
    p.y += (p.vy + p.ky) * dt;
    const decay = Math.exp(-TUNING.knockFriction * this.v.slide * dt);
    p.kx *= decay;
    p.ky *= decay;
    p.x = Math.min(WORLD_W + 100, Math.max(-100, p.x));
    p.y = Math.min(WORLD_H + 100, Math.max(-100, p.y));

    // --- Gravity / landing ---------------------------------------------------
    if (!grounded || p.vz > 0) {
      p.vz -= TUNING.gravity * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0;
        p.vz = 0;
        p.landed = true;
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
      if (q === p || q.state !== 'alive' || q.immune > 0) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > TUNING.shoveRange) continue;
      if (d > 1) {
        const dot = (dx * p.fx + dy * p.fy) / d;
        if (dot < TUNING.shoveConeDot) continue;
      }
      // Blend "where I am facing" with "where they are" for a satisfying push.
      let kx = p.fx * 0.6 + (d > 1 ? dx / d : p.fx) * 0.4;
      let ky = p.fy * 0.6 + (d > 1 ? dy / d : p.fy) * 0.4;
      const kl = Math.hypot(kx, ky) || 1;
      kx /= kl;
      ky /= kl;
      q.kx = kx * TUNING.shoveSpeed;
      q.ky = ky * TUNING.shoveSpeed;
      q.stun = TUNING.stunTime;
      q.immune = TUNING.shoveImmune;
      q.lastShovedBy = p.id;
      q.lastShovedAt = this.time;
      q.hitsTaken++;
      hits++;
      this.events.push({ k: 'hit', id: q.id, by: p.id, x: r1(q.x), y: r1(q.y) });
    }
    p.kx -= p.fx * TUNING.shoveRecoil;
    p.ky -= p.fy * TUNING.shoveRecoil;
    this.events.push({ k: 'shove', id: p.id, x: r1(p.x), y: r1(p.y), fx: r2(p.fx), fy: r2(p.fy), hits });
  }

  // Players are soft, bouncy blobs. You CAN jump over another player.
  _resolveBumps() {
    const list = [];
    for (const p of this.players.values()) if (p.state === 'alive') list.push(p);
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
        if (d < 0.001) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d = Math.hypot(dx, dy) || 1;
        }
        const nx = dx / d;
        const ny = dy / d;
        const push = (minD - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        a.kx -= nx * 30;
        a.ky -= ny * 30;
        b.kx += nx * 30;
        b.ky += ny * 30;
      }
    }
  }

  _checkFooting(p, dt) {
    if (p.state !== 'alive') return;
    if (p.z > 0 || p.vz > 0) {
      p.holeT = 0;
      return;
    }
    if (this._solidAt(p.x, p.y)) {
      p.holeT = 0;
      return;
    }
    // Over a hole while on the ground.
    p.holeT += dt;
    if (p.landed || p.holeT >= TUNING.holeGrace) this._startFall(p);
  }

  _startFall(p) {
    p.state = 'falling';
    p.fallT = 0;
    p.outAt = this.time;
    p.fvx = (p.vx + p.kx) * 0.6;
    p.fvy = (p.vy + p.ky) * 0.6;
    let by = null;
    if (p.lastShovedBy && this.time - p.lastShovedAt <= TUNING.koWindow) {
      const s = this.players.get(p.lastShovedBy);
      if (s && s !== p) {
        s.kos++;
        by = s.id;
        this.events.push({ k: 'ko', id: s.id, victim: p.id });
      }
    }
    this.events.push({ k: 'out', id: p.id, x: r1(p.x), y: r1(p.y), by });
  }

  _moveFalling(p, dt) {
    p.fallT += dt;
    p.x += p.fvx * dt;
    p.y += p.fvy * dt;
    p.fvx *= Math.exp(-3 * dt);
    p.fvy *= Math.exp(-3 * dt);
    if (p.fallT >= TUNING.fallTime) {
      p.state = 'ghost';
      p.x = Math.min(WORLD_W - 40, Math.max(40, p.x));
      p.y = Math.min(WORLD_H - 40, Math.max(40, p.y));
      p.vx = 0;
      p.vy = 0;
      p.kx = 0;
      p.ky = 0;
      p.z = 0;
      p.vz = 0;
      this.events.push({ k: 'ghost', id: p.id });
    }
  }

  _moveGhost(p, dt) {
    const inp = p.input;
    let mx = inp.mx;
    let my = inp.my;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    if (len > 0.15) {
      p.fx = mx / Math.hypot(mx, my);
      p.fy = my / Math.hypot(mx, my);
    }
    const k = Math.min(1, 8 * dt);
    p.vx += (mx * TUNING.ghostSpeed - p.vx) * k;
    p.vy += (my * TUNING.ghostSpeed - p.vy) * k;
    p.x = Math.min(WORLD_W - 20, Math.max(20, p.x + p.vx * dt));
    p.y = Math.min(WORLD_H - 20, Math.max(20, p.y + p.vy * dt));

    if (p.shoveBuf > 0) {
      if (this.time >= 0 && p.puddleCd <= 0 && p.puddleAmmo > 0) {
        if (this._solidAt(p.x, p.y)) {
          this.puddles.push({
            id: this.nextPuddleId++,
            owner: p.id,
            x: p.x,
            y: p.y,
            age: 0,
          });
          p.puddleAmmo--;
          p.puddleCd = TUNING.puddleCooldown;
          this.events.push({ k: 'puddle', id: p.id, x: r1(p.x), y: r1(p.y) });
        } else {
          this.events.push({ k: 'deny', id: p.id });
        }
        p.shoveBuf = 0;
      } else {
        p.shoveBuf = Math.max(0, p.shoveBuf - dt);
      }
    }
  }

  _updatePuddles(dt) {
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const pd = this.puddles[i];
      pd.age += dt;
      const onFloor = this._solidAt(pd.x, pd.y);
      if (pd.age >= TUNING.puddleLife || !onFloor) {
        this.puddles.splice(i, 1);
        continue;
      }
      if (pd.age < TUNING.puddleForm) continue; // still "forming" = a warning
      for (const p of this.players.values()) {
        if (p.state !== 'alive' || p.z > 6 || p.puddleImmune > 0) continue;
        if (Math.hypot(p.x - pd.x, p.y - pd.y) <= TUNING.puddleRadius + TUNING.radius * 0.5) {
          p.slow = TUNING.slowTime;
          p.puddleImmune = TUNING.puddleImmune;
          const owner = this.players.get(pd.owner);
          if (owner && owner !== p) owner.puddleHits++;
          this.events.push({ k: 'slow', id: p.id, x: r1(p.x), y: r1(p.y) });
        }
      }
    }
  }

  _aliveCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.state === 'alive') n++;
    return n;
  }

  _checkEnd() {
    if (this.time < 0) return;
    const alive = this._aliveCount();
    const ended =
      (this.participantCount >= 2 ? alive <= 1 : alive === 0) || this.time >= TUNING.maxTime;
    if (ended) this._finish();
  }

  _finish() {
    this.finished = true;
    this._results = this._computeResults();
    this.events.push({ k: 'end' });
  }

  isFinished() {
    return this.finished;
  }

  // ---- Results ------------------------------------------------------------------
  _computeResults() {
    const entries = [...this.players.values()].map((p) => ({
      p,
      key: p.state === 'alive' ? Infinity : p.outAt,
    }));
    entries.sort((a, b) => b.key - a.key);
    const n = entries.length;

    let place = 1;
    entries.forEach((e, i) => {
      if (i > 0 && e.key !== entries[i - 1].key) place = i + 1;
      e.place = place;
    });

    const rows = entries.map((e) => {
      const p = e.p;
      const base = p.abandoned ? 0 : placePoints(e.place, n);
      const koBonus = p.abandoned ? 0 : Math.min(p.kos, 3) * 2;
      return {
        id: p.id,
        place: e.place,
        points: base + koBonus,
        basePoints: base,
        koBonus,
        survived: p.state === 'alive',
        abandoned: p.abandoned,
        kos: p.kos,
        jumps: p.jumps,
        shoves: p.shoves,
        hitsTaken: p.hitsTaken,
        puddleHits: p.puddleHits,
        title: '',
        _key: e.key,
      };
    });

    // Funny titles. Each player gets at most one; each title goes to one player
    // (the best candidate), in this priority order.
    const give = (title, picker) => {
      const pool = rows.filter((r) => !r.title && !r.abandoned);
      const best = picker(pool);
      if (best) best.title = title;
    };
    const maxBy = (pool, f, min) => {
      let best = null;
      for (const r of pool) if (f(r) >= min && (!best || f(r) > f(best))) best = r;
      return best;
    };

    give('Floor Champion', (pool) => pool.find((r) => r.place === 1) || null);
    give('Absolute Menace', (pool) => maxBy(pool, (r) => r.kos, 2));
    give('Menace', (pool) => maxBy(pool, (r) => r.kos, 1));
    give('Goo Ghost', (pool) => maxBy(pool, (r) => r.puddleHits, 2));
    give('Pogo Stick', (pool) => maxBy(pool, (r) => r.jumps, 12));
    if (n >= 3) {
      give("Gravity's Favorite", (pool) => {
        let worst = null;
        for (const r of pool) if (!r.survived && (!worst || r._key < worst._key)) worst = r;
        return worst;
      });
    }
    give('Professional Bowling Pin', (pool) => maxBy(pool, (r) => r.hitsTaken, 3));
    give('Forgot Jumping Exists', (pool) => {
      const cand = pool.filter((r) => r.jumps === 0 && !r.survived);
      return cand.length ? cand[cand.length - 1] : null;
    });

    rows.forEach((r) => delete r._key);
    return rows;
  }

  results() {
    if (!this._results) this._results = this._computeResults();
    return this._results;
  }

  // ---- What the browsers need to draw the world --------------------------------
  snapshot() {
    // One character per tile: '0' solid, '1'-'9' cracking (progress), 'x' gone, '_' never existed.
    let tiles = '';
    for (let idx = 0; idx < this.kind.length; idx++) {
      const k = this.kind[idx];
      if (k === SOLID) tiles += '0';
      else if (k === CRACKING) {
        const prog = Math.min(1, this.crackT[idx] / this.crackDur[idx]);
        tiles += String(Math.max(1, Math.min(9, Math.ceil(prog * 9))));
      } else if (k === GONE) tiles += 'x';
      else tiles += '_';
    }

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
        fl: p.state === 'falling' ? r2(Math.min(1, p.fallT / TUNING.fallTime)) : 0,
        sh: p.shoveAnim > 0 ? r2(p.shoveAnim / 0.28) : 0,
        im: p.immune > 0 ? 1 : 0,
        sn: p.stun > 0 ? 1 : 0,
        sl: p.slow > 0 ? 1 : 0,
        cd: r2(p.shoveCd),
        pc: r2(p.puddleCd),
        am: p.puddleAmmo,
      });
    }

    const pd = this.puddles.map((q) => ({
      id: q.id,
      x: r1(q.x),
      y: r1(q.y),
      f: r2(Math.min(1, q.age / TUNING.puddleForm)),
      l: r2(Math.max(0, 1 - q.age / TUNING.puddleLife)),
    }));

    const events = this.events;
    this.events = [];

    return {
      t: r2(this.time),
      fin: this.finished,
      alive: this._aliveCount(),
      tiles,
      ps,
      pd,
      ev: events,
    };
  }
}

CrumbleFloor.TUNING = TUNING;
CrumbleFloor.VARIANTS = VARIANTS;
CrumbleFloor.TILE = TILE;
CrumbleFloor.COLS = COLS;
CrumbleFloor.ROWS = ROWS;
CrumbleFloor.CONSTANTS = { SOLID, CRACKING, GONE, VOID };

module.exports = CrumbleFloor;
