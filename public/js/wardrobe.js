// ---------------------------------------------------------------------------
// wardrobe.js - the drawing code for the NEWER cosmetics (v0.12): back items
// (capes, cloaks, hoodies), the pack skins and the pack hats. Everything is
// drawn with canvas shapes, there are no image files.
//
// renderer.js calls into this file:
//   drawBackBehind / drawBackFront   back items (behind the body / over the belly)
//   drawPackSkin                     skins 24+ (clipped to the body already)
//   drawPackHat                      hats 22+ (origin = top of the head)
// The NAMES live in constants.js; BACK_DEFS below must have one entry per back item
// (tests/packs.test.js checks the lengths match).
// ---------------------------------------------------------------------------

import { INK } from './constants.js';

// ------------------------------------------------------------------ helpers
function hexRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a, b, t) {
  const A = hexRgb(a);
  const B = hexRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function star(ctx, x, y, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
}
function roundRect(ctx, x, y, w, h, r) {
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
const dot = (ctx, x, y, r) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

// ------------------------------------------------------------------ back items
// type: 'cape' | 'cloak' | 'hoodie'. c1 = main colour, c2 = trim / lining colour.
// deco: an extra pattern (see drawDeco).
export const BACK_DEFS = [
  null, // 0 = nothing
  { type: 'cape', c1: '#e63946', c2: '#ffd23f', deco: 'plain' }, // 1 Red cape
  { type: 'cape', c1: '#3a86ff', c2: '#ffffff', deco: 'plain' }, // 2 Blue cape
  { type: 'hoodie', c1: '#8d99ae', c2: '#edf2f4', deco: 'plain' }, // 3 Gray hoodie
  { type: 'cloak', c1: '#2f9e44', c2: '#b7e4c7', deco: 'plain' }, // 4 Green cloak
  { type: 'cape', c1: '#ffca3a', c2: '#ff9f1c', deco: 'plain' }, // 5 Yellow cape
  { type: 'hoodie', c1: '#ff8fab', c2: '#fff0f3', deco: 'plain' }, // 6 Pink hoodie
  { type: 'hoodie', c1: '#ff8c42', c2: '#ffe8d6', deco: 'plain' }, // 7 Orange hoodie
  { type: 'cloak', c1: '#8a5a3c', c2: '#d9b38c', deco: 'plain' }, // 8 Brown cloak
  { type: 'cape', c1: '#ffffff', c2: '#e63946', deco: 'stripes' }, // 9 Striped cape
  { type: 'hoodie', c1: '#6bd36b', c2: '#2d6a2d', deco: 'frog' }, // 10 Frog hoodie
  { type: 'hoodie', c1: '#3d3d4e', c2: '#ffb3c6', deco: 'cat' }, // 11 Cat hoodie
  { type: 'cloak', c1: '#1d1d2b', c2: '#6c6c8a', deco: 'plain' }, // 12 Black cloak
  { type: 'cape', c1: '#d62828', c2: '#ffd60a', deco: 'hero' }, // 13 Hero cape
  { type: 'cloak', c1: '#2b2d7a', c2: '#ffd60a', deco: 'stars' }, // 14 Wizard cloak
  { type: 'cape', c1: '#7b2cbf', c2: '#ffffff', deco: 'ermine' }, // 15 Royal cape
  { type: 'cloak', c1: '#1a0a1f', c2: '#c1121f', deco: 'collar' }, // 16 Vampire cloak
  { type: 'cape', c1: '#ff5a1f', c2: '#ffd23f', deco: 'flame' }, // 17 Flame cape
  { type: 'cloak', c1: '#8ecae6', c2: '#ffffff', deco: 'ice' }, // 18 Ice cloak
  { type: 'cape', c1: '#ff595e', c2: '#ffffff', deco: 'rainbow' }, // 19 Rainbow cape
  { type: 'cape', c1: '#ffd23f', c2: '#fff3b0', deco: 'gold' }, // 20 Golden cape
  { type: 'cloak', c1: '#1b1464', c2: '#9b5de5', deco: 'galaxy' }, // 21 Galaxy cloak
];

// The flowing mantle of a cape or cloak (a path, not yet filled).
function mantlePath(ctx, d, sway, lean, flutter) {
  const long = d.type === 'cloak';
  const topY = -41;
  const hemY = long ? 3 : -1;
  const w = long ? 35 : 31;
  ctx.beginPath();
  ctx.moveTo(-16 + lean * 0.3, topY);
  ctx.lineTo(16 + lean * 0.3, topY);
  ctx.quadraticCurveTo(w * 0.95 + lean, -20, w + lean + sway, hemY);
  if (long) {
    // ragged, pointy hem
    const n = 6;
    for (let k = 1; k <= n; k++) {
      const x = w + lean + sway - (k * (2 * w + 2 * sway)) / n;
      const y = hemY + (k % 2 === 0 ? 0 : 6 + flutter * 0.6);
      ctx.lineTo(x, y);
    }
  } else {
    // soft wavy hem
    ctx.bezierCurveTo(w * 0.4 + lean, hemY + 6 + flutter, -w * 0.4 + lean, hemY - 4 - flutter, -w + lean - sway, hemY);
  }
  ctx.quadraticCurveTo(-w * 0.95 + lean, -20, -16 + lean * 0.3, topY);
  ctx.closePath();
}

function drawDeco(ctx, d, t) {
  // drawn inside the mantle (already clipped); only the parts outside the body show
  switch (d.deco) {
    case 'stripes':
      ctx.fillStyle = d.c2;
      for (const y of [-30, -20, -10, 0]) ctx.fillRect(-40, y, 80, 4);
      break;
    case 'hero':
      ctx.fillStyle = d.c2;
      for (const s of [-1, 1]) {
        star(ctx, s * 26, -14, 6.5, 2.8);
        ctx.fill();
      }
      ctx.fillRect(-40, -4, 80, 3);
      break;
    case 'stars':
      ctx.fillStyle = d.c2;
      for (const [x, y, r] of [[-27, -24, 3.8], [28, -10, 3.2], [-24, -5, 2.6], [26, -30, 2.6], [-31, -14, 2], [31, -20, 2]]) {
        star(ctx, x, y, r * 1.5, r * 0.6);
        ctx.fill();
      }
      break;
    case 'ermine':
      ctx.fillStyle = d.c2;
      ctx.fillRect(-40, -8, 80, 12);
      ctx.fillStyle = '#222';
      for (let x = -34; x <= 34; x += 9) {
        dot(ctx, x, -3, 1.6);
        ctx.fillRect(x - 0.7, -2, 1.4, 4);
      }
      break;
    case 'collar':
      ctx.fillStyle = d.c2;
      ctx.fillRect(-40, -8, 80, 2.5);
      ctx.fillRect(-40, -3, 80, 2.5);
      break;
    case 'flame': {
      const flick = Math.sin(t * 11) * 1.8;
      for (const [col, k] of [[d.c1, 1], [d.c2, 0.6]]) {
        ctx.fillStyle = col;
        for (let x = -34; x <= 34; x += 10) {
          const h = (10 + ((x * 7) % 9) + flick * (x % 20 === 0 ? 1 : -1)) * k;
          ctx.beginPath();
          ctx.moveTo(x - 5, 4);
          ctx.quadraticCurveTo(x - 4, -h * 0.4, x, -h - 6);
          ctx.quadraticCurveTo(x + 4, -h * 0.4, x + 5, 4);
          ctx.fill();
        }
      }
      break;
    }
    case 'ice':
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const [x, y] of [[-27, -20], [28, -26], [-30, -4], [26, -6]]) {
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 3, y);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 3, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillRect(-40, -3, 80, 4);
      break;
    case 'rainbow':
      ['#ff595e', '#ff924c', '#ffca3a', '#8ac926', '#1982c4', '#9b5de5'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(-40, -44 + i * 8, 80, 8.4);
      });
      break;
    case 'gold': {
      const g = ctx.createLinearGradient(-30, -40, 30, 4);
      g.addColorStop(0, '#fff3b0');
      g.addColorStop(0.5, '#e0a100');
      g.addColorStop(1, '#ffe27a');
      ctx.fillStyle = g;
      ctx.fillRect(-40, -44, 80, 52);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.save();
      ctx.rotate(-0.5);
      ctx.fillRect(-40, -22, 80, 5);
      ctx.restore();
      break;
    }
    case 'galaxy': {
      const g = ctx.createLinearGradient(-30, -40, 30, 4);
      g.addColorStop(0, '#1b1464');
      g.addColorStop(0.55, '#6a2fb8');
      g.addColorStop(1, '#173f8f');
      ctx.fillStyle = g;
      ctx.fillRect(-40, -44, 80, 52);
      ctx.fillStyle = '#fff';
      for (const [x, y, r] of [[-27, -26, 1.6], [29, -12, 1.4], [-30, -6, 1.2], [26, -32, 1.3], [-22, -12, 1], [32, -24, 1.1], [24, -2, 1.5]]) dot(ctx, x, y, r);
      ctx.fillStyle = '#ffe9a8';
      star(ctx, -28, -17, 5, 2);
      ctx.fill();
      star(ctx, 29, -4, 4, 1.6);
      ctx.fill();
      break;
    }
    default:
      break;
  }
}

