'use strict';

const crypto = require('crypto');

// Room codes use consonants only, so a random code can never spell a word.
const CODE_LETTERS = 'BCDFGHJKMNPQRSTVWXZ';

const SILLY_NAMES = [
  'Wobbles', 'Noodle', 'Gizmo', 'Biscuit', 'Pickle', 'Waffles', 'Bumble',
  'Turnip', 'Muffin', 'Doodle', 'Pogo', 'Nugget', 'Blobert', 'Sprocket',
];

function randomId(bytes = 4) {
  return crypto.randomBytes(bytes).toString('hex');
}

function makeRoomCode(isTaken) {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
    }
    if (!isTaken(code)) return code;
  }
  return null;
}

function normalizeCode(raw) {
  return String(raw == null ? '' : raw)
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4);
}

function cleanName(raw) {
  // Remove control characters and angle brackets, collapse spaces, cap length.
  const s = String(raw == null ? '' : raw)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return s;
}

function randomSillyName() {
  return SILLY_NAMES[crypto.randomInt(SILLY_NAMES.length)];
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// Turns anything into a finite number inside [lo, hi] (or 0 if it is junk).
function safeNumber(v, lo, hi) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return clamp(n, lo, hi);
}

function safeInt(v, lo, hi, fallback) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return clamp(Math.floor(v), lo, hi);
}

module.exports = {
  randomId,
  makeRoomCode,
  normalizeCode,
  cleanName,
  randomSillyName,
  clamp,
  safeNumber,
  safeInt,
};
