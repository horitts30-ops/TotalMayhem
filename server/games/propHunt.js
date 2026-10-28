'use strict';

// ===========================================================================
// PROP HUNT  -  minigame #5 (category: Hide & Seek)
//
// One player is the SEEKER. Everybody else is a HIDER who can turn into a prop
// (a crate, a barrel, a plant...) and sit very still among lots of real props.
//
//   * The seeker is blindfolded for the first seconds while the hiders hide.
//   * The seeker SMACKS what they think is a hider. Smack a real hider and they
//     are found. Smack a plain old prop and the seeker gets dizzy for a moment,
//     so nobody can win by smacking everything.
//   * Found hiders are NOT out: they become helper seekers and keep playing.
//   * Hiders earn points for every second they stay hidden. Seekers earn points
//     for every hider they find.
//
// IMPORTANT (this is why the game is "server-authoritative"): the seeker's
// browser is never even TOLD which props are secretly players. Every player
// gets their own snapshot (see `perViewer`), and in it a disguised hider is
// just one more prop in the list - same as the real ones. Nothing to peek at.
// ===========================================================================

const ArenaGame = require('./arenaBase');

const { TUNING: BASE, r1, r2 } = ArenaGame;

const TUNING = {
  maxTime: 70,
  hideTime: 10, // seconds the seeker is blindfolded (counted from GO)
  decoys: 16, // ordinary props lying around
  propTypes: 6, // crate, barrel, plant, rock, gift, cactus (client draws them)
  propRadius: 24,
  smackRange: 110, // bigger reach, like the shove in the other games (was 78)
  smackCone: 0.2,
  smackCooldown: 0.9,
  bonkStun: 1.0, // dizzy time for smacking a plain prop
  foundStun: 1.2, // a found hider is dazed for a moment, then joins the hunt
  toggleCooldown: 0.7, // disguise on/off
  hiderSpeed: 1.08, // hiders are slightly faster, seekers have the advantage of being many
  seekerBase: 25, // the seeker is never left with nothing
  seekerPerFind: 10,
  helperPerFind: 6,
  survivorBonus: 10, // never found
  minGap: 70, // props keep a little distance from each other
};

const VARIANTS = {
  classic: {
    name: 'Prop Hunt',
    tagline: 'Be a barrel. Be a plant. Be very, very still.',
    theme: 'jungle',
  },
  crowded: {
    name: 'Prop Hunt: Crowded Closet',
    tagline: 'So many props. So many suspicious crates.',
    theme: 'candy',
    decoys: 26,
    hideTime: 8,
  },
};

const INSTRUCTIONS = [
  'Hiders: press E to turn into a prop, then stay still. Press SPACE (while disguised) to change into another prop.',
  'The seeker is blindfolded at the start. Seeker: press E to SMACK what you think is a hider.',
  'Smack a plain prop and the seeker gets dizzy, so choose wisely!',
  'Found? You are not out! You become a helper seeker. Hiders score for every second hidden.',
];

const CONTROLS = [
  { label: 'Move', keys: 'WASD / Arrow keys' },
  { label: 'Hider: disguise / undisguise', keys: 'E or Shift' },
  { label: 'Seeker: smack', keys: 'E or Shift' },
  { label: 'Swap prop', keys: 'Space (while disguised)' },
];

// Rage Bait mode: the same game, tuned to be much harder (see server/rage.js).
const RAGE = { hideTime: 6, hiderSpeed: 1.0, bonkStun: 0.6, foundStun: 0.5, smackCooldown: 0.55, decoys: 8 };

class PropHunt extends ArenaGame {
  constructor(participants, variantId = 'classic', options = {}) {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    super(participants, VARIANTS[id], options, { maxTime: TUNING.maxTime });
    this.variantId = id;
    this.cfg = { ...TUNING, ...VARIANTS[id] };
    if (this.rage) Object.assign(this.cfg, RAGE);
    this.perViewer = true; // every player gets their own snapshot (the secret-keeping part)

    const ids = [...this.players.keys()];
    const seekerCount = ids.length < 2 ? 0 : ids.length >= 7 ? 2 : 1;
    const seekers = new Set();
    const pool = ids.slice();
    while (seekers.size < seekerCount && pool.length) {
      seekers.add(pool.splice(Math.floor(this.rng() * pool.length), 1)[0]);
    }
    for (const p of this.players.values()) {
      const seeker = seekers.has(p.id);
      p.role = seeker ? 'seeker' : 'hider';
      p.origSeeker = seeker;
      p.helper = false;
      p.found = false;
      p.foundAt = 0;
      p.disguised = false;
      p.prop = 0;
      p.survive = 0;
      p.finds = 0;
      p.bonks = 0;
      p.swaps = 0;
      p.speedMul = seeker ? 1 : this.cfg.hiderSpeed;
    }
    this.seekStarted = false;
    this.decoys = this._placeDecoys();
  }