/** Everything of a back item that is BEHIND the body. o = { walk, fx, t } */
export function drawBackBehind(ctx, back, o = {}) {
  const d = BACK_DEFS[back];
  if (!d) return;
  const t = o.t || 0;
  const walk = o.walk || 0;
  const fx = Math.max(-1, Math.min(1, o.fx || 0));
  const flutter = Math.sin(t * 5) * 1.5 + Math.sin(walk) * 2;
  const lean = -fx * 5;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;

  if (d.type === 'hoodie') {
    // stubby sleeves
    ctx.fillStyle = d.c1;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 22, -20 + Math.sin(walk + (s > 0 ? 0 : Math.PI)) * 2, 7, 11, s * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // the hood: a big soft ring behind the head
    ctx.fillStyle = d.c1;
    ctx.beginPath();
    ctx.ellipse(0, -36, 26, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = d.c2;
    ctx.globalAlpha *= 0.55;
    ctx.beginPath();
    ctx.ellipse(0, -37, 23, 21, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha /= 0.55;
    if (d.deco === 'cat') {
      ctx.fillStyle = d.c1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 10, -55);
        ctx.lineTo(s * 24, -66);
        ctx.lineTo(s * 25, -46);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = d.c2;
        ctx.beginPath();
        ctx.moveTo(s * 14, -54);
        ctx.lineTo(s * 22, -61);
        ctx.lineTo(s * 23, -50);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = d.c1;
      }
    } else if (d.deco === 'frog') {
      for (const s of [-1, 1]) {
        ctx.fillStyle = d.c1;
        ctx.beginPath();
        ctx.arc(s * 14, -58, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(s * 14, -59, 4.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = INK;
        dot(ctx, s * 14, -58, 2.2);
      }
    }
    ctx.restore();
    return;
  }

  // cape or cloak
  if (d.type === 'cloak') {
    // hood behind the head
    ctx.fillStyle = mixHex(d.c1, '#000000', 0.18);
    ctx.beginPath();
    ctx.ellipse(0, -38, 22, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (d.deco === 'collar') {
      // tall vampire collar
      ctx.fillStyle = d.c1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 8, -34);
        ctx.lineTo(s * 28, -62);
        ctx.lineTo(s * 25, -30);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = d.c2;
        ctx.beginPath();
        ctx.moveTo(s * 13, -36);
        ctx.lineTo(s * 25, -55);
        ctx.lineTo(s * 23, -33);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = d.c1;
      }
    }
  }
  const sway = Math.max(-4, Math.min(4, flutter));
  ctx.save();
  mantlePath(ctx, d, sway, lean, flutter);
  ctx.fillStyle = d.c1;
  ctx.fill();
  ctx.clip();
  drawDeco(ctx, d, t);
  // trim along the hem
  if (d.deco !== 'rainbow' && d.deco !== 'gold' && d.deco !== 'galaxy' && d.deco !== 'ermine' && d.deco !== 'flame') {
    ctx.fillStyle = d.c2;
    ctx.globalAlpha *= 0.9;
    ctx.fillRect(-45, d.type === 'cloak' ? -4 : -9, 90, 3.5);
    ctx.globalAlpha /= 0.9;
  }
  // soft shade on the inside edge
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(-45, -45, 90, 20);
  ctx.restore();
  mantlePath(ctx, d, sway, lean, flutter);
  ctx.stroke();
  ctx.restore();
}

/** The parts of a back item drawn OVER the body (clasps, hoodie pocket and strings). */
export function drawBackFront(ctx, back, o = {}) {
  const d = BACK_DEFS[back];
  if (!d) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  if (d.type === 'hoodie') {
    // front pocket
    ctx.lineWidth = 2.6;
    ctx.fillStyle = d.c1;
    roundRect(ctx, -10, -13, 20, 9, 4);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-6, -13);
    ctx.lineTo(-8, -17);
    ctx.moveTo(6, -13);
    ctx.lineTo(8, -17);
    ctx.stroke();
    // drawstrings
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = d.c2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 5, -19);
      ctx.lineTo(s * 6.5, -12);
      ctx.stroke();
    }
  } else {
    // two round clasps where the cape meets the shoulders
    ctx.lineWidth = 2;
    ctx.fillStyle = d.deco === 'rainbow' ? '#ffd23f' : d.c2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * 16.5, -39, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = d.deco === 'rainbow' ? '#ffd23f' : d.c2;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-13.5, -39);
    ctx.quadraticCurveTo(0, -35, 13.5, -39);
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ pack skins
// Drawn inside the body shape (the caller clipped to the ellipse). Coordinates: x -21..21, y -52..0.
export function drawPackSkin(ctx, skin, color) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const full = () => ctx.fillRect(-34, -58, 68, 64);
  switch (skin) {
    case 24: // denim
      ctx.fillStyle = 'rgba(52,96,170,0.9)';
      full();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      for (let i = -60; i < 60; i += 4) {
        ctx.beginPath();
        ctx.moveTo(i, -58);
        ctx.lineTo(i + 40, 6);
        ctx.stroke();
      }
      ctx.strokeStyle = '#f0d98a';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([3.5, 3]);
      for (const x of [-9, 9]) {
        ctx.beginPath();
        ctx.moveTo(x, -52);
        ctx.lineTo(x, 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-14, -12);
      ctx.lineTo(14, -12);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 25: // pinstripe
      ctx.fillStyle = 'rgba(38,42,64,0.92)';
      full();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let x = -30; x <= 30; x += 6) ctx.fillRect(x, -58, 1.4, 64);
      break;
    case 26: // plaid
      ctx.fillStyle = 'rgba(190,38,52,0.9)';
      full();
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      for (const p of [-28, -12, 4, 20]) {
        ctx.fillRect(p, -58, 7, 64);
        ctx.fillRect(-34, p - 14, 68, 7);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (const p of [-18, -2, 14, 30]) {
        ctx.fillRect(p, -58, 1.5, 64);
        ctx.fillRect(-34, p - 20, 68, 1.5);
      }
      break;
    case 27: // leopard
      ctx.fillStyle = 'rgba(232,172,74,0.95)';
      full();
      for (const [x, y, r] of [[-12, -44, 5], [11, -46, 4.4], [-16, -28, 5], [14, -26, 5.4], [-6, -14, 4.6], [10, -8, 4.2], [-15, -8, 3.6], [0, -34, 3.4]]) {
        ctx.fillStyle = '#7a4a1a';
        ctx.beginPath();
        ctx.arc(x, y, r, 0.4, Math.PI * 2 - 0.5);
        ctx.arc(x, y, r * 0.45, Math.PI * 2 - 0.5, 0.4, true);
        ctx.fill();
        ctx.fillStyle = 'rgba(122,74,26,0.45)';
        dot(ctx, x, y, r * 0.4);
      }
      break;
    case 28: // snowflakes
      ctx.fillStyle = 'rgba(64,124,200,0.9)';
      full();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.7;
      for (const [cx, cy, R] of [[-9, -40, 8], [11, -26, 7], [-12, -14, 6], [8, -48, 4.5], [14, -8, 4]]) {
        for (let a = 0; a < 3; a++) {
          const ang = (a * Math.PI) / 3 + 0.3;
          ctx.beginPath();
          ctx.moveTo(cx - Math.cos(ang) * R, cy - Math.sin(ang) * R);
          ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
          ctx.stroke();
        }
      }
      break;
    case 29: { // sunset
      const g = ctx.createLinearGradient(0, -54, 0, 4);
      g.addColorStop(0, '#2b1b5a');
      g.addColorStop(0.45, '#d6336c');
      g.addColorStop(0.8, '#ff9a3c');
      g.addColorStop(1, '#ffd36e');
      ctx.fillStyle = g;
      full();
      ctx.fillStyle = '#fff1a8';
      ctx.beginPath();
      ctx.arc(0, -6, 11, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (const [x, y] of [[-12, -46], [9, -40], [14, -50]]) dot(ctx, x, y, 1);
      break;
    }
    case 30: { // ocean
      const g = ctx.createLinearGradient(0, -54, 0, 4);
      g.addColorStop(0, '#8fe0ff');
      g.addColorStop(1, '#0a4d8c');
      ctx.fillStyle = g;
      full();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      for (const y of [-44, -32, -20, -8]) {
        ctx.beginPath();
        for (let x = -26; x <= 26; x += 3) ctx.lineTo(x, y + Math.sin((x + y) / 4) * 2.5);
        ctx.stroke();
      }
      ctx.fillStyle = '#ff9f1c';
      for (const [x, y, s] of [[-10, -26, 1], [12, -14, -1]]) {
        ctx.beginPath();
        ctx.ellipse(x, y, 5, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - s * 4, y);
        ctx.lineTo(x - s * 9, y - 3.5);
        ctx.lineTo(x - s * 9, y + 3.5);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 31: { // pixel heart
      const cell = 6;
      for (let gy = 0; gy < 10; gy++) {
        for (let gx = 0; gx < 8; gx++) {
          ctx.fillStyle = (gx + gy) % 2 ? '#1c2541' : '#243059';
          ctx.fillRect(-24 + gx * cell, -56 + gy * cell, cell, cell);
        }
      }
      const heart = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
      heart.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          if (row[rx] !== '#') continue;
          ctx.fillStyle = ry === 0 && rx < 3 ? '#ffd1dc' : '#ff4d6d';
          ctx.fillRect(-21 + rx * 6, -44 + ry * 6, 6, 6);
        }
      });
      break;
    }
    case 32: { // toxic slime
      ctx.fillStyle = 'rgba(118,214,40,0.95)';
      full();
      ctx.fillStyle = '#3f8f1a';
      for (const [x, w, h] of [[-16, 6, 22], [-3, 7, 32], [10, 6, 18], [20, 5, 26]]) {
        ctx.beginPath();
        ctx.moveTo(x - w, -58);
        ctx.lineTo(x - w, -52 + h);
        ctx.arc(x, -52 + h, w, Math.PI, 0, true);
        ctx.lineTo(x + w, -58);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const [x, y, r] of [[-10, -14, 3], [8, -9, 2.4], [-3, -4, 1.8], [15, -20, 2]]) dot(ctx, x, y, r);
      break;
    }
    case 33: { // neon grid
      ctx.fillStyle = '#12081f';
      full();
      for (const [w, a] of [[5, 0.16], [2, 1]]) {
        ctx.lineWidth = w;
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#ff2bd6';
        for (const y of [-44, -32, -20, -8]) {
          ctx.beginPath();
          ctx.moveTo(-26, y);
          ctx.lineTo(26, y);
          ctx.stroke();
        }
        ctx.strokeStyle = '#22e5ff';
        for (const x of [-14, 0, 14]) {
          ctx.beginPath();
          ctx.moveTo(x, -56);
          ctx.lineTo(x, 4);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 34: { // stained glass
      const pal = ['#d62839', '#f77f00', '#fcbf49', '#2a9d8f', '#3a86ff', '#9b5de5'];
      for (let gy = -5; gy < 6; gy++) {
        for (let gx = -3; gx < 4; gx++) {
          const cx = gx * 12 + (gy % 2 ? 6 : 0);
          const cy = -26 + gy * 8;
          ctx.fillStyle = pal[Math.abs(gx * 3 + gy * 5 + 60) % pal.length];
          ctx.globalAlpha = 0.88;
          ctx.beginPath();
          ctx.moveTo(cx, cy - 7);
          ctx.lineTo(cx + 6, cy);
          ctx.lineTo(cx, cy + 7);
          ctx.lineTo(cx - 6, cy);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#241a14';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }
      break;
    }
    case 35: { // aurora
      const g = ctx.createLinearGradient(0, -56, 0, 6);
      g.addColorStop(0, '#071a2f');
      g.addColorStop(1, '#0b3a4a');
      ctx.fillStyle = g;
      full();
      [['rgba(70,255,170,0.55)', -40, 9], ['rgba(110,120,255,0.5)', -26, 8], ['rgba(190,90,255,0.45)', -12, 7]].forEach(([c, y0, amp]) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(-30, y0 + 12);
        for (let x = -30; x <= 30; x += 3) ctx.lineTo(x, y0 + Math.sin(x / 7 + y0) * amp * 0.6);
        ctx.lineTo(30, y0 + 16);
        ctx.closePath();
        ctx.fill();
      });
      ctx.fillStyle = '#fff';
      for (const [x, y] of [[-14, -50], [10, -46], [16, -30], [-18, -22], [4, -6]]) dot(ctx, x, y, 0.9);
      break;
    }
    case 36: { // diamond facets
      const cx = 0;
      const cy = -26;
      const cols = ['#e9fbff', '#b8ecff', '#8fd8f5', '#d6f6ff', '#a6e3fb', '#f4feff', '#9ddcf7', '#c9f1ff'];
      const R = 40;
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2;
        const a1 = ((i + 1) / 8) * Math.PI * 2;
        ctx.fillStyle = cols[i];
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
        ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      star(ctx, 8, -40, 5, 1.6);
      ctx.fill();
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------------ pack hats
// Origin = the top of the head; the caller already set a black outline (lineWidth 3).
export function drawPackHat(ctx, hat, t) {
  ctx.lineJoin = 'round';
  switch (hat) {
    case 22: // fez
      ctx.fillStyle = '#c1121f';
      ctx.beginPath();
      ctx.moveTo(-12, 1);
      ctx.lineTo(12, 1);
      ctx.lineTo(8.5, -17);
      ctx.lineTo(-8.5, -17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e5383b';
      ctx.beginPath();
      ctx.ellipse(0, -17, 8.5, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(-11.5, -3, 23, 3.5);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -17);
      ctx.quadraticCurveTo(12, -17, 12, -8 + Math.sin(t * 6) * 1);
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      roundRect(ctx, 10, -9, 4, 8, 1.5);
      ctx.fill();
      break;
    case 23: // sombrero
      ctx.fillStyle = '#e9b44c';
      ctx.beginPath();
      ctx.ellipse(0, -1, 31, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10, -3);
      ctx.quadraticCurveTo(-9, -22, 0, -23);
      ctx.quadraticCurveTo(9, -22, 10, -3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d62839';
      ctx.fillRect(-9.6, -9, 19.2, 4);
      ctx.fillStyle = '#2a9d8f';
      for (let x = -8; x <= 8; x += 4) {
        ctx.beginPath();
        ctx.moveTo(x - 2, -5);
        ctx.lineTo(x, -9);
        ctx.lineTo(x + 2, -5);
        ctx.fill();
      }
      break;
    case 24: // knight helm
      ctx.fillStyle = '#aab4c4';
      ctx.beginPath();
      ctx.ellipse(0, 2, 17, 19, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#dfe6ee';
      ctx.beginPath();
      ctx.ellipse(-5, -8, 4, 9, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6c7a8c';
      ctx.fillRect(-17, -3, 34, 5);
      ctx.strokeRect(-17, -3, 34, 5);
      ctx.fillStyle = '#ffd23f';
      for (const x of [-11, 0, 11]) dot(ctx, x, -0.5, 1.4);
      // plume
      ctx.fillStyle = '#d62828';
      ctx.beginPath();
      ctx.moveTo(-3, -17);
      ctx.quadraticCurveTo(-4 + Math.sin(t * 4) * 2, -34, 12, -30);
      ctx.quadraticCurveTo(8, -24, 4, -17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 25: // ninja band
      ctx.fillStyle = '#1b1b2f';
      for (const [x, y] of [[26 + Math.sin(t * 7) * 1.5, -7], [27, 7 + Math.sin(t * 7 + 1) * 1.5]]) {
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.quadraticCurveTo(21, y * 0.4, x, y);
        ctx.lineTo(20, 1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      roundRect(ctx, -18, -3, 36, 9, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b8c0cc';
      roundRect(ctx, -8, -2, 16, 7, 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#1b1b2f';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-4, 3.5);
      ctx.lineTo(4, 0);
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 3.5);
      ctx.stroke();
      break;
    case 26: // dragon horns
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#f4e3b2';
        ctx.beginPath();
        ctx.moveTo(s * 7, 2);
        ctx.bezierCurveTo(s * 22, 0, s * 24, -14, s * 14, -30);
        ctx.bezierCurveTo(s * 15, -16, s * 12, -8, s * 3, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e63946';
        ctx.beginPath();
        ctx.moveTo(s * 5, 2);
        ctx.lineTo(s * 16, 1);
        ctx.lineTo(s * 17, -6);
        ctx.lineTo(s * 4, -5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 27: // royal crown
      ctx.fillStyle = '#b0003a';
      ctx.beginPath();
      ctx.ellipse(0, -6, 14, 9, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(-17, 4);
      ctx.lineTo(-18, -17);
      ctx.lineTo(-9, -8);
      ctx.lineTo(-5, -24);
      ctx.lineTo(0, -10);
      ctx.lineTo(5, -24);
      ctx.lineTo(9, -8);
      ctx.lineTo(18, -17);
      ctx.lineTo(17, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(-16, -2, 32, 2.4);
      ctx.fillStyle = '#ff4d6d';
      dot(ctx, 0, -2, 3.2);
      ctx.fillStyle = '#4cc9f0';
      dot(ctx, -9, -2, 2.3);
      dot(ctx, 9, -2, 2.3);
      ctx.fillStyle = '#ffffff';
      for (const [x, y] of [[-18, -18], [-5, -25], [5, -25], [18, -18]]) dot(ctx, x, y, 2);
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ the funny hats (v0.12)
// Collections: Disaster, Magical Nonsense, Snack Attack, Show-Off and Weird Science.
// Several have tiny idle animations (cosmetic only): the chicken squawks, the alien waves,
// the tiny crown wobbles when you are dizzy or scared, the siren flashes...
// `t` = seconds (different for every player, so hats do not all move in sync).
// `mood` = 'normal' | 'scared' | 'dizzy' | 'happy'.
const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

function label(ctx, text, x, y, size, fill = '#fff', stroke = INK) {
  ctx.save();
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size * 0.3);
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function bucketShape(ctx, topW, botW, h) {
  ctx.beginPath();
  ctx.moveTo(-botW, 0);
  ctx.lineTo(botW, 0);
  ctx.lineTo(topW, -h);
  ctx.lineTo(-topW, -h);
  ctx.closePath();
}

function glowOrb(ctx, x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawFunHat(ctx, hat, t, mood = 'normal') {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const scared = mood === 'scared' || mood === 'dizzy';
  switch (hat) {
    case 28: { // Warning Sign: "BAD IDEA"
      ctx.save();
      ctx.translate(0, 2);
      ctx.rotate(Math.sin(t * 2) * 0.06);
      ctx.fillStyle = '#8a8f99';
      ctx.fillRect(-1.6, -12, 3.2, 12);
      ctx.strokeRect(-1.6, -12, 3.2, 12);
      ctx.fillStyle = '#ffd23f';
      roundRect(ctx, -19, -32, 38, 21, 3);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1.4;
      roundRect(ctx, -16.5, -29.5, 33, 16, 1.5);
      ctx.stroke();
      label(ctx, 'BAD', 0, -25, 7.5, '#1b1b2f', 'rgba(0,0,0,0)');
      label(ctx, 'IDEA', 0, -18, 7.5, '#1b1b2f', 'rgba(0,0,0,0)');
      ctx.restore();
      break;
    }
    case 29: { // Cardboard Box
      const shake = scared ? Math.sin(t * 30) * 1.2 : 0;
      ctx.save();
      ctx.translate(shake, 0);
      ctx.fillStyle = '#c8965a';
      roundRect(ctx, -16, -24, 32, 25, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b7834a';
      ctx.beginPath();
      ctx.moveTo(-16, -24);
      ctx.lineTo(-9, -31 + Math.sin(t * 3) * 0.6);
      ctx.lineTo(-1, -24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(16, -24);
      ctx.lineTo(9, -31 + Math.sin(t * 3 + 1) * 0.6);
      ctx.lineTo(1, -24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ead7a8';
      ctx.fillRect(-3, -24, 6, 24);
      ctx.fillStyle = '#6b4a22';
      ctx.font = `900 6px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('THIS WAY UP', 0, -4);
      ctx.beginPath();
      ctx.moveTo(-10, -9);
      ctx.lineTo(-7, -17);
      ctx.lineTo(-4, -9);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 30: { // Budget Wizard: crooked hat held together with tape
      ctx.fillStyle = '#5a4fcf';
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-13, -1);
      ctx.quadraticCurveTo(-8, -18, 2, -24);
      ctx.quadraticCurveTo(18, -26, 24, -20 + Math.sin(t * 3) * 1.4);
      ctx.quadraticCurveTo(10, -18, 13, -1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(3, -22);
      ctx.rotate(-0.35);
      ctx.fillStyle = 'rgba(220,220,220,0.92)';
      ctx.fillRect(-6, -3.5, 12, 7);
      ctx.restore();
      ctx.fillStyle = '#ffd23f';
      star(ctx, -5, -10, 3.6, 1.5);
      ctx.fill();
      break;
    }
    case 31: { // Noodle Nest
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(0, -2, 16, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-16, -3);
      ctx.quadraticCurveTo(-14, 7, 0, 7);
      ctx.quadraticCurveTo(14, 7, 16, -3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e63946';
      ctx.fillRect(-14, -1, 28, 2.4);
      for (const [w, col] of [[5.2, INK], [3, '#ffe08a']]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        for (const [x0, h] of [[-9, 14], [-3, 20], [4, 17], [10, 12]]) {
          ctx.beginPath();
          ctx.moveTo(x0, -3);
          ctx.bezierCurveTo(x0 - 8, -h, x0 + 9, -h - 4, x0 + 2, -3);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#8a5a3c';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(4, -12);
      ctx.lineTo(15, -27);
      ctx.moveTo(8, -12);
      ctx.lineTo(19, -25);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 2;
      for (const [x, ph] of [[-6, 0], [3, 1.7]]) {
        ctx.beginPath();
        for (let k = 0; k <= 8; k++) ctx.lineTo(x + Math.sin(t * 3 + ph + k * 0.9) * 2, -22 - k * 2.2);
        ctx.stroke();
      }
      break;
    }
    case 32: { // Pizza Slice
      ctx.save();
      ctx.translate(0, -12);
      ctx.rotate(-0.4 + Math.sin(t * 2) * 0.04);
      ctx.fillStyle = '#ffc94d';
      ctx.beginPath();
      ctx.moveTo(-20, 10);
      ctx.lineTo(20, 10);
      ctx.lineTo(0, -22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d98b3a';
      roundRect(ctx, -22, 7, 44, 8, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d62839';
      for (const [x, y, r] of [[-6, 0, 4], [6, -3, 3.6], [1, -12, 3], [10, 3, 3]]) {
        dot(ctx, x, y, r);
      }
      ctx.fillStyle = '#ffe9a0';
      ctx.beginPath();
      ctx.moveTo(-4, 10);
      ctx.quadraticCurveTo(-3, 20 + Math.sin(t * 4) * 1.2, 1, 17);
      ctx.quadraticCurveTo(3, 12, 3, 10);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 33: { // Robot Colander
      ctx.fillStyle = '#b8c0cc';
      ctx.beginPath();
      ctx.ellipse(0, 1, 17, 17, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * 19, -4, 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#5c6572';
      for (const [x, y] of [[-8, -14], [0, -16], [8, -14], [-12, -8], [12, -8], [-4, -10], [4, -10], [0, -5]]) dot(ctx, x, y, 1.3);
      const blink = t % 3.2 < 0.15 ? 0.2 : 1;
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(s * 7, -9, 4.4, 4.4 * blink, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#18d4f0';
        ctx.beginPath();
        ctx.ellipse(s * 7 + Math.sin(t * 2) * 1.2, -9, 2.1, 2.1 * blink, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 34: { // Emergency Chicken: squawks every few seconds
      const cyc = t % 4.5;
      const squawk = cyc < 0.45;
      const hop = squawk ? Math.abs(Math.sin(cyc * 28)) * 2.2 : 0;
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 5, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-4, -5, 8, 5);
      ctx.save();
      ctx.translate(squawk ? Math.sin(cyc * 60) * 0.8 : 0, -hop);
      ctx.fillStyle = '#ffe14a';
      ctx.beginPath();
      ctx.ellipse(-2, -13, 12, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(8, -22, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e63946';
      for (const x of [5, 8, 11]) dot(ctx, x, -28, 2);
      ctx.fillStyle = '#ff9f1c';
      const open = squawk ? 3 : 0.8;
      ctx.beginPath();
      ctx.moveTo(13, -23 - open);
      ctx.lineTo(20, -23 - open * 0.6);
      ctx.lineTo(13, -22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(13, -22);
      ctx.lineTo(19, -20 + open * 0.5);
      ctx.lineTo(13, -20 + open * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      dot(ctx, 8, -23, 1.3);
      ctx.fillStyle = '#ffd000';
      ctx.beginPath();
      ctx.moveTo(-14, -14);
      ctx.lineTo(-20, -9 + Math.sin(t * 4) * 1);
      ctx.lineTo(-10, -10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (squawk) label(ctx, 'BAWK!', 6, -38 - hop, 9, '#fff3b0');
      break;
    }
    case 35: { // Unpaid Unicorn: a rainbow horn held on with tape
      ctx.save();
      ctx.rotate(0.12);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.lineTo(0, -32);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#9b5de5'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.save();
        ctx.translate(0, -i * 6.4);
        ctx.rotate(-0.5);
        ctx.fillRect(-12, -2, 24, 3.4);
        ctx.restore();
      });
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.lineTo(0, -32);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(215,215,215,0.95)';
      ctx.fillRect(-9, -5, 18, 5);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-9, -5, 18, 5);
      ctx.restore();
      const tw = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.fillStyle = `rgba(255,255,255,${0.4 + tw * 0.6})`;
      star(ctx, 10, -30, 2 + tw * 3, 1);
      ctx.fill();
      break;
    }
    case 36: { // Burger Crown
      ctx.fillStyle = '#e0953a';
      ctx.beginPath();
      ctx.ellipse(0, -1, 17, 6, 0, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#6b3a1e';
      roundRect(ctx, -17, -9, 34, 7, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(-14, -9);
      ctx.lineTo(14, -9);
      ctx.lineTo(0, -4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8ac926';
      ctx.beginPath();
      ctx.moveTo(-18, -12);
      for (let x = -18; x <= 18; x += 6) ctx.quadraticCurveTo(x + 3, -6, x + 6, -12);
      ctx.lineTo(18, -16);
      ctx.lineTo(-18, -16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e63946';
      ctx.fillRect(-14, -18, 28, 3);
      ctx.fillStyle = '#e0953a';
      ctx.beginPath();
      ctx.ellipse(0, -19, 17, 11, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff3d6';
      for (const [x, y] of [[-8, -24], [0, -27], [8, -24], [-3, -21], [5, -20]]) {
        ctx.beginPath();
        ctx.ellipse(x, y, 1.8, 1, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(-8, -29);
      ctx.lineTo(-9, -37);
      ctx.lineTo(-4, -33);
      ctx.lineTo(0, -39);
      ctx.lineTo(4, -33);
      ctx.lineTo(9, -37);
      ctx.lineTo(8, -29);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 37: { // Tiny Crown: comically small, wobbles when you fall
      ctx.save();
      ctx.translate(3, 1);
      const wob = scared ? Math.sin(t * 24) * 0.55 : Math.sin(t * 1.5) * 0.05;
      ctx.rotate(0.15 + wob);
      ctx.translate(0, scared ? -Math.abs(Math.sin(t * 24)) * 3 : 0);
      ctx.scale(0.5, 0.5);
      ctx.lineWidth = 4;
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
      dot(ctx, 0, -5, 3.2);
      ctx.restore();
      break;
    }
    case 38: { // Alien Antenna
      for (const s of [-1, 1]) {
        const sw = Math.sin(t * 5 + (s > 0 ? 0 : 1.6)) * 3;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(s * 6, 0);
        ctx.quadraticCurveTo(s * 10 + sw, -12, s * 12 + sw * 1.6, -24);
        ctx.stroke();
        ctx.strokeStyle = '#59d36b';
        ctx.lineWidth = 2.4;
        ctx.stroke();
        glowOrb(ctx, s * 12 + sw * 1.6, -26, 11, '120,255,120', 0.35);
        ctx.fillStyle = '#7CFC00';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(s * 12 + sw * 1.6, -26, 4.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        dot(ctx, s * 12 + sw * 1.6 - 1.2, -27.5, 1.2);
      }
      break;
    }
    case 39: { // Spinning Siren
      const ph = Math.sin(t * 8);
      ctx.fillStyle = '#2b2d42';
      roundRect(ctx, -10, -4, 20, 6, 2);
      ctx.fill();
      ctx.stroke();
      glowOrb(ctx, 0, -12, 24, '255,40,40', 0.28 + 0.2 * Math.abs(ph));
      ctx.fillStyle = `rgb(${200 + 40 * Math.abs(ph) | 0},30,40)`;
      ctx.beginPath();
      ctx.ellipse(0, -4, 8.5, 11, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(ph * 4, -8, 2.2, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,80,80,${0.35 + 0.3 * Math.abs(ph)})`;
      for (const s of [-1, 1]) {
        if (ph * s < 0) continue;
        ctx.beginPath();
        ctx.moveTo(s * 8, -10);
        ctx.lineTo(s * 26, -16);
        ctx.lineTo(s * 26, -4);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 40: // Cursed Bucket
    case 43: { // Champion Bucket
      const gold = hat === 43;
      ctx.fillStyle = gold ? '#e8b923' : '#8d96a3';
      bucketShape(ctx, 12, 15, 24);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = gold ? '#fff0a3' : '#b5bdc9';
      ctx.beginPath();
      ctx.ellipse(0, -24, 12, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -24, 13, Math.PI, 0);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = gold ? '#c99700' : '#6b7480';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-13.5, -8);
      ctx.lineTo(13.5, -8);
      ctx.moveTo(-12.5, -16);
      ctx.lineTo(12.5, -16);
      ctx.stroke();
      if (gold) {
        const tw = 0.5 + 0.5 * Math.sin(t * 4);
        ctx.fillStyle = `rgba(255,255,255,${0.5 + tw * 0.5})`;
        star(ctx, 7, -17, 2.5 + tw * 3.5, 1);
        ctx.fill();
        label(ctx, '1st', -2, -11, 8, '#7a5a00', 'rgba(0,0,0,0)');
      } else {
        const pulse = 0.55 + 0.45 * Math.sin(t * 3);
        for (const s of [-1, 1]) {
          glowOrb(ctx, s * 5.5, -12, 9, '190,100,255', 0.5 * pulse);
          ctx.fillStyle = '#d9a7ff';
          ctx.beginPath();
          ctx.ellipse(s * 5.5, -12, 3.2, 3.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#2a0a4a';
          ctx.fillRect(s * 5.5 - 0.7, -14.4, 1.4, 4.8);
        }
      }
      break;
    }
    case 41: { // Angry Popcorn
      ctx.fillStyle = '#fffaf0';
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(12, 0);
      ctx.lineTo(15, -18);
      ctx.lineTo(-15, -18);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#fffaf0';
      for (let x = -15; x < 15; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x + 6.5, -18);
        ctx.lineTo(x + 1.5, -18);
        ctx.fill();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(12, 0);
      ctx.lineTo(15, -18);
      ctx.lineTo(-15, -18);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = '#fff3c4';
      for (const [x, y, r] of [[-10, -20, 5], [-3, -24, 5.6], [5, -22, 5.2], [11, -19, 4.4], [0, -19, 4.8]]) {
        dot(ctx, x, y, r);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      const pop = (t % 3) < 0.5 ? Math.sin(((t % 3) / 0.5) * Math.PI) * 9 : 0;
      ctx.fillStyle = '#fff3c4';
      dot(ctx, 9, -29 - pop, 3);
      ctx.fillStyle = '#fff';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * 5.5, -10, 3.4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = INK;
        dot(ctx, s * 5.5 - s * 0.6, -9.4, 1.4);
        ctx.fillStyle = '#fff';
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-10, -16);
      ctx.lineTo(-2.5, -12.4);
      ctx.moveTo(10, -16);
      ctx.lineTo(2.5, -12.4);
      ctx.moveTo(-4.5, -3.4);
      ctx.quadraticCurveTo(0, -6.5, 4.5, -3.4);
      ctx.stroke();
      break;
    }
    case 42: { // Trophy Head: a golden trophy worn upside down
      ctx.save();
      ctx.translate(0, -17);
      ctx.rotate(Math.PI + Math.sin(t * 2) * 0.04);
      ctx.fillStyle = '#ffd23f';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * 12, -9, 6, s > 0 ? -1.2 : Math.PI - 0.3, s > 0 ? 1.2 : Math.PI + 1.3, s < 0);
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-12, -17);
      ctx.lineTo(12, -17);
      ctx.quadraticCurveTo(12, 0, 3, -2);
      ctx.lineTo(-3, -2);
      ctx.quadraticCurveTo(-12, 0, -12, -17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(-2.5, -2, 5, 9);
      ctx.strokeRect(-2.5, -2, 5, 9);
      roundRect(ctx, -9, 7, 18, 8, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff3b0';
      star(ctx, 0, -10, 4.4, 1.8);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 44: { // Satellite Dish: slowly rotates
      ctx.fillStyle = '#8a8f99';
      ctx.fillRect(-1.8, -10, 3.6, 10);
      ctx.strokeRect(-1.8, -10, 3.6, 10);
      const a = t * 0.9;
      const c = Math.cos(a);
      ctx.save();
      ctx.translate(0, -19);
      ctx.rotate(-0.4);
      ctx.scale(Math.max(0.12, Math.abs(c)), 1);
      ctx.fillStyle = c >= 0 ? '#e5e9ef' : '#9aa3b0';
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (c >= 0) {
        ctx.fillStyle = '#c3cad4';
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (c >= 0) {
        ctx.strokeStyle = '#6b7480';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(0, -19);
        ctx.lineTo(7 * c, -30);
        ctx.stroke();
        ctx.fillStyle = '#e63946';
        dot(ctx, 7 * c, -30, 2.4);
      }
      break;
    }
    case 45: { // Tiny Dragon: a little dragon perched on your head
      const flap = Math.sin(t * 7) * 0.5;
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(-1, -14);
        ctx.rotate(s * (0.5 + flap * (s > 0 ? 1 : -1) * 0.5) - 0.2);
        ctx.fillStyle = '#e63946';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(s * 14, -13);
        ctx.lineTo(s * 17, -2);
        ctx.lineTo(s * 8, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = '#3ca55c';
      ctx.beginPath();
      ctx.moveTo(-8, -4);
      ctx.quadraticCurveTo(-24, -4, -21, -15);
      ctx.lineTo(-17, -13);
      ctx.quadraticCurveTo(-17, -8, -6, -9);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3ca55c';
      ctx.beginPath();
      ctx.ellipse(0, -9, 10, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c8f0a8';
      ctx.beginPath();
      ctx.ellipse(1, -6, 6, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3ca55c';
      ctx.beginPath();
      ctx.ellipse(9, -19, 7, 5.6, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(14, -19);
      ctx.lineTo(20, -17);
      ctx.lineTo(14, -15);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffe9a8';
      for (const x of [5, 9]) {
        ctx.beginPath();
        ctx.moveTo(x - 1.6, -24);
        ctx.lineTo(x, -29);
        ctx.lineTo(x + 1.6, -24);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      dot(ctx, 10, -20, 2.2);
      ctx.fillStyle = INK;
      dot(ctx, 10.6, -20, 1.1);
      const sm = t % 5;
      if (sm < 1.2) {
        for (let i = 0; i < 3; i++) {
          const k = sm * 1 + i * 0.3;
          ctx.fillStyle = `rgba(200,200,210,${Math.max(0, 0.7 - k * 0.5)})`;
          dot(ctx, 21 + k * 6, -19 - k * 5, 2 + k * 2);
        }
      }
      break;
    }
    case 46: { // The Prophecy: a floating, glowing question mark
      const bob = Math.sin(t * 2) * 3;
      glowOrb(ctx, 0, -30 + bob, 24, '255,225,110', 0.5);
      label(ctx, '?', 0, -30 + bob, 28, '#fff3b0');
      for (let i = 0; i < 3; i++) {
        const a = t * 1.8 + (i * Math.PI * 2) / 3;
        ctx.fillStyle = 'rgba(255,240,170,0.9)';
        star(ctx, Math.cos(a) * 16, -30 + bob + Math.sin(a) * 9, 2.6, 1);
        ctx.fill();
      }
      break;
    }
    case 47: { // The Forbidden Cheese
      ctx.fillStyle = '#ffcf3f';
      ctx.beginPath();
      ctx.moveTo(-19, 0);
      ctx.lineTo(19, 0);
      ctx.lineTo(19, -12);
      ctx.lineTo(-19, -27);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath();
      ctx.moveTo(-19, -27);
      ctx.lineTo(19, -12);
      ctx.lineTo(23, -15);
      ctx.lineTo(-14, -31);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0a800';
      for (const [x, y, rx, ry] of [[-10, -9, 4, 3], [6, -6, 3, 2.6], [-1, -14, 2.6, 2.2], [12, -10, 2.2, 1.8], [-14, -17, 2, 1.8]]) {
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const look = Math.sin(t * 1.3) * 1.2;
      const open = t % 4 < 0.2 ? 0.2 : 1;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(-10, -9, 4, 3 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b3123a';
      ctx.beginPath();
      ctx.ellipse(-10 + look, -9, 1.7, 1.7 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 48: { // Millionaire Hair
      const g = ctx.createLinearGradient(-20, -34, 20, 2);
      g.addColorStop(0, '#fff3b0');
      g.addColorStop(0.45, '#e0a100');
      g.addColorStop(1, '#ffd23f');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-18, 3);
      ctx.bezierCurveTo(-26, -10, -20, -26, -6, -28);
      ctx.bezierCurveTo(-4, -38, 14, -38, 16, -28);
      ctx.bezierCurveTo(28, -26, 28, -6, 18, 3);
      ctx.quadraticCurveTo(8, -6, 0, -4);
      ctx.quadraticCurveTo(-8, -6, -18, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(122,74,0,0.55)';
      ctx.lineWidth = 1.6;
      for (const [x0, x1] of [[-12, -4], [-2, 6], [8, 14]]) {
        ctx.beginPath();
        ctx.moveTo(x0, -6);
        ctx.quadraticCurveTo((x0 + x1) / 2 - 4, -24, x1, -30);
        ctx.stroke();
      }
      const tw = 0.5 + 0.5 * Math.sin(t * 3.4);
      ctx.fillStyle = `rgba(255,255,255,${0.5 + tw * 0.5})`;
      star(ctx, -8, -24, 2 + tw * 4, 1);
      ctx.fill();
      star(ctx, 14, -14, 2 + (1 - tw) * 3, 0.8);
      ctx.fill();
      label(ctx, '$', 3, -22, 11, '#2a7a2a', '#fff3b0');
      break;
    }
    case 49: { // Experiment 404: a bubbling flask
      ctx.fillStyle = 'rgba(200,235,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(-4, -26);
      ctx.lineTo(4, -26);
      ctx.lineTo(4, -16);
      ctx.lineTo(15, 0);
      ctx.lineTo(-15, 0);
      ctx.lineTo(-4, -16);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#58e04f';
      ctx.fillRect(-20, -10 + Math.sin(t * 3) * 0.8, 40, 14);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(-4, -26);
      ctx.lineTo(4, -26);
      ctx.lineTo(4, -16);
      ctx.lineTo(15, 0);
      ctx.lineTo(-15, 0);
      ctx.lineTo(-4, -16);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = '#b07a3a';
      roundRect(ctx, -4.6, -31, 9.2, 6, 1.5);
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.9 + i / 3) % 1;
        ctx.fillStyle = `rgba(190,255,170,${0.9 - k * 0.7})`;
        dot(ctx, -5 + i * 5 + Math.sin(t * 4 + i) * 1.5, -4 - k * 26, 1.8 + (1 - k) * 1.2);
      }
      label(ctx, '404', 0, -5, 7.5, '#fff', INK);
      break;
    }
    case 50: { // The Main Character: a dramatic floating spotlight
      const pulse = 0.85 + 0.15 * Math.sin(t * 3);
      const g = ctx.createLinearGradient(0, -52, 0, 4);
      g.addColorStop(0, `rgba(255,248,200,${0.55 * pulse})`);
      g.addColorStop(1, 'rgba(255,248,200,0.08)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-4, -46);
      ctx.lineTo(4, -46);
      ctx.lineTo(24, 4);
      ctx.lineTo(-24, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255,248,200,${0.4 * pulse})`;
      ctx.beginPath();
      ctx.ellipse(0, 3, 24, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(0, -50 + Math.sin(t * 2) * 2);
      ctx.rotate(Math.sin(t * 1.5) * 0.08);
      ctx.fillStyle = '#2b2d42';
      roundRect(ctx, -8, -9, 16, 12, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.ellipse(0, 3, 7, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e63946';
      dot(ctx, 0, -4, 1.6);
      ctx.restore();
      break;
    }
    case 51: { // UFO Abduction: the little alien waves every few seconds
      const bob = Math.sin(t * 2.2) * 2.5;
      const shimmer = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.fillStyle = `rgba(170,255,170,${0.16 + 0.1 * shimmer})`;
      ctx.beginPath();
      ctx.moveTo(-9, -22 + bob);
      ctx.lineTo(9, -22 + bob);
      ctx.lineTo(22, 4);
      ctx.lineTo(-22, 4);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.translate(0, -34 + bob);
      ctx.fillStyle = 'rgba(190,235,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(0, -3, 8.5, 9, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#6fd36f';
      ctx.beginPath();
      ctx.ellipse(0, -4, 4.6, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = INK;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * 2, -5, 1.2, 1.8, s * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      const waving = t % 6 < 2;
      ctx.strokeStyle = '#4fb34f';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(4, -2);
      ctx.lineTo(9 + (waving ? Math.sin(t * 14) * 1.5 : 0), waving ? -11 : -4);
      ctx.stroke();
      ctx.fillStyle = '#a8a8b8';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 2, 19, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const lights = ['#ff595e', '#ffca3a', '#8ac926', '#4cc9f0'];
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = Math.floor(t * 4) % 4 === i ? '#ffffff' : lights[i];
        dot(ctx, -11 + i * 7.3, 3.2, 1.7);
      }
      ctx.restore();
      break;
    }
    default:
      break;
  }
}
