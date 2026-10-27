// ---------------------------------------------------------------------------
// The renderer draws everything with plain Canvas 2D code - no image files.
// That means every character, hat, tile and effect can be restyled by editing
// this file, and later swapped for real artwork if you want.
//
// This file only DRAWS. It never talks to the network and never decides who
// won anything; it just shows what the server says.
// ---------------------------------------------------------------------------

import { STAGE_W, STAGE_H, OX, OY, COLORS, THEMES, INK, ARENA_TILES } from './constants.js';

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
const HAT_HEIGHT = [0, 40, 22, 30, 30, 38, 34, 30, 42, 24, 24, 26, 28, 30, 24, 26, 24, 34, 28, 32, 28, 44];

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
    case 7: {
      // top hat
      ctx.fillStyle = '#2d2d3a';
      rr(ctx, -11, -27, 22, 26, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d62839';
      ctx.fillRect(-11, -11, 22, 7);
      ctx.strokeRect(-11, -11, 22, 7);
      ctx.fillStyle = '#2d2d3a';
      rr(ctx, -18, -3, 36, 7, 3.5);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 8: {
      // wizard hat
      ctx.fillStyle = '#6a4c93';
      ctx.beginPath();
      ctx.moveTo(-15, 0);
      ctx.quadraticCurveTo(-6, -14, 2, -38);
      ctx.quadraticCurveTo(7, -30, 15, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.ellipse(0, 1, 21, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(-2, -14, 2.6, 0, Math.PI * 2);
      ctx.arc(5, -22, 2, 0, Math.PI * 2);
      ctx.arc(-1, -26, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 9: {
      // cowboy hat
      ctx.fillStyle = '#a0642d';
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-9, -15);
      ctx.quadraticCurveTo(0, -10, 9, -15);
      ctx.lineTo(10, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#5a3a1a';
      ctx.fillRect(-10, -6, 20, 4);
      ctx.fillStyle = '#b97635';
      ctx.beginPath();
      ctx.moveTo(-25, -6);
      ctx.quadraticCurveTo(-14, 9, 0, 6);
      ctx.quadraticCurveTo(14, 9, 25, -6);
      ctx.quadraticCurveTo(14, -2, 0, -2);
      ctx.quadraticCurveTo(-14, -2, -25, -6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 10: {
      // viking helmet with horns
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#fff1cf';
        ctx.beginPath();
        ctx.moveTo(s * 13, -2);
        ctx.quadraticCurveTo(s * 27, -2, s * 26, -20);
        ctx.quadraticCurveTo(s * 19, -9, s * 10, -9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#b8bcc8';
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 14, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8a8fa0';
      rr(ctx, -17, -4, 34, 6, 3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 11: {
      // cat ears
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#2d2d3a';
        ctx.beginPath();
        ctx.moveTo(s * 3, 0);
        ctx.lineTo(s * 8, -22);
        ctx.lineTo(s * 19, -3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ff9ec7';
        ctx.beginPath();
        ctx.moveTo(s * 7, -3);
        ctx.lineTo(s * 9.5, -15);
        ctx.lineTo(s * 15, -4);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 12: {
      // halo
      const bob = Math.sin(t * 3) * 2;
      ctx.lineWidth = 8;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.ellipse(0, -16 + bob, 13, 4.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ffe34d';
      ctx.beginPath();
      ctx.ellipse(0, -16 + bob, 13, 4.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 13: {
      // beanie with pom-pom
      ctx.fillStyle = '#ff595e';
      ctx.beginPath();
      ctx.ellipse(0, -1, 17, 16, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffd166';
      rr(ctx, -18, -5, 36, 9, 4.5);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(42,26,60,0.45)';
      ctx.lineWidth = 2;
      for (let x = -12; x <= 12; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, -4);
        ctx.lineTo(x, 3);
        ctx.stroke();
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, -19, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 14: {
      // flower
      ctx.save();
      ctx.translate(9, -6);
      ctx.rotate(0.3);
      ctx.fillStyle = '#6bd36b';
      ctx.beginPath();
      ctx.ellipse(-9, 4, 8, 3.5, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ff7eb6';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 7, Math.sin(a) * 7 - 4, 5.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.arc(0, -4, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 15: {
      // pirate hat
      ctx.fillStyle = '#2d2d3a';
      ctx.beginPath();
      ctx.moveTo(-23, 3);
      ctx.quadraticCurveTo(-15, -24, 0, -20);
      ctx.quadraticCurveTo(15, -24, 23, 3);
      ctx.quadraticCurveTo(0, -5, -23, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-19, 1);
      ctx.quadraticCurveTo(0, -7, 19, 1);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, -11, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-5, -6);
      ctx.lineTo(5, -3);
      ctx.moveTo(5, -6);
      ctx.lineTo(-5, -3);
      ctx.stroke();
      break;
    }
    case 16: {
      // laurel wreath (achievement)
      const leaf = (x, y, rot, col) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, 7.5, 3.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
      for (let i = 0; i < 5; i++) {
        const th = Math.PI + 0.1 + i * 0.27;
        const lx = Math.cos(th) * 20;
        const ly = 9 + Math.sin(th) * 17;
        const col = i % 2 ? '#3fae49' : '#69d36b';
        leaf(lx, ly, th + Math.PI / 2 - 0.35, col);
        leaf(-lx, ly, -(th + Math.PI / 2 - 0.35), col);
      }
      ctx.fillStyle = '#ff4d6d';
      ctx.lineWidth = 2;
      for (const x of [-3.6, 3.6]) {
        ctx.beginPath();
        ctx.arc(x, -9, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 17: {
      // golden trophy (achievement)
      ctx.fillStyle = '#ffd23f';
      ctx.lineWidth = 3;
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * 12, -22);
        ctx.bezierCurveTo(sx * 24, -24, sx * 24, -10, sx * 9, -11);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-13, -27);
      ctx.lineTo(13, -27);
      ctx.bezierCurveTo(13, -12, 8, -9, 3, -9);
      ctx.lineTo(3, -4);
      ctx.lineTo(8, -4);
      ctx.lineTo(8, 1);
      ctx.lineTo(-8, 1);
      ctx.lineTo(-8, -4);
      ctx.lineTo(-3, -4);
      ctx.lineTo(-3, -9);
      ctx.bezierCurveTo(-8, -9, -13, -12, -13, -27);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-7, -23);
      ctx.quadraticCurveTo(-8, -15, -5, -13);
      ctx.stroke();
      ctx.fillStyle = '#ff4d6d';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.8;
      starPath(ctx, 0, -19, 4.8, 2.2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 18: {
      // hard hat (achievement)
      ctx.fillStyle = '#ffc400';
      ctx.beginPath();
      ctx.ellipse(0, -1, 18, 16, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(-3.5, -16.4, 7, 15);
      ctx.strokeRect(-3.5, -16.4, 7, 15);
      ctx.fillStyle = '#f59f00';
      rr(ctx, -23, -3, 46, 7, 3.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -9, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 19: {
      // space helmet (achievement): a glass bubble over the head
      ctx.fillStyle = 'rgba(170,228,255,0.34)';
      ctx.beginPath();
      ctx.ellipse(0, 6, 25, 25, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 6, 19, Math.PI * 1.12, Math.PI * 1.38);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.fillStyle = '#cfd8e3';
      rr(ctx, -27, 3, 54, 8, 4);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(16, -13);
      ctx.lineTo(23, -27);
      ctx.stroke();
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath();
      ctx.arc(23, -28, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 20: {
      // detective cap (achievement)
      ctx.fillStyle = '#8a6a3f';
      for (const sx of [-1, 1]) {
        rr(ctx, sx < 0 ? -26 : 12, -3, 14, 6, 3);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#c29a64';
      ctx.beginPath();
      ctx.ellipse(0, -1, 19, 15, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(100,66,28,0.55)';
      ctx.lineWidth = 2;
      for (const x of [-12, -4, 4, 12]) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, -18);
        ctx.stroke();
      }
      for (const y of [-5, -11]) {
        ctx.beginPath();
        ctx.moveTo(-20, y);
        ctx.lineTo(20, y);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, -1, 19, 15, 0, Math.PI, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = '#8a6a3f';
      ctx.beginPath();
      ctx.arc(0, -17, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 21: {
      // jester hat (achievement)
      const horn = (d, col) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(...d[0]);
        ctx.quadraticCurveTo(...d[1]);
        ctx.quadraticCurveTo(...d[2]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      horn([[-18, 1], [-32, -8, -27, -25], [-14, -14, -5, 1]], '#ff4d6d');
      horn([[18, 1], [32, -8, 27, -25], [14, -14, 5, 1]], '#3a86ff');
      horn([[-10, 1], [-12, -20, 0, -36], [12, -20, 10, 1]], '#8ac926');
      ctx.fillStyle = '#ffd23f';
      rr(ctx, -19, -3, 38, 7, 3.5);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 2;
      for (const [x, y] of [[-27, -26], [27, -26], [0, -37]]) {
        ctx.beginPath();
        ctx.arc(x, y, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
}

// ------------------------------------------------------------------ skins
function isDark(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

function heartPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.9, y - s * 1.3, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.9, y - s * 1.3, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
  ctx.closePath();
}

function starPath(ctx, x, y, R, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
}

// Draws a body pattern; the caller has already clipped to the body shape.
function drawSkin(ctx, skin, color) {
  if (!skin) return;
  const pat = isDark(color) ? mix(color, '#ffffff', 0.6) : mix(color, '#000000', 0.34);
  ctx.fillStyle = pat;
  ctx.strokeStyle = pat;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (skin) {
    case 1: // spots
      for (const [x, y, r] of [[-14, -45, 5.2], [11, -46, 4.4], [-18, -27, 4.6], [17, -26, 5.2], [-16, -10, 5.4], [15, -9, 4.6], [-5, -2, 3.8], [3, -51, 3.4]]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 2: // stripes
      for (const y of [-47, -39, -8, -1]) ctx.fillRect(-30, y, 60, 4.5);
      break;
    case 3: // hearts
      for (const [x, y, s] of [[-13, -44, 4.4], [13, -45, 4], [-17, -26, 4], [16, -24, 4.6], [-13, -9, 4.4], [13, -8, 4]]) {
        heartPath(ctx, x, y, s);
        ctx.fill();
      }
      break;
    case 4: // stars
      for (const [x, y, R] of [[-14, -45, 6.4], [12, -47, 5.4], [-18, -26, 5.4], [17, -25, 6.4], [-13, -9, 6], [14, -8, 5.2]]) {
        starPath(ctx, x, y, R, R * 0.45);
        ctx.fill();
      }
      break;
    case 5: // zigzag
      ctx.lineWidth = 3.8;
      for (const y of [-47, -9, -2]) {
        ctx.beginPath();
        for (let x = -26; x <= 26; x += 6.5) ctx.lineTo(x, y + (Math.round((x + 26) / 6.5) % 2 ? 3.5 : -3.5));
        ctx.stroke();
      }
      break;
    case 6: // checkers
      ctx.globalAlpha *= 0.55;
      for (let gy = -54; gy < 2; gy += 8) {
        for (let gx = -24; gx < 24; gx += 8) {
          if (((gx + 24) / 8 + (gy + 54) / 8) % 2 === 0) ctx.fillRect(gx, gy, 8, 8);
        }
      }
      break;
    case 7: // rainbow
      ctx.globalAlpha *= 0.55;
      ctx.save();
      ctx.rotate(-0.45);
      ['#ff595e', '#ff924c', '#ffca3a', '#8ac926', '#1982c4', '#9b5de5'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(-40, -60 + i * 9, 80, 9);
      });
      ctx.restore();
      break;
    case 8: // bubbles (achievement)
      ctx.lineWidth = 1.8;
      for (const [x, y, r] of [[-14, -42, 7], [12, -45, 5], [-18, -22, 5], [16, -24, 8], [-10, -8, 6], [8, -5, 4], [0, -30, 3.5]]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.26)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x - r * 0.35, y - r * 0.38, Math.max(1.1, r * 0.22), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fill();
      }
      break;
    case 9: {
      // flames (achievement)
      const tongue = (x, w, h, col) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x - w, 4);
        ctx.quadraticCurveTo(x - w, -h * 0.5, x + w * 0.2, -h);
        ctx.quadraticCurveTo(x + w, -h * 0.45, x + w, 4);
        ctx.closePath();
        ctx.fill();
      };
      for (const [x, w, h] of [[-23, 8, 24], [-11, 8, 36], [1, 9, 27], [13, 8, 40], [25, 7, 23]]) tongue(x, w, h, '#ff6b1a');
      for (const [x, w, h] of [[-23, 4.4, 14], [-11, 4.4, 22], [1, 5, 16], [13, 4.4, 24], [25, 4, 13]]) tongue(x, w, h, '#ffd23f');
      break;
    }
    case 10: {
      // galaxy (achievement)
      const g = ctx.createLinearGradient(-30, -54, 30, 2);
      g.addColorStop(0, 'rgba(28,18,92,0.82)');
      g.addColorStop(0.5, 'rgba(112,48,172,0.74)');
      g.addColorStop(1, 'rgba(18,70,142,0.82)');
      ctx.fillStyle = g;
      ctx.fillRect(-34, -58, 68, 64);
      ctx.fillStyle = '#fff';
      for (const [x, y, r] of [[-17, -44, 1.5], [9, -48, 1.2], [18, -36, 1.6], [-20, -26, 1.2], [-4, -30, 1.1], [14, -18, 1.4], [-12, -10, 1.6], [6, -6, 1.1], [-2, -50, 1]]) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffe9a8';
      starPath(ctx, -9, -38, 5, 1.8);
      ctx.fill();
      starPath(ctx, 15, -14, 4, 1.5);
      ctx.fill();
      break;
    }
    case 11: {
      // gold (achievement)
      const g = ctx.createLinearGradient(-30, -54, 30, 2);
      g.addColorStop(0, 'rgba(255,243,176,0.9)');
      g.addColorStop(0.35, 'rgba(255,210,63,0.88)');
      g.addColorStop(0.7, 'rgba(224,161,0,0.9)');
      g.addColorStop(1, 'rgba(255,226,122,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(-34, -58, 68, 64);
      ctx.save();
      ctx.rotate(-0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(-40, -34, 80, 6);
      ctx.fillRect(-40, -22, 80, 2.5);
      ctx.restore();
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
    x, y, color, hat = 0, skin = 0, fx = 0, fy = 1, sx = 1, sy = 1, walk = 0, alpha = 1, rot = 0, mood = 'normal', t = 0,
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
  if (skin) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, -26, 21, 26, 0, 0, Math.PI * 2);
    ctx.clip();
    drawSkin(ctx, skin, color);
    ctx.restore();
    // save/restore does not remember the current path, so rebuild the body
    // outline before stroking it.
    ctx.beginPath();
    ctx.ellipse(0, -26, 21, 26, 0, 0, Math.PI * 2);
  }
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
    this.quality = 1; // 0.5 - 1; main.js lowers it automatically if the game runs slowly
    this.cssScale = 1;
    this.tileLayer = null; // offscreen picture of the floor that is not cracking
    this.tileSig = '';
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
    if (cssScale) this.cssScale = cssScale;
    const dpr = window.devicePixelRatio || 1;
    // Capped at 1.5x: beyond that the picture is barely sharper but costs a lot
    // more to paint. `quality` lowers it further when a computer struggles.
    this.px = clamp(this.cssScale * dpr * this.quality, 0.5, 1.5);
    this.canvas.width = Math.round(STAGE_W * this.px);
    this.canvas.height = Math.round(STAGE_H * this.px);
    this.tileSig = ''; // the cached floor must be repainted at the new size
  }

  setQuality(q) {
    const next = clamp(q, 0.5, 1);
    if (Math.abs(next - this.quality) < 0.01) return false;
    this.quality = next;
    this.resize();
    return true;
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
   *   meta: Map(id -> {name,color,hat,skin}),
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

    const arena = frame.latest && frame.latest.gid && frame.latest.gid !== 'crumbleFloor';
    if (arena) {
      // Open-arena minigame: a flat floor, plus whatever this game puts on it.
      const flat = { ...frame, tiles: ARENA_TILES };
      this.trackTiles(flat);
      this.drawTiles(ctx, flat, theme);
      this.drawArenaGame(ctx, frame, dt);
    } else {
      this.trackTiles(frame);
      this.drawTiles(ctx, frame, theme);
      this.drawFallingTiles(ctx, dt, theme);
      this.drawPuddles(ctx, frame);
    }
    this.drawEntities(ctx, frame, dt);
    this.drawParticles(ctx, dt);

    ctx.restore();

    if (arena && frame.latest.blind) this.drawBlindfold(ctx, frame.latest.bt || 1);

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

  // The floor is mostly standing tiles that never change, so they are painted
  // ONCE into an offscreen picture and then copied each frame. Only tiles that
  // are cracking (and their neighbours, which overlap them) are painted live.
  drawTiles(ctx, frame, theme) {
    const { tiles, cols } = frame;
    // Cache key: which tiles stand perfectly still / are holes (cracking tiles
    // all look like "_" here because they are drawn live).
    const sig = `${frame.theme}|${this.canvas.width}|${tiles.replace(/[1-9]/g, '_')}`;
    if (sig !== this.tileSig || !this.tileLayer) {
      if (!this.tileLayer) this.tileLayer = document.createElement('canvas');
      this.tileLayer.width = this.canvas.width;
      this.tileLayer.height = this.canvas.height;
      const lc = this.tileLayer.getContext('2d');
      lc.setTransform(this.px, 0, 0, this.px, 0, 0);
      this.paintTiles(lc, tiles, cols, theme, (ch) => ch === '0' || ch === 'x');
      this.tileSig = sig;
    }
    ctx.drawImage(this.tileLayer, 0, 0, STAGE_W, STAGE_H); // keeps the current transform (screen shake)

    // Live part: cracking tiles, plus the still tiles that are drawn after (and
    // so overlap) a cracking one - repainted on top to keep the same layering.
    let any = false;
    const redo = new Set();
    for (let i = 0; i < tiles.length; i++) {
      const ch = tiles[i];
      if (ch === '0' || ch === 'x' || ch === '_') continue;
      any = true;
      redo.add(i);
      for (const j of [i + 1, i + cols - 1, i + cols, i + cols + 1]) redo.add(j);
    }
    if (!any) return;
    this.paintTiles(ctx, tiles, cols, theme, (ch, i) => redo.has(i) && ch !== 'x' && ch !== '_', true);
  }

  // Paints tiles in the usual order. `pick(ch, i)` chooses which ones to paint.
  paintTiles(ctx, tiles, cols, theme, pick, skipPits = false) {
    if (!skipPits) {
      for (let i = 0; i < tiles.length; i++) {
        if (tiles[i] !== 'x') continue;
        const c = i % cols;
        const r = Math.floor(i / cols);
        ctx.fillStyle = 'rgba(15,5,40,0.38)';
        rr(ctx, OX + c * TILE + 3, OY + r * TILE + 3, TILE - 6, TILE - 6, 10);
        ctx.fill();
      }
    }
    for (let i = 0; i < tiles.length; i++) {
      const ch = tiles[i];
      if (ch === 'x' || ch === '_' || !pick(ch, i)) continue;
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

    // little decorations that give each floor its own personality
    if (theme.deco) this.drawTileDeco(ctx, theme.deco, x + sx, y + sy, idx);

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

  drawTileDeco(ctx, kind, x, y, idx) {
    const rnd = mulberry32(idx * 31 + 7);
    ctx.save();
    switch (kind) {
      case 'sprinkles': {
        const cols = ['#ff5fa2', '#5fd3ff', '#ffd23f', '#8be05a'];
        for (let i = 0; i < 6; i++) {
          ctx.save();
          ctx.translate(x + 10 + rnd() * (TILE - 20), y + 14 + rnd() * (TILE - 28));
          ctx.rotate(rnd() * Math.PI);
          ctx.fillStyle = cols[i % cols.length];
          rr(ctx, -4, -1.6, 8, 3.2, 1.6);
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'plates': {
        ctx.strokeStyle = 'rgba(52,58,88,0.35)';
        ctx.lineWidth = 2;
        rr(ctx, x + 12, y + 18, TILE - 28, TILE - 34, 5);
        ctx.stroke();
        ctx.fillStyle = 'rgba(52,58,88,0.4)';
        for (const [bx, by] of [[x + 9, y + 12], [x + TILE - 13, y + 12], [x + 9, y + TILE - 14], [x + TILE - 13, y + TILE - 14]]) {
          ctx.beginPath();
          ctx.arc(bx, by, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'embers': {
        for (let i = 0; i < 4; i++) {
          const ex = x + 10 + rnd() * (TILE - 20);
          const ey = y + 16 + rnd() * (TILE - 30);
          ctx.fillStyle = i % 2 ? 'rgba(255,170,60,0.85)' : 'rgba(255,100,40,0.75)';
          ctx.beginPath();
          ctx.arc(ex, ey, 1.8 + rnd() * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'leaves': {
        ctx.fillStyle = 'rgba(40,90,20,0.38)';
        for (let i = 0; i < 3; i++) {
          ctx.save();
          ctx.translate(x + 12 + rnd() * (TILE - 24), y + 16 + rnd() * (TILE - 30));
          ctx.rotate(rnd() * Math.PI * 2);
          ctx.beginPath();
          ctx.ellipse(0, 0, 7, 3.2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  // ------------------------------------------------ open-arena minigames
  drawArenaGame(ctx, frame, dt) {
    const snap = frame.latest;
    if (snap.zone) this.drawHill(ctx, frame, snap.zone);
    if (snap.cn) this.drawCoins(ctx, snap.cn);
    if (snap.mt) this.drawMeteors(ctx, snap.mt);
    if (snap.crown && !snap.crown.hd) this.drawCrownOnFloor(ctx, snap.crown);
  }

  // Meteor Mayhem: a red circle that fills up, then BAM.
  drawMeteors(ctx, list) {
    for (const [id, x, y, r, f] of list) {
      const X = OX + x;
      const Y = OY + y;
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * (8 + f * 14));
      ctx.save();
      ctx.translate(X, Y);
      ctx.scale(1, 0.78);
      // the warning disc grows from the middle
      ctx.fillStyle = `rgba(255,70,60,${0.16 + 0.12 * pulse})`;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,70,60,${0.28 + 0.25 * f})`;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(4, r * f), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = f > 0.7 ? '#ffffff' : '#ff4d4d';
      ctx.lineWidth = 5;
      ctx.setLineDash([16, 10]);
      ctx.lineDashOffset = -this.clock * 60;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // the rock itself drops in from above
      const fall = Math.pow(f, 2.2);
      const my = Y - 18 - (1 - fall) * 360;
      const sc = 0.55 + 0.45 * fall;
      ctx.save();
      ctx.translate(X, my);
      ctx.scale(sc, sc);
      ctx.fillStyle = 'rgba(255,150,40,0.55)';
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.lineTo(0, -70 - (1 - fall) * 40);
      ctx.lineTo(10, -4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#6b5b6e';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-18, 2);
      ctx.lineTo(-12, -14);
      ctx.lineTo(4, -18);
      ctx.lineTo(18, -6);
      ctx.lineTo(12, 10);
      ctx.lineTo(-8, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(-4, -7, 5, 3, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Crown Chaos: the crown lying on the floor (it sparkles, and spins when flying).
  drawCrownOnFloor(ctx, c) {
    const X = OX + c.x;
    const Y = OY + c.y;
    const bob = c.mv ? 0 : Math.sin(this.clock * 4) * 3;
    ctx.fillStyle = 'rgba(20,5,40,0.25)';
    ctx.beginPath();
    ctx.ellipse(X, Y + 4, 17, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(X, Y - 14, 3, X, Y - 14, 46);
    g.addColorStop(0, 'rgba(255,240,120,0.55)');
    g.addColorStop(1, 'rgba(255,240,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X, Y - 14, 46, 0, Math.PI * 2);
    ctx.fill();
    this.crownShape(ctx, X, Y - 12 + bob, 1.25, c.mv ? this.clock * 9 : 0);
  }

  // The crown shape itself (also used on the wearer's head). `heat` makes it glow red.
  crownShape(ctx, x, y, scale = 1, spin = 0, heat = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * (spin ? Math.max(0.25, Math.abs(Math.cos(spin))) : 1), scale);
    ctx.lineJoin = 'round';
    ctx.fillStyle = heat > 0.6 && Math.sin(this.clock * 20) > 0 ? '#ff7a3d' : '#ffd23f';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-14, 8);
    ctx.lineTo(-16, -10);
    ctx.lineTo(-7, -2);
    ctx.lineTo(0, -14);
    ctx.lineTo(7, -2);
    ctx.lineTo(16, -10);
    ctx.lineTo(14, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff4d8d';
    ctx.beginPath();
    ctx.arc(0, 1, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4dd2ff';
    ctx.beginPath();
    ctx.arc(-8, 3, 2, 0, Math.PI * 2);
    ctx.arc(8, 3, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Prop Hunt: one prop, standing on the floor at (x, y). Types match the
  // server's list: 0 crate, 1 barrel, 2 plant, 3 rock, 4 gift, 5 cactus.
  drawProp(ctx, x, y, type, mine = false) {
    const X = OX + x;
    const Y = OY + y;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    // shadow
    ctx.fillStyle = 'rgba(20,5,40,0.28)';
    ctx.beginPath();
    ctx.ellipse(X, Y + 3, 22, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(X, Y);
    switch (type % 6) {
      case 0: // crate
        ctx.fillStyle = '#c98a4b';
        rr(ctx, -20, -40, 40, 40, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#a56d33';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-17, -37);
        ctx.lineTo(17, -3);
        ctx.moveTo(17, -37);
        ctx.lineTo(-17, -3);
        ctx.stroke();
        ctx.strokeRect(-14, -34, 28, 28);
        break;
      case 1: // barrel
        ctx.fillStyle = '#8f5a34';
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        ctx.quadraticCurveTo(-24, -22, -16, -44);
        ctx.lineTo(16, -44);
        ctx.quadraticCurveTo(24, -22, 16, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#4a4a5c';
        ctx.lineWidth = 4;
        for (const yy of [-34, -10]) {
          ctx.beginPath();
          ctx.moveTo(-21, yy);
          ctx.quadraticCurveTo(0, yy + 5, 21, yy);
          ctx.stroke();
        }
        ctx.strokeStyle = INK;
        ctx.fillStyle = '#b57a4a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, -44, 16, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 2: // potted plant
        ctx.fillStyle = '#3fae5a';
        for (const [lx, ly, rot] of [[-12, -42, -0.5], [0, -50, 0], [12, -42, 0.5]]) {
          ctx.save();
          ctx.translate(lx * 0.6, -18);
          ctx.rotate(rot);
          ctx.beginPath();
          ctx.ellipse(0, ly + 18, 8, 17, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = '#d9714b';
        ctx.beginPath();
        ctx.moveTo(-15, -22);
        ctx.lineTo(15, -22);
        ctx.lineTo(11, 0);
        ctx.lineTo(-11, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e88a63';
        rr(ctx, -17, -27, 34, 8, 3);
        ctx.fill();
        ctx.stroke();
        break;
      case 3: // rock
        ctx.fillStyle = '#9aa0ae';
        ctx.beginPath();
        ctx.moveTo(-22, 0);
        ctx.quadraticCurveTo(-26, -22, -10, -34);
        ctx.quadraticCurveTo(6, -42, 18, -26);
        ctx.quadraticCurveTo(28, -10, 22, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.ellipse(-7, -26, 6, 4, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#6a7080';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(6, -20);
        ctx.lineTo(10, -10);
        ctx.stroke();
        break;
      case 4: // gift box
        ctx.fillStyle = '#ff5d73';
        rr(ctx, -19, -34, 38, 34, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(-4, -34, 8, 34);
        ctx.strokeRect(-4, -34, 8, 34);
        ctx.fillStyle = '#ff7f90';
        rr(ctx, -22, -44, 44, 12, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.ellipse(-7, -50, 8, 5.5, -0.4, 0, Math.PI * 2);
        ctx.ellipse(7, -50, 8, 5.5, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      default: // cactus
        ctx.fillStyle = '#4cbf6a';
        rr(ctx, -9, -46, 18, 46, 9);
        ctx.fill();
        ctx.stroke();
        rr(ctx, -21, -32, 10, 20, 5);
        ctx.fill();
        ctx.stroke();
        rr(ctx, 11, -38, 10, 22, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ff6fb5';
        ctx.beginPath();
        ctx.arc(0, -48, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
    }
    ctx.restore();

    if (mine) {
      // Only YOUR browser draws this: it is how you find yourself among the props.
      const bounce = Math.sin(this.clock * 6) * 3;
      ctx.save();
      ctx.fillStyle = '#fff27a';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(X - 9, Y - 74 + bounce);
      ctx.lineTo(X + 9, Y - 74 + bounce);
      ctx.lineTo(X, Y - 62 + bounce);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.font = `900 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeText('YOU', X, Y - 80 + bounce);
      ctx.fillStyle = '#fff';
      ctx.fillText('YOU', X, Y - 80 + bounce);
      ctx.restore();
    }
  }

  // A magnifying glass over a seeker's head (orange for a helper who was found).
  drawSeekerBadge(ctx, X, Y, helper) {
    ctx.save();
    ctx.translate(X, Y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(5, 5);
    ctx.lineTo(13, 13);
    ctx.stroke();
    ctx.strokeStyle = helper ? '#ff9a3d' : '#ff4d6d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(5, 5);
    ctx.lineTo(13, 13);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = helper ? '#ff9a3d' : '#ff4d6d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Seekers cannot see during the hiding time: cover the whole arena.
  drawBlindfold(ctx, secs) {
    ctx.save();
    ctx.fillStyle = 'rgba(26,15,46,0.94)';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.font = `900 56px ${FONT}`;
    ctx.lineWidth = 9;
    ctx.strokeStyle = INK;
    ctx.fillStyle = '#fff27a';
    ctx.strokeText('Eyes closed!', STAGE_W / 2, STAGE_H / 2 - 40);
    ctx.fillText('Eyes closed!', STAGE_W / 2, STAGE_H / 2 - 40);
    ctx.font = `900 30px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('The hiders are hiding...', STAGE_W / 2, STAGE_H / 2 + 8);
    ctx.font = `900 120px ${FONT}`;
    ctx.lineWidth = 12;
    ctx.fillStyle = '#ff8fab';
    ctx.strokeText(String(secs), STAGE_W / 2, STAGE_H / 2 + 130);
    ctx.fillText(String(secs), STAGE_W / 2, STAGE_H / 2 + 130);
    ctx.restore();
  }

  drawCoins(ctx, coins) {
    for (const [id, x, y, jackpot, life, dropped] of coins) {
      const X = OX + x;
      const bob = Math.sin(this.clock * 4 + id) * 2.5;
      const Y = OY + y - 14 + bob;
      const R = jackpot ? 20 : 13;
      // shadow
      ctx.fillStyle = 'rgba(20,5,40,0.25)';
      ctx.beginPath();
      ctx.ellipse(X, OY + y + 4, R * 0.9, R * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      if (jackpot) {
        // glow + shrinking "time left" ring
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 6);
        const g = ctx.createRadialGradient(X, Y, 4, X, Y, 44);
        g.addColorStop(0, `rgba(255,240,120,${0.55 + 0.25 * pulse})`);
        g.addColorStop(1, 'rgba(255,240,120,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(X, Y, 44, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = life < 0.25 ? '#ff595e' : '#ffffff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(X, Y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * life);
        ctx.stroke();
      }

      // the coin spins around its vertical axis
      const spin = Math.abs(Math.cos(this.clock * 3.2 + id * 1.7));
      const w = Math.max(0.18, spin) * R;
      ctx.lineJoin = 'round';
      ctx.fillStyle = jackpot ? '#ffd23f' : dropped ? '#ffe27a' : '#ffd23f';
      ctx.strokeStyle = INK;
      ctx.lineWidth = jackpot ? 4 : 3;
      ctx.beginPath();
      ctx.ellipse(X, Y, w, R, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (w > R * 0.5) {
        ctx.strokeStyle = '#d19a00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(X, Y, w * 0.62, R * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (jackpot) {
          ctx.fillStyle = '#d19a00';
          this.star(ctx, X, Y, R * 0.5, R * 0.22);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.ellipse(X - w * 0.35, Y - R * 0.4, w * 0.18, R * 0.22, -0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawHill(ctx, frame, z) {
    const X = OX + z.x;
    const Y = OY + z.y;
    const meta = z.hd ? frame.meta.get(z.hd) : null;
    let base = '#fff27a';
    if (z.ct) base = '#ff595e';
    else if (meta) base = COLORS[meta.color % COLORS.length].hex;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * (z.ct ? 12 : 3));

    // warning for where the hill will hop to next
    if (z.next) {
      const nx = OX + z.next.x;
      const ny = OY + z.next.y;
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.4 * pulse})`;
      ctx.lineWidth = 5;
      ctx.setLineDash([14, 12]);
      ctx.lineDashOffset = -this.clock * 50;
      ctx.beginPath();
      ctx.ellipse(nx, ny, z.r, z.r * 0.78, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,255,255,${0.1 + 0.2 * z.next.f})`;
      ctx.beginPath();
      ctx.ellipse(nx, ny, z.r * z.next.f, z.r * 0.78 * z.next.f, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `900 22px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 5;
      ctx.strokeStyle = INK;
      ctx.strokeText('NEXT', nx, ny + 7);
      ctx.fillStyle = '#fff';
      ctx.fillText('NEXT', nx, ny + 7);
      ctx.restore();
    }

    // the hill itself (squashed a little so it reads as lying on the floor)
    ctx.save();
    ctx.translate(X, Y);
    ctx.scale(1, 0.78);
    const g = ctx.createRadialGradient(0, 0, z.r * 0.1, 0, 0, z.r);
    g.addColorStop(0, mix(base, '#ffffff', 0.55));
    g.addColorStop(1, base);
    ctx.globalAlpha = 0.58 + 0.12 * pulse;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, z.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.setLineDash([22, 14]);
    ctx.lineDashOffset = this.clock * 40;
    ctx.beginPath();
    ctx.arc(0, 0, z.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, z.r + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // a little crown on the hill when someone owns it
    if (z.hd && !z.ct) {
      const cy = Y - 6 + Math.sin(this.clock * 3) * 3;
      ctx.fillStyle = '#ffd700';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(X - 16, cy + 8);
      ctx.lineTo(X - 18, cy - 10);
      ctx.lineTo(X - 8, cy - 2);
      ctx.lineTo(X, cy - 14);
      ctx.lineTo(X + 8, cy - 2);
      ctx.lineTo(X + 18, cy - 10);
      ctx.lineTo(X + 16, cy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // The bomb a player is carrying. It flashes faster as the fuse runs down.
  drawBomb(ctx, x, y, bomb) {
    const fuse = bomb ? bomb.fuse : 5;
    const rate = fuse < 2 ? 18 : fuse < 4 ? 10 : 5;
    const flash = 0.5 + 0.5 * Math.sin(this.clock * rate);
    const danger = fuse < 3;
    ctx.save();
    ctx.translate(x, y + Math.sin(this.clock * 6) * 2);
    ctx.lineJoin = 'round';
    // glow
    const gl = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
    gl.addColorStop(0, `rgba(255,80,40,${danger ? 0.35 + 0.4 * flash : 0.2})`);
    gl.addColorStop(1, 'rgba(255,80,40,0)');
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = danger && flash > 0.6 ? '#7a1f1f' : '#2d2d3a';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(-5, -6, 4, 2.6, -0.6, 0, Math.PI * 2);
    ctx.fill();
    // fuse + spark
    ctx.strokeStyle = '#c9a66b';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(4, -13);
    ctx.quadraticCurveTo(10, -22, 6, -26);
    ctx.stroke();
    ctx.fillStyle = flash > 0.5 ? '#ffe66d' : '#ff8a3d';
    this.star(ctx, 6, -27, 7 + flash * 3, 2.5);
    ctx.fill();
    // seconds left
    ctx.font = `900 14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    const txt = Math.ceil(fuse).toString();
    ctx.strokeText(txt, 0, 5);
    ctx.fillStyle = danger ? '#ff8a8a' : '#fff';
    ctx.fillText(txt, 0, 5);
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
    // (A player who is currently disguised as a prop is drawn as a prop below, not as a blob.)
    const bodies = list.filter((p) => p.st !== 'ghost' && !p.dg);

    // shadows first
    for (const p of bodies) {
      if (p.st === 'falling') continue;
      const h = clamp(p.z / 90, 0, 1);
      ctx.fillStyle = `rgba(20,5,40,${0.28 * (1 - h * 0.6)})`;
      ctx.beginPath();
      ctx.ellipse(OX + p.x, OY + p.y + 3, 21 * (1 - h * 0.35), 8.5 * (1 - h * 0.35), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Props (Prop Hunt) and players are drawn together, back to front, so a
    // player can really walk behind a crate.
    const items = bodies.map((p) => ({ y: p.y, draw: () => this.drawPlayer(ctx, p, frame, dt) }));
    const props = frame.latest && frame.latest.props;
    if (props) {
      const me = frame.players.find((p) => p.id === frame.myId && p.dg);
      let mineIdx = -1;
      if (me) {
        let best = 40;
        props.forEach((q, i) => {
          const d = Math.hypot(q[0] - me.x, q[1] - me.y);
          if (d < best) {
            best = d;
            mineIdx = i;
          }
        });
      }
      props.forEach((q, i) => items.push({ y: q[1], draw: () => this.drawProp(ctx, q[0], q[1], q[2], i === mineIdx) }));
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
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
    } else if (p.md) {
      mood = p.md; // arena games: 'scared' for the bomb holder, 'happy' for the winner
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
      x: X, y: Y, color, hat: meta.hat, skin: meta.skin || 0, fx: p.fx, fy: p.fy, sx, sy, walk: s.walk, alpha, rot, mood, t: this.clock,
    });

    if (p.bm) this.drawBomb(ctx, X + 24, Y - 34, frame.latest.bomb);

    // Prop Hunt: a blindfold on the seeker while the hiders hide
    if (p.rl && frame.latest.hl > 0) {
      ctx.fillStyle = INK;
      rr(ctx, X - 20, Y - 41 * sy, 40, 15, 6);
      ctx.fill();
    }
    // Crown Chaos: the wearer's crown sits on top of everything (it glows when it is about to overheat)
    if (p.cr) {
      const top = Math.max(52, 48 + (HAT_HEIGHT[meta.hat] || 0));
      const heat = frame.latest.crown ? frame.latest.crown.heat : 0;
      this.crownShape(ctx, X, Y - (top - 2) * sy, 1.1 + 0.1 * Math.sin(this.clock * 8), 0, heat);
    }

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
      if (p.rl) this.drawSeekerBadge(ctx, X + (meta.name.length * 4.3 + 18), Y - (top + 16) * sy - 4, !!p.hp);
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
    x: 0, y: -bob, color: COLORS[look.color % COLORS.length].hex, hat: look.hat, skin: look.skin || 0, fx: 0, fy: 1,
    sx: 1 + Math.sin(t * 6) * 0.02, sy: 1 - Math.sin(t * 6) * 0.02, walk: 0, mood, t,
  });
  ctx.restore();
}