  // ---- info for the intro card + client --------------------------------------
  static describe(variantId = 'classic') {
    const id = VARIANTS[variantId] ? variantId : 'classic';
    const v = VARIANTS[id];
    return {
      gameId: 'propHunt',
      variantId: id,
      name: v.name,
      tagline: v.tagline,
      theme: v.theme,
      instructions: INSTRUCTIONS,
      controls: CONTROLS,
      category: 'Hide & Seek',
    };
  }

  static get arena() {
    // Both of the E-key jobs recharge within a second, so one meter fits both.
    return ArenaGame.baseArena(TUNING.maxTime, {
      scoreLabel: 'points',
      scoreDir: 'high',
      shoveCooldown: 1,
      jumpLabel: 'Jump',
      shoveLabel: 'Disguise / Smack',
    });
  }

  // ---- props lying around -----------------------------------------------------
  _placeDecoys() {
    const list = [];
    const spawns = [...this.players.values()].map((p) => ({ x: p.x, y: p.y }));
    let tries = 0;
    while (list.length < this.cfg.decoys && tries++ < 800) {
      const pt = this._randomPoint(46);
      if (list.some((d) => Math.hypot(d.x - pt.x, d.y - pt.y) < this.cfg.minGap * 0.7)) continue;
      if (spawns.some((s) => Math.hypot(s.x - pt.x, s.y - pt.y) < 50)) continue;
      list.push({ id: list.length + 1, x: pt.x, y: pt.y, type: Math.floor(this.rng() * this.cfg.propTypes) });
    }
    return list;
  }

  // ---- hooks ---------------------------------------------------------------------
  _hidePhase() {
    return this.time < this.cfg.hideTime;
  }

  _hidersLeft() {
    return [...this.players.values()].filter((p) => p.state === 'alive' && p.role === 'hider').length;
  }

  _seekersNow() {
    return [...this.players.values()].filter((p) => p.state === 'alive' && p.role === 'seeker').length;
  }

  _canMove(p) {
    if (p.disguised) return false;
    if (p.role === 'seeker' && this._hidePhase()) return false; // counting with eyes closed
    return true;
  }

  _canJump(p) {
    if (p.disguised) return false;
    if (p.role === 'seeker' && this._hidePhase()) return false;
    return true;
  }

  // Stamina: only a real smack costs energy (turning into a prop, or a blindfolded
  // seeker pressing E, is free).
  _shoveCost(p) {
    if (p.role === 'hider') return 0;
    if (this._hidePhase()) return 0;
    return super._shoveCost(p);
  }

  _solid(p) {
    return !p.disguised; // props do not get pushed around by people walking past
  }

  _stepPlayer(p, dt, live) {
    // While disguised, SPACE means "change into a different prop".
    if (live && p.disguised && p.jumpBuf > 0 && p.state === 'alive') {
      p.jumpBuf = 0;
      p.prop = (p.prop + 1) % this.cfg.propTypes;
      p.swaps++;
      this.events.push({ k: 'swap', id: p.id, x: r1(p.x), y: r1(p.y) });
    }
    super._stepPlayer(p, dt, live);
    if (p.disguised) {
      p.vx = 0;
      p.vy = 0;
      p.kx = 0;
      p.ky = 0;
    }
  }

  // The E key: hiders turn into / out of a prop, seekers smack.
  _doShove(p) {
    if (p.role === 'hider') {
      this._toggleDisguise(p);
      return;
    }
    if (this._hidePhase()) return; // still blindfolded: nothing happens, no cooldown wasted
    this._smack(p);
  }

