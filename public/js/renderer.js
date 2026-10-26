// ---------------------------------------------------------------------------
// The renderer draws everything with plain Canvas 2D code - no image files.
// That means every character, hat, tile and effect can be restyled by editing
// this file, and later swapped for real artwork if you want.
//
// This file only DRAWS. It never talks to the network and never decides who
// won anything; it just shows what the server says.
// ---------------------------------------------------------------------------

import { STAGE_W, STAGE_H, OX, OY, COLORS, THEMES, INK } from './constants.js';

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const TILE = 64;

// ------------------------------------------------------------------ helpers
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// How far each hat sticks up above the head (used to place name tags).
// Order matches HATS in constants.js.
const HAT_HEIGHT = [0, 40, 22, 30, 30, 38, 34];

// ------------------------------------------------------------------ hats
function drawHat(ctx, hat, t) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  switch (hat) {
    case 1: {
      // party hat
      ctx.save();
      ctx.rotate(0.22);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(13, 0);
      ctx.lineTo(0, -32);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-9, -8);
      ctx.lineTo(9, -8);
      ctx.moveTo(-5, -19);
      ctx.lineTo(5, -19);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, -33, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 2: {
      // crown
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(-15, 2);
      ctx.lineTo(-16, -16);
      ctx.lineTo(-7, -8);
      ctx.lineTo(0, -20);
      ctx.lineTo(7, -8);
      ctx.lineTo(16, -16);
      ctx.lineTo(15, 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath();
      ctx.arc(0, -5, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4cc9f0';
      ctx.beginPath();
      ctx.arc(-9, -3, 2.4, 0, Math.PI * 2);
      ctx.arc(9, -3, 2.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 3: {
      // propeller cap
      ctx.fillStyle = '#3a86ff';
      ctx.beginPath();
      ctx.ellipse(0, 0, 17, 12, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffca3a';
      ctx.beginPath();
      ctx.arc(0, -12, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(0, -15);
      const spin = Math.cos(t * 18);
      ctx.scale(spin, 1);
      ctx.fillStyle = '#ff595e';
      ctx.beginPath();
      ctx.ellipse(0, 0, 19, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 4: {
      // traffic cone
      ctx.fillStyle = '#ff7b00';
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(12, 0);
      ctx.lineTo(5, -28);
      ctx.lineTo(-5, -28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(-8.5, -10);
      ctx.lineTo(8.5, -10);
      ctx.lineTo(6.5, -18);
      ctx.lineTo(-6.5, -18);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff7b00';
      rr(ctx, -15, -1, 30, 6, 3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 5: {
      // chef hat: stroke the whole silhouette first, then fill over it, so the
      // overlapping puffs merge into ONE clean outline.
      const silhouette = () => {
        ctx.beginPath();
        ctx.moveTo(-9 + 9, -17);
        ctx.arc(-9, -17, 9, 0, Math.PI * 2);
        ctx.moveTo(9 + 9, -17);
        ctx.arc(9, -17, 9, 0, Math.PI * 2);
        ctx.moveTo(11, -25);
        ctx.arc(0, -25, 11, 0, Math.PI * 2);
        ctx.rect(-13, -13, 26, 14);
      };
      ctx.lineWidth = 7;
      silhouette();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      silhouette();
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-13, -6);
      ctx.lineTo(13, -6);
      ctx.stroke();
      break;
    }
    case 6: {
      // bunny ears
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(s * 9, -14);
        ctx.rotate(s * 0.18);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(0, 0, 6.5, 17, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffb3d1';
        ctx.beginPath();
        ctx.ellipse(0, 1, 3, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------------ characters
// All characters are drawn with their FEET at (x, y), so squashing and
// stretching keeps them standing on the ground.
export function drawBlob(ctx, o) {
  const {
    x, y, color, hat = 0, fx = 0, fy = 1, sx = 1, sy = 1, walk = 0, alpha = 1, rot = 0, mood = 'normal', t = 0,
  } = o;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sx, sy);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';

  const edge = mix(color, '#000000', 0.28);
  const belly = mix(color, '#ffffff', 0.5);

  // feet
  const lift = Math.sin(walk) * 5;
  ctx.fillStyle = edge;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(-10, -4 - Math.max(0, lift), 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(10, -4 - Math.max(0, -lift), 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // body
  ctx.fillStyle = color;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.ellipse(0, -26, 21, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // belly + shine
  ctx.save();
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(0, -16, 13, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(-10, -43, 4.5, 7.5, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // eyes
  const px = clamp(fx, -1, 1) * 3;
  const py = clamp(fy, -1, 1) * 2.5;
  for (const s of [-1, 1]) {
    const ex = s * 8;
    const ey = -33;
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(ex, ey, 7, mood === 'scared' ? 10 : 8.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    if (mood === 'dizzy') {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(ex - 3.5, ey - 3.5);
      ctx.lineTo(ex + 3.5, ey + 3.5);
      ctx.moveTo(ex + 3.5, ey - 3.5);
      ctx.lineTo(ex - 3.5, ey + 3.5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(ex + px, ey + py, mood === 'scared' ? 2.2 : 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // mouth
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  if (mood === 'scared') {
    ctx.beginPath();
    ctx.ellipse(0, -17, 4.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (mood === 'happy') {
    ctx.beginPath();
    ctx.arc(0, -21, 8, 0.05 * Math.PI, 0.95 * Math.PI);
    ctx.closePath();
    ctx.fillStyle = '#7a1f3d';
    ctx.fill();
    ctx.stroke();
  } else if (mood === 'dizzy') {
    ctx.beginPath();
    ctx.moveTo(-6, -17);
    ctx.quadraticCurveTo(0, -22, 6, -17);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, -22, 5.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  // hat
  ctx.save();
  ctx.translate(0, -48);
  drawHat(ctx, hat, t);
  ctx.restore();

  ctx.restore();
}

function drawGhost(ctx, o) {
  const { x, y, color, fx = 0, fy = 1, alpha = 0.85, t = 0 } = o;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  const w = 21;
  const cy = -34;
  const bottom = -6;
  const wob = Math.sin(t * 6) * 3;

  ctx.beginPath();
  ctx.moveTo(-w, cy);
  ctx.arc(0, cy, w, Math.PI, 0);
  ctx.lineTo(w, bottom);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x0 = w - (i * 2 * w) / n;
    const x1 = x0 - (2 * w) / n;
    const dip = (i % 2 === 0 ? 11 : -3) + (i % 2 === 0 ? wob : -wob);
    ctx.quadraticCurveTo((x0 + x1) / 2, bottom + dip, x1, bottom);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.fill();
  ctx.strokeStyle = mix(color, INK, 0.35);
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // coloured cheeks so you can tell whose ghost it is
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha * 0.7;
  ctx.beginPath();
  ctx.ellipse(-13, cy + 8, 5, 3.5, 0, 0, Math.PI * 2);
  ctx.ellipse(13, cy + 8, 5, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alpha;

  // face
  ctx.fillStyle = INK;
  const px = clamp(fx, -1, 1) * 2;
  const py = clamp(fy, -1, 1) * 2;
  ctx.beginPath();
  ctx.ellipse(-7 + px, cy - 2 + py, 3.2, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(7 + px, cy - 2 + py, 3.2, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px, cy + 10 + py, 3.2, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawNameTag(ctx, text, x, y, color, isMe) {
  ctx.save();
  ctx.font = `bold 15px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = isMe ? '#fff27a' : '#ffffff';
  ctx.fillText(text, x, y);
  ctx.restore();
  void color;
}

// ------------------------------------------------------------------ renderer
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.px = 1;
    this.clock = 0;
    this.shakeAmt = 0;
    this.particles = [];
    this.texts = [];
    this.fallingTiles = [];
    this.prevTiles = null;
    this.pstate = new Map();
    this.confettiTimer = 0;
    const rnd = mulberry32(7);
    this.clouds = Array.from({ length: 9 }, () => ({
      y: rnd() * STAGE_H,
      x: rnd() * (STAGE_W + 400),
      s: 0.7 + rnd() * 1.1,
      v: 6 + rnd() * 14,
    }));
    this.stars = Array.from({ length: 28 }, () => ({ x: rnd() * STAGE_W, y: rnd() * STAGE_H, p: rnd() * 6 }));
    this.resize(1);
  }

  // cssScale = how much the stage is scaled on screen (for crisp rendering)
  resize(cssScale) {
    const dpr = window.devicePixelRatio || 1;
    this.px = clamp(cssScale * dpr, 0.5, 2.5);
    this.canvas.width = Math.round(STAGE_W * this.px);
    this.canvas.height = Math.round(STAGE_H * this.px);
  }

  reset() {
    this.particles = [];
    this.texts = [];
    this.fallingTiles = [];
    this.prevTiles = null;
    this.pstate.clear();
    this.shakeAmt = 0;
    this.confettiTimer = 0;
  }

  // ---- effect API (called by main.js when the server reports events) --------
  addShake(a) {
    this.shakeAmt = Math.max(this.shakeAmt, a);
  }

  state(id) {
    let s = this.pstate.get(id);
    if (!s) {
      s = { walk: 0, squash: 0, stretch: 0, lastX: null, lastY: null, bubbleT: 0, bubble: '', moving: 0 };
      this.pstate.set(id, s);
    }
    return s;
  }

  markJump(id) {
    this.state(id).stretch = 0.2;
  }
  markLand(id) {
    this.state(id).squash = 0.22;
  }
  markOut(id) {
    const s = this.state(id);
    const words = ['AAAAH!', 'NOOO!', 'WHEEE!', 'OOPS!', 'BYE!', 'HELP!', 'WAIT-', 'MOM!'];
    s.bubble = words[hashString(id + Math.floor(this.clock)) % words.length];
    s.bubbleT = 0.9;
  }

  dust(x, y, color = '#ffffff', n = 7) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 70;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 10, g: 0, life: 0.4, max: 0.4,
        size: 3 + Math.random() * 3.5, color, shape: 'circle', rot: 0, vr: 0,
      });
    }
  }

  burst(x, y, colors, n = 14, speed = 220, shape = 'star', life = 0.7) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, g: 400, life, max: life,
        size: 5 + Math.random() * 5, color: colors[i % colors.length], shape, rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  confetti() {
    this.confettiTimer = 2.2;
  }

  floatText(x, y, text, color = '#fff', size = 26) {
    this.texts.push({ x, y, text, color, size, life: 0.9, max: 0.9 });
  }

  // ---- drawing ---------------------------------------------------------------
  /**
   * frame = {
   *   theme: 'sunny' | 'pink' | 'icy',
   *   time: game time (seconds, negative during countdown),
   *   tiles: string,
   *   players: [{id,x,y,z,vx,vy,fx,fy,st,fl,sh,im,sn,sl,...}],
   *   puddles: [{x,y,f,l}],
   *   meta: Map(id -> {name,color,hat}),
   *   myId: string,
   *   cols, rows,
   *   finished: bool,
   * }
   */
  // Just the background (used before the first snapshot of a round arrives).
  idle(themeKey, dt) {
    this.clock += dt;
    this.ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
    this.drawBackground(this.ctx, THEMES[themeKey] || THEMES.sunny);
  }

  draw(frame, dt) {
    const ctx = this.ctx;
    this.clock += dt;
    this.cols = frame.cols;
    ctx.setTransform(this.px, 0, 0, this.px, 0, 0);
    const theme = THEMES[frame.theme] || THEMES.sunny;

    this.drawBackground(ctx, theme);

    // screen shake
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 22);
    ctx.save();
    if (this.shakeAmt > 0.2) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt);
    }

    this.trackTiles(frame);
    this.drawTiles(ctx, frame, theme);
    this.drawFallingTiles(ctx, dt, theme);
    this.drawPuddles(ctx, frame);
    this.drawEntities(ctx, frame, dt);
    this.drawParticles(ctx, dt);

    ctx.restore();

    if (this.confettiTimer > 0) {
      this.confettiTimer -= dt;
      for (let i = 0; i < 3; i++) {
        this.particles.push({
          x: OX + Math.random() * 896, y: OY - 20, vx: (Math.random() - 0.5) * 120, vy: 60 + Math.random() * 120,
          g: 120, life: 2.2, max: 2.2, size: 6 + Math.random() * 6,
          color: ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#ff6fb5', '#9b5de5'][Math.floor(Math.random() * 6)],
          shape: 'square', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
        });
      }
    }
  }

  drawBackground(ctx, theme) {
    const g = ctx.createLinearGradient(0, 0, 0, STAGE_H);
    g.addColorStop(0, theme.bg[0]);
    g.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);

    // slowly turning dashed rings (the "abyss")
    ctx.save();
    ctx.translate(OX + 448, OY + 288);
    ctx.strokeStyle = theme.ring;
    ctx.lineWidth = 6;
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate(this.clock * (i % 2 ? 0.08 : -0.06));
      ctx.setLineDash([22, 26]);
      ctx.beginPath();
      ctx.ellipse(0, 0, 340 + i * 110, 230 + i * 80, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // drifting clouds
    ctx.fillStyle = theme.cloud;
    for (const c of this.clouds) {
      const x = ((c.x + this.clock * c.v) % (STAGE_W + 400)) - 200;
      ctx.beginPath();
      ctx.arc(x, c.y, 34 * c.s, 0, Math.PI * 2);
      ctx.arc(x + 36 * c.s, c.y + 8 * c.s, 28 * c.s, 0, Math.PI * 2);
      ctx.arc(x - 34 * c.s, c.y + 10 * c.s, 26 * c.s, 0, Math.PI * 2);
      ctx.fill();
    }

    // twinkles
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const s of this.stars) {
      const a = 0.5 + 0.5 * Math.sin(this.clock * 2 + s.p);
      ctx.globalAlpha = a * 0.6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  trackTiles(frame) {
    const cur = frame.tiles;
    if (this.prevTiles && this.prevTiles.length === cur.length) {
      for (let i = 0; i < cur.length; i++) {
        if (cur[i] === 'x' && this.prevTiles[i] !== 'x' && this.prevTiles[i] !== '_') {
          this.fallingTiles.push({
            idx: i, age: 0, rot: (Math.random() - 0.5) * 2.4, drift: (Math.random() - 0.5) * 50,
          });
          const c = i % frame.cols;
          const r = Math.floor(i / frame.cols);
          this.dust(OX + c * TILE + 32, OY + r * TILE + 32, '#ffffff', 5);
        }
      }
    }
    this.prevTiles = cur;
  }

  tileColors(theme, c, r) {
    return (c + r) % 2 === 0 ? theme.tileA : theme.tileB;
  }

  drawTiles(ctx, frame, theme) {
    const { tiles, cols } = frame;
    // 1) pits first (so holes read as holes)
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== 'x') continue;
      const c = i % cols;
      const r = Math.floor(i / cols);
      ctx.fillStyle = 'rgba(15,5,40,0.38)';
      rr(ctx, OX + c * TILE + 3, OY + r * TILE + 3, TILE - 6, TILE - 6, 10);
      ctx.fill();
    }
    // 2) standing tiles
    for (let i = 0; i < tiles.length; i++) {
      const ch = tiles[i];
      if (ch === 'x' || ch === '_') continue;
      const c = i % cols;
      const r = Math.floor(i / cols);
      const prog = ch === '0' ? 0 : Number(ch) / 9;
      this.drawTile(ctx, OX + c * TILE, OY + r * TILE, this.tileColors(theme, c, r), theme, prog, i);
    }
  }

  drawTile(ctx, x, y, color, theme, prog, idx, scale = 1) {
    let sx = 0;
    let sy = 0;
    if (prog > 0) {
      const amp = 0.8 + prog * 2.6;
      sx = Math.sin(this.clock * 55 + idx) * amp;
      sy = Math.cos(this.clock * 47 + idx * 2) * amp;
    }
    const face = prog > 0 ? mix(color, '#ff5a4d', prog * 0.55) : color;
    const side = prog > 0 ? mix(theme.side, '#8a1f1f', prog * 0.5) : theme.side;
    const thick = 10;
    ctx.save();
    if (scale !== 1) {
      ctx.translate(x + TILE / 2, y + TILE / 2);
      ctx.scale(scale, scale);
      ctx.translate(-(x + TILE / 2), -(y + TILE / 2));
    }
    ctx.lineJoin = 'round';
    // thickness
    ctx.fillStyle = side;
    rr(ctx, x + 2 + sx, y + 2 + thick + sy, TILE - 4, TILE - 4, 10);
    ctx.fill();
    // top face
    ctx.fillStyle = face;
    rr(ctx, x + 2 + sx, y + 2 + sy, TILE - 4, TILE - 4, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(42,26,60,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // shine
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    rr(ctx, x + 8 + sx, y + 7 + sy, TILE - 24, 7, 3.5);
    ctx.fill();

    // cracks grow with progress
    if (prog > 0) {
      const rnd = mulberry32(idx * 977 + 13);
      ctx.strokeStyle = theme.crack;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      const n = 1 + Math.floor(prog * 4);
      for (let k = 0; k < n; k++) {
        let cx = x + 10 + rnd() * (TILE - 20);
        let cy = y + 8 + rnd() * 10;
        ctx.beginPath();
        ctx.moveTo(cx + sx, cy + sy);
        const segs = 3 + Math.floor(prog * 3);
        for (let s = 0; s < segs; s++) {
          cx += (rnd() - 0.5) * 20;
          cy += (TILE - 20) / segs;
          ctx.lineTo(clamp(cx, x + 6, x + TILE - 6) + sx, clamp(cy, y + 6, y + TILE - 8) + sy);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawFallingTiles(ctx, dt, theme) {
    const frameCols = this.cols || 14;
    for (let i = this.fallingTiles.length - 1; i >= 0; i--) {
      const f = this.fallingTiles[i];
      f.age += dt;
      const p = f.age / 0.8;
      if (p >= 1) {
        this.fallingTiles.splice(i, 1);
        continue;
      }
      const c = f.idx % frameCols;
      const r = Math.floor(f.idx / frameCols);
      const x = OX + c * TILE + f.drift * p;
      const y = OY + r * TILE + p * p * 220;
      ctx.save();
      ctx.globalAlpha = 1 - p * p;
      ctx.translate(x + TILE / 2, y + TILE / 2);
      ctx.rotate(f.rot * p);
      ctx.translate(-(x + TILE / 2), -(y + TILE / 2));
      this.drawTile(ctx, x, y, this.tileColors(theme, c, r), theme, 1, f.idx, 1 - p * 0.55);
      ctx.restore();
    }
  }

  drawPuddles(ctx, frame) {
    for (const pd of frame.puddles) {
      const x = OX + pd.x;
      const y = OY + pd.y;
      const R = 34;
      const forming = pd.f < 1;
      ctx.save();
      ctx.translate(x, y);
      if (pd.l < 0.15) ctx.globalAlpha = Math.max(0, pd.l / 0.15);
      if (forming) {
        // Warning: dashed circle + faint goo. Harmless until it finishes forming.
        ctx.globalAlpha *= 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 7]);
        ctx.lineDashOffset = -this.clock * 30;
        ctx.beginPath();
        ctx.arc(0, 0, R * (0.5 + 0.5 * pd.f), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(160,70,220,${0.15 + pd.f * 0.35})`;
        ctx.beginPath();
        ctx.arc(0, 0, R * pd.f, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        const pts = 40; // plenty of points = smooth, gooey outline
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2;
          const rad = R * (0.9 + 0.07 * Math.sin(a * 3 + this.clock * 3) + 0.03 * Math.sin(a * 5 - this.clock * 2));
          const px = Math.cos(a) * rad;
          const py = Math.sin(a) * rad * 0.82;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.lineJoin = 'round';
        ctx.fillStyle = 'rgba(150,60,210,0.88)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(42,26,60,0.7)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(-9, -8, 9, 5, -0.4, 0, Math.PI * 2);
        ctx.fill();
        // bubbles
        for (let b = 0; b < 3; b++) {
          const ph = (this.clock * 0.7 + b * 0.33) % 1;
          ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - ph)})`;
          ctx.beginPath();
          ctx.arc(-12 + b * 12, 6 - ph * 22, 2.5 + b, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  drawEntities(ctx, frame, dt) {
    const list = [...frame.players].filter((p) => p.st !== 'left');
    list.sort((a, b) => a.y - b.y);
    const ghosts = list.filter((p) => p.st === 'ghost');
    const bodies = list.filter((p) => p.st !== 'ghost');

    // shadows first
    for (const p of bodies) {
      if (p.st === 'falling') continue;
      const h = clamp(p.z / 90, 0, 1);
      ctx.fillStyle = `rgba(20,5,40,${0.28 * (1 - h * 0.6)})`;
      ctx.beginPath();
      ctx.ellipse(OX + p.x, OY + p.y + 3, 21 * (1 - h * 0.35), 8.5 * (1 - h * 0.35), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of bodies) this.drawPlayer(ctx, p, frame, dt);
    for (const p of ghosts) this.drawGhostPlayer(ctx, p, frame, dt);

    // speech bubbles on top
    for (const p of list) {
      const s = this.pstate.get(p.id);
      if (!s || s.bubbleT <= 0) continue;
      s.bubbleT -= dt;
      const a = clamp(s.bubbleT / 0.3, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `900 24px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      const bx = OX + p.x;
      const by = OY + p.y - 70 - (0.9 - s.bubbleT) * 30;
      ctx.strokeText(s.bubble, bx, by);
      ctx.fillStyle = '#ffe66d';
      ctx.fillText(s.bubble, bx, by);
      ctx.restore();
    }
  }

  drawPlayer(ctx, p, frame, dt) {
    const meta = frame.meta.get(p.id) || { name: '?', color: 0, hat: 0 };
    const color = COLORS[meta.color % COLORS.length].hex;
    const s = this.state(p.id);
    const isMe = p.id === frame.myId;

    // walk cycle driven by speed
    const speed = Math.hypot(p.vx, p.vy);
    const grounded = p.z <= 0.5;
    s.moving = lerp(s.moving, grounded && p.st === 'alive' && speed > 25 ? 1 : 0, 0.3);
    s.walk += dt * (6 + speed * 0.045) * (s.moving > 0.1 ? 1 : 0);
    s.squash = Math.max(0, s.squash - dt);
    s.stretch = Math.max(0, s.stretch - dt);

    let sx = 1;
    let sy = 1;
    if (!grounded) {
      const st = clamp(Math.abs(p.vz) / 1500, 0, 0.22);
      sy = 1 + st;
      sx = 1 - st * 0.7;
    }
    if (s.squash > 0) {
      const k = s.squash / 0.22;
      sy = 1 - 0.3 * k;
      sx = 1 + 0.28 * k;
    } else if (s.stretch > 0) {
      const k = s.stretch / 0.2;
      sy = 1 + 0.2 * k;
      sx = 1 - 0.14 * k;
    }
    const bob = grounded && s.moving > 0.1 ? Math.abs(Math.sin(s.walk)) * 3 : 0;

    let alpha = 1;
    let rot = 0;
    let scale = 1;
    let mood = 'normal';
    let yOff = 0;
    if (p.st === 'falling') {
      const f = p.fl;
      scale = 1 - f * 0.95;
      rot = f * 5 * (hashString(p.id) % 2 ? 1 : -1);
      yOff = f * 45;
      alpha = 1 - f * f * 0.6;
      mood = 'scared';
    } else if (p.sn) {
      mood = 'dizzy';
    } else if (frame.finished && p.st === 'alive' && frame.aliveCount <= 1) {
      mood = 'happy';
    }

    const X = OX + p.x;
    const Y = OY + p.y - p.z + yOff - bob;

    // facing marker on the ground (helps with aiming shoves)
    if (p.st === 'alive' && grounded) {
      ctx.save();
      ctx.translate(OX + p.x + p.fx * 33, OY + p.y + p.fy * 33 * 0.8 + 2);
      ctx.rotate(Math.atan2(p.fy * 0.8, p.fx));
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, -5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // shove swoosh + glove
    if (p.sh > 0 && p.st === 'alive') {
      const k = p.sh;
      ctx.save();
      ctx.translate(OX + p.x, OY + p.y - p.z - 18);
      const ang = Math.atan2(p.fy, p.fx);
      ctx.strokeStyle = `rgba(255,255,255,${0.9 * k})`;
      ctx.lineWidth = 7 * k + 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, 44 + (1 - k) * 26, ang - 0.9, ang + 0.9);
      ctx.stroke();
      const gx = Math.cos(ang) * (30 + (1 - k) * 34);
      const gy = Math.sin(ang) * (30 + (1 - k) * 34);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(gx, gy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    if (scale !== 1) {
      ctx.translate(X, Y);
      ctx.scale(scale, scale);
      ctx.translate(-X, -Y);
    }

    // slowed by goo: purple tint + drips
    if (p.sl) {
      ctx.fillStyle = 'rgba(150,60,210,0.55)';
      ctx.beginPath();
      ctx.ellipse(X, Y, 26, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawBlob(ctx, {
      x: X, y: Y, color, hat: meta.hat, fx: p.fx, fy: p.fy, sx, sy, walk: s.walk, alpha, rot, mood, t: this.clock,
    });

    if (p.sl) {
      ctx.fillStyle = 'rgba(160,70,220,0.75)';
      for (let i = 0; i < 3; i++) {
        const ph = (this.clock * 1.4 + i * 0.33) % 1;
        ctx.beginPath();
        ctx.arc(X - 12 + i * 12, Y - 30 + ph * 28, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // immunity ring + dizzy stars
    if (p.im && p.st === 'alive') {
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -this.clock * 40;
      ctx.beginPath();
      ctx.ellipse(X, Y - 2, 29, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.sn && p.st === 'alive') {
      ctx.fillStyle = '#ffe66d';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = this.clock * 7 + (i * Math.PI * 2) / 3;
        const sx2 = X + Math.cos(a) * 20;
        const sy2 = Y - 62 + Math.sin(a) * 6;
        this.star(ctx, sx2, sy2, 6, 3);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();

    // name tag (sits above the tallest part of the character, hat included)
    if (p.st === 'alive') {
      const top = Math.max(52, 48 + (HAT_HEIGHT[meta.hat] || 0));
      drawNameTag(ctx, meta.name, X, Y - (top + 16) * sy, color, isMe);
      if (isMe) {
        const bounce = Math.sin(this.clock * 6) * 3;
        ctx.save();
        ctx.fillStyle = '#fff27a';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        const ay = Y - (top + 38) * sy + bounce;
        ctx.beginPath();
        ctx.moveTo(X - 8, ay - 9);
        ctx.lineTo(X + 8, ay - 9);
        ctx.lineTo(X, ay + 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  star(ctx, x, y, R, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rad = i % 2 === 0 ? R : r;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  drawGhostPlayer(ctx, p, frame) {
    const meta = frame.meta.get(p.id) || { name: '?', color: 0, hat: 0 };
    const color = COLORS[meta.color % COLORS.length].hex;
    const isMe = p.id === frame.myId;
    const bob = Math.sin(this.clock * 3 + hashString(p.id)) * 5;
    const X = OX + p.x;
    const Y = OY + p.y - 26 + bob;
    ctx.fillStyle = 'rgba(20,5,40,0.16)';
    ctx.beginPath();
    ctx.ellipse(OX + p.x, OY + p.y + 8, 17, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    drawGhost(ctx, { x: X, y: Y, color, fx: p.fx, fy: p.fy, alpha: isMe ? 0.95 : 0.7, t: this.clock });
    ctx.save();
    ctx.globalAlpha = isMe ? 1 : 0.8;
    drawNameTag(ctx, meta.name, X, Y - 70, color, isMe);
    ctx.restore();
    if (isMe) {
      // goo ammo above the ghost
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < p.am ? 'rgba(160,70,220,0.95)' : 'rgba(255,255,255,0.25)';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X - 14 + i * 14, Y - 90, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  drawParticles(ctx, dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += q.vr * dt;
      const a = clamp(q.life / q.max, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.translate(q.x, q.y);
      ctx.rotate(q.rot);
      if (q.shape === 'star') {
        this.star(ctx, 0, 0, q.size, q.size * 0.45);
        ctx.fill();
      } else if (q.shape === 'square') {
        ctx.fillRect(-q.size / 2, -q.size / 3, q.size, q.size * 0.66);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, q.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      const k = 1 - t.life / t.max;
      const a = clamp(t.life / 0.3, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `900 ${t.size * (1 + 0.25 * Math.sin(k * Math.PI))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      const y = t.y - k * 46;
      ctx.strokeText(t.text, t.x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, y);
      ctx.restore();
    }
  }
}

// A tiny helper for the menus: draws one character into a small canvas.
export function drawPreview(canvas, look, t = 0, mood = 'normal') {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const k = Math.min(w / 80, h / 120);
  ctx.save();
  ctx.translate(w / 2, h - 10 * k);
  ctx.scale(k, k);
  const bob = Math.abs(Math.sin(t * 3)) * 3;
  drawBlob(ctx, {
    x: 0, y: -bob, color: COLORS[look.color % COLORS.length].hex, hat: look.hat, fx: 0, fy: 1,
    sx: 1 + Math.sin(t * 6) * 0.02, sy: 1 - Math.sin(t * 6) * 0.02, walk: 0, mood, t,
  });
  ctx.restore();
}
