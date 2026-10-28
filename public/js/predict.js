// Movement prediction for YOUR OWN character (the "feels instant" trick).
//
// The server decides where everybody is, but your keys take a trip: browser -> server
// (half the ping), a server tick, then the new position comes back (the other half).
// Without help, your character would react about one ping late. So the browser keeps a log of
// your recent key presses and *replays* them on top of the last position the server sent,
// using the same steering rule the server uses (velocity eases toward your direction * top
// speed). The picture of your character is therefore where the server is about to put it.
//
// This is only a drawing guess. The server never trusts it: every snapshot brings the real
// position, the guess is recomputed from that, and any small difference fades out smoothly.
// Knockbacks, collisions with other players and stuns are not predicted (the server sends
// ms = 0 while your input does nothing, and then we just show the server's position).

export const PREDICT = {
  maxWindow: 0.4, // never look further ahead than this many seconds
  step: 1 / 60,
  airAccel: 2.4, // must match TUNING.airAccel on the server
  keepHistory: 1.5, // seconds of key presses remembered
  fade: 0.2, // how quickly a small correction melts away (fraction per frame)
  snapDist: 60, // a bigger difference than this jumps straight there
};

const TILE = 64;
const COLS = 14;
const ROWS = 9;
const SOLID = (() => {
  const a = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const nx = (c + 0.5 - COLS / 2) / (COLS / 2);
      const ny = (r + 0.5 - ROWS / 2) / (ROWS / 2);
      a.push(nx * nx + ny * ny <= 1.25);
    }
  }
  return a;
})();
function tileSolid(x, y) {
  const c = Math.floor(x / TILE);
  const r = Math.floor(y / TILE);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  return SOLID[r * COLS + c];
}
// Same rule as ArenaGame.walkable on the server (the open-arena minigames' floor).
export function arenaWalkable(x, y) {
  const m = 14;
  return tileSolid(x, y) && tileSolid(x - m, y) && tileSolid(x + m, y) && tileSolid(x, y - m) && tileSolid(x, y + m);
}

// The walkable rule for a given map (`rows` = the 9 strings the server sends in arena.floor,
// '#' = solid). With no rows it is the classic oval. The last answer is remembered.
let floorKey = '';
let floorFn = arenaWalkable;
export function walkableFor(rows) {
  if (!Array.isArray(rows) || rows.length !== ROWS) return arenaWalkable;
  const key = rows.join('|');
  if (key === floorKey) return floorFn;
  const solid = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) solid.push(String(rows[r])[c] === '#');
  const at = (x, y) => {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    return solid[r * COLS + c];
  };
  floorFn = (x, y) => {
    const m = 14;
    return at(x, y) && at(x - m, y) && at(x + m, y) && at(x, y - m) && at(x, y + m);
  };
  floorKey = key;
  return floorFn;
}

export class Predictor {
  constructor() {
    this.hist = []; // { t (ms), mx, my }
    this.prevOwn = null; // the previous snapshot of you (to keep the picture steady when a new one lands)
    this.prevRecv = 0;
    this.offX = 0; // how far the picture is from the fresh guess (melts away)
    this.offY = 0;
  }

  // Call whenever your controls are sent (and with the current time in milliseconds).
  record(tMs, mx, my) {
    const h = this.hist;
    const last = h[h.length - 1];
    if (last && last.mx === mx && last.my === my) return;
    h.push({ t: tMs, mx, my });
    // forget old key presses, but keep one older entry so we know what was held before
    const cutoff = tMs - PREDICT.keepHistory * 1000;
    while (h.length > 2 && h[1].t < cutoff) h.shift();
  }

  clear() {
    this.hist.length = 0;
    this.prevOwn = null;
    this.offX = this.offY = 0;
  }

  inputAt(tMs) {
    const h = this.hist;
    let cur = { mx: 0, my: 0 };
    for (let i = 0; i < h.length; i++) {
      if (h[i].t <= tMs) cur = h[i];
      else break;
    }
    return cur;
  }

  // The replay itself: where would this snapshot's player be (as of ctx.now) given the key presses so far?
  _replay(own, recvAt, ctx) {
    const rtt = Math.min(PREDICT.maxWindow * 1000 - 50, Math.max(0, ctx.rtt || 0));
    const age = Math.max(0, ctx.now - recvAt);
    const total = Math.min(PREDICT.maxWindow, (age + rtt) / 1000);
    // the input the server had when it made this snapshot is the one held `rtt` before it arrived
    const inputStart = recvAt - rtt;
    const accel = own.z > 0.5 ? PREDICT.airAccel : own.ma || 14;
    let x = own.x;
    let y = own.y;
    let vx = own.vx;
    let vy = own.vy;
    const walk = ctx.walkable;
    let faceX = own.fx;
    let faceY = own.fy;
    for (let t = 0; t < total - 1e-9; ) {
      const dt = Math.min(PREDICT.step, total - t);
      const inp = this.inputAt(inputStart + (t + dt / 2) * 1000);
      const len = Math.hypot(inp.mx, inp.my);
      const nx = len > 1 ? inp.mx / len : inp.mx;
      const ny = len > 1 ? inp.my / len : inp.my;
      if (len > 0.1) {
        faceX = inp.mx / len;
        faceY = inp.my / len;
      }
      const k = Math.min(1, accel * dt);
      vx += (nx * own.ms - vx) * k;
      vy += (ny * own.ms - vy) * k;
      const dx = vx * dt;
      const dy = vy * dt;
      if (!walk || walk(x + dx, y)) x += dx;
      else vx = 0;
      if (!walk || walk(x, y + dy)) y += dy;
      else vy = 0;
      t += dt;
    }
    return { x, y, fx: faceX, fy: faceY };
  }

  // own: this player's entry in the newest snapshot (needs x, y, vx, vy, z, ms, ma)
  // ctx: { now, recvAt (when that snapshot arrived), rtt (ms), walkable (function or null) }
  // Returns the point to draw, or null when there is nothing sensible to predict.
  predict(own, ctx) {
    if (!own || !(own.ms > 0)) {
      this.prevOwn = null;
      this.offX = this.offY = 0;
      return null;
    }
    const cur = this._replay(own, ctx.recvAt, ctx);
    // A new snapshot arrived: the guess may now differ a little from the old guess. Keep what is on
    // screen exactly where it was and let the difference melt away over the next few frames.
    if (this.prevOwn && ctx.recvAt !== this.prevRecv) {
      const old = this._replay(this.prevOwn, this.prevRecv, ctx);
      this.offX = old.x + this.offX - cur.x;
      this.offY = old.y + this.offY - cur.y;
      if (Math.hypot(this.offX, this.offY) > PREDICT.snapDist) this.offX = this.offY = 0;
    }
    this.prevOwn = own;
    this.prevRecv = ctx.recvAt;
    const out = { x: cur.x + this.offX, y: cur.y + this.offY, fx: cur.fx, fy: cur.fy };
    this.offX *= 1 - PREDICT.fade;
    this.offY *= 1 - PREDICT.fade;
    return out;
  }
}