  _toggleDisguise(p) {
    if (p.z > 6 || p.stun > 0) return;
    p.shoveCd = this.cfg.toggleCooldown;
    if (p.disguised) {
      p.disguised = false;
      this.events.push({ k: 'undisguise', id: p.id, x: r1(p.x), y: r1(p.y) });
      return;
    }
    // Start as whatever prop is closest, so you blend in right away (SPACE changes it).
    let best = null;
    let bestD = 220;
    for (const d of this.decoys) {
      const dist = Math.hypot(d.x - p.x, d.y - p.y);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    p.prop = best ? best.type : Math.floor(this.rng() * this.cfg.propTypes);
    p.disguised = true;
    p.vx = 0;
    p.vy = 0;
    p.kx = 0;
    p.ky = 0;
    this.events.push({ k: 'disguise', id: p.id, x: r1(p.x), y: r1(p.y) });
  }

  _smack(p) {
    p.shoveCd = this.cfg.smackCooldown * p.mods.shoveCd; // (Quick Hands and Long Arms help the seeker too)
    p.shoveAnim = 0.28;
    p.shoves++;
    let target = null;
    let targetD = this.cfg.smackRange * p.mods.range;
    const consider = (kind, ref, x, y) => {
      const dx = x - p.x;
      const dy = y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > targetD) return;
      if (d > 1 && (dx * p.fx + dy * p.fy) / d < this.cfg.smackCone) return;
      target = { kind, ref, x, y };
      targetD = d;
    };
    for (const q of this.players.values()) {
      if (q.state !== 'alive' || q.role !== 'hider') continue;
      if (q.z > BASE.dodgeHeight) continue; // a hider mid-jump dodges it
      consider('hider', q, q.x, q.y);
    }
    for (const d of this.decoys) consider('decoy', d, d.x, d.y);

    let hit = 0;
    if (target && target.kind === 'hider') {
      this._found(p, target.ref);
      hit = 1;
    } else if (target) {
      p.stun = this.cfg.bonkStun;
      p.bonks++;
      this.events.push({ k: 'bonk', id: p.id, x: r1(target.x), y: r1(target.y), pid: target.ref.id });
    }
    this.events.push({ k: 'shove', id: p.id, x: r1(p.x), y: r1(p.y), fx: r2(p.fx), fy: r2(p.fy), hits: hit });
  }

  _found(seeker, hider) {
    hider.found = true;
    hider.foundAt = this.time;
    hider.disguised = false;
    hider.role = 'seeker';
    hider.helper = true;
    hider.speedMul = 1;
    hider.stun = this.cfg.foundStun;
    seeker.finds++;
    this.events.push({
      k: 'found',
      id: hider.id,
      by: seeker.id,
      x: r1(hider.x),
      y: r1(hider.y),
      left: this._hidersLeft(),
    });
  }

  _update(dt) {
    if (!this.seekStarted && !this._hidePhase()) {
      this.seekStarted = true;
      this.events.push({ k: 'seekStart' });
    }
    if (!this._hidePhase()) {
      for (const p of this.players.values()) {
        if (p.state === 'alive' && p.role === 'hider') p.survive += dt;
      }
    }
    // Everybody found? (Only meaningful when there was a seeker to begin with.)
    if (this.participantCount >= 2 && this._hidersLeft() === 0 && !this.finished) {
      this.events.push({ k: 'sweep' });
      this._finish();
    }
  }

  _onRemove(p) {
    p.disguised = false;
    // If the last seeker walks away, somebody has to take over.
    if (p.role === 'seeker' && this._seekersNow() === 0) {
      const hiders = [...this.players.values()].filter((q) => q.state === 'alive' && q.role === 'hider');
      if (hiders.length > 0) {
        const q = hiders[Math.floor(this.rng() * hiders.length)];
        q.role = 'seeker';
        q.helper = true;
        q.disguised = false;
        q.speedMul = 1;
        this.events.push({ k: 'newSeeker', id: q.id });
      }
    }
  }

  // ---- scoring -------------------------------------------------------------------
  _score(p) {
    if (p.origSeeker) return this.cfg.seekerBase + this.cfg.seekerPerFind * p.finds;
    let s = p.survive + this.cfg.helperPerFind * p.finds;
    if (!p.found && this.finished && this.participantCount >= 2 && p.state === 'alive') s += this.cfg.survivorBonus;
    return s;
  }

  _scoreOf(p) {
    return Math.floor(this._score(p));
  }

  _rankKey(p) {
    return Math.floor(this._score(p));
  }

  _detail(p) {
    if (p.origSeeker) return p.finds === 1 ? 'seeker, found 1' : `seeker, found ${p.finds}`;
    if (!p.found) return this.participantCount >= 2 ? 'never found!' : `hid ${Math.floor(p.survive)}s`;
    return `hid ${Math.floor(p.survive)}s, found ${p.finds}`;
  }

  _titles(rows, byId) {
    const P = (r) => byId.get(r.id);
    this._give(rows, 'Master of Disguise', (pool) =>
      this._maxBy(pool, (r) => (P(r).origSeeker || P(r).found ? 0 : 1000 + P(r).survive), 1000)
    );
    this._give(rows, 'Eagle Eyes', (pool) => this._maxBy(pool, (r) => P(r).finds, 2));
    this._give(rows, 'Prop Whisperer', (pool) => this._maxBy(pool, (r) => P(r).survive, 40));
    this._give(rows, 'Shapeshifter', (pool) => this._maxBy(pool, (r) => P(r).swaps, 5));
    this._give(rows, 'Crate Smacker', (pool) => this._maxBy(pool, (r) => P(r).bonks, 2));
  }

  _hud() {
    if (this.time < 0) return '';
    if (this._hidePhase()) return `Hide! Seeker starts in ${Math.max(1, Math.ceil(this.cfg.hideTime - this.time))}s`;
    if (this.participantCount < 2) return 'Practice: try the disguises!';
    return `${this._hidersLeft()} hiding`;
  }

  // ---- what each player is allowed to see ------------------------------------
  _viewer(viewerId) {
    return viewerId ? this.players.get(viewerId) || null : null;
  }

  _isBlind(viewerId) {
    if (!this._hidePhase() || this.time < 0) return false;
    const v = this._viewer(viewerId);
    return !(v && v.state === 'alive' && v.role === 'hider');
  }

  _visible(viewerId, p) {
    if (p.id === viewerId) return true;
    if (p.state === 'left') return true;
    if (p.disguised) return false; // a prop is not a person
    if (p.role === 'hider' && this._isBlind(viewerId)) return false; // eyes closed
    return true;
  }

  _eventFor(ev, viewerId) {
    switch (ev.k) {
      case 'disguise':
      case 'undisguise':
      case 'swap': {
        if (ev.id === viewerId) return ev;
        if (this._isBlind(viewerId)) return null;
        return { k: ev.k, x: ev.x, y: ev.y }; // you may see the poof, but not WHO it was
      }
      case 'bonk':
        return { k: ev.k, id: ev.id, x: ev.x, y: ev.y }; // (no hint about which prop it was)
      default:
        return ev;
    }
  }

  _playerSnapshot(p, viewerId) {
    const out = { rl: p.role === 'seeker' ? 1 : 0 };
    if (p.helper) out.hp = 1;
    if (p.disguised && p.id === viewerId) {
      out.dg = 1;
      out.pt = p.prop;
    }
    return out;
  }

  _extraSnapshot(viewerId) {
    const blind = this._isBlind(viewerId);
    let props = [];
    if (!blind && this.time >= 0) {
      for (const d of this.decoys) props.push([r1(d.x), r1(d.y), d.type]);
      for (const p of this.players.values()) {
        if (p.disguised && p.state === 'alive') props.push([r1(p.x), r1(p.y), p.prop]);
      }
      // Sorted by position only, so the order gives nothing away.
      props.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    }
    const v = this._viewer(viewerId);
    const seeker = !!(v && v.role === 'seeker');
    const sc = {};
    for (const p of this.players.values()) sc[p.id] = this._scoreOf(p);
    return {
      props,
      sc, // everybody's round score (hidden players are not in `ps`, but the scoreboard still needs them)
      hl: this._hidePhase() && this.time >= 0 ? Math.max(1, Math.ceil(this.cfg.hideTime - this.time)) : 0,
      blind: blind ? 1 : 0,
      bt: blind ? Math.max(1, Math.ceil(this.cfg.hideTime - this.time)) : 0,
      lb: seeker ? ['Jump', 'Smack'] : v && v.disguised ? ['Swap prop', 'Undisguise'] : ['Jump', 'Disguise'],
    };
  }
}

PropHunt.GAME_ID = 'propHunt';
PropHunt.TUNING = TUNING;
PropHunt.RAGE = RAGE;
PropHunt.VARIANTS = VARIANTS;

module.exports = PropHunt;
