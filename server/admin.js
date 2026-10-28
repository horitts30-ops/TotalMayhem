'use strict';

// ---------------------------------------------------------------------------
// The admin panel's lock.
//
//  * The secret code is NEVER written in the source code. It comes from the ADMIN_CODE
//    setting (an environment variable). If you do not set one, the server makes up a
//    random code each time it starts and prints it in the terminal (only you can see
//    that window).
//  * Wrong guesses are limited: 5 wrong tries from one address locks that address
//    out for 5 minutes (doubling each time it happens again), and there is a second,
//    server-wide limit so guessing from many addresses does not work either.
//  * The code is compared in constant time, so timing cannot leak it.
//  * A browser only gets admin powers after the server accepted the code on that
//    very connection. Closing the page ends it.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const MIN_LENGTH = 6;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters (0/O, 1/I)

function generateCode(len = 10) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

class AdminLock {
  /**
   * @param {string} wanted  the code from ADMIN_CODE (may be empty)
   * @param {{now?:Function}} opts  `now` is for the automated tests
   */
  constructor(wanted, opts = {}) {
    this.now = opts.now || Date.now;
    const given = typeof wanted === 'string' ? wanted.trim() : '';
    this.generated = given.length < MIN_LENGTH;
    this.tooShort = given.length > 0 && given.length < MIN_LENGTH;
    this.code = this.generated ? generateCode() : given;
    this.hash = digest(this.code);
    this.byKey = new Map(); // address -> { fails, lockedUntil, lockMs }
    this.global = { fails: 0, windowStart: this.now(), lockedUntil: 0 };
  }

  // Seconds this address (or everybody) is locked out, or 0.
  lockedFor(key) {
    const t = this.now();
    const a = this.byKey.get(key);
    const waits = [this.global.lockedUntil - t, a ? a.lockedUntil - t : 0];
    return Math.max(0, Math.ceil(Math.max(...waits) / 1000));
  }

  /** @returns {{ok:boolean, locked?:number}} */
  attempt(key, guess) {
    const locked = this.lockedFor(key);
    if (locked > 0) return { ok: false, locked };
    const t = this.now();
    const good = typeof guess === 'string' && guess.length <= 200 && crypto.timingSafeEqual(digest(guess.trim()), this.hash);
    if (good) {
      this.byKey.delete(key);
      return { ok: true };
    }
    // wrong guess: count it against this address and against the whole server
    let a = this.byKey.get(key);
    if (!a) {
      a = { fails: 0, lockedUntil: 0, lockMs: 5 * 60 * 1000 };
      this.byKey.set(key, a);
      if (this.byKey.size > 5000) this.byKey.delete(this.byKey.keys().next().value); // never grow without limit
    }
    a.fails += 1;
    if (a.fails >= 5) {
      a.lockedUntil = t + a.lockMs;
      a.lockMs = Math.min(a.lockMs * 2, 6 * 60 * 60 * 1000);
      a.fails = 0;
    }
    if (t - this.global.windowStart > 10 * 60 * 1000) {
      this.global.windowStart = t;
      this.global.fails = 0;
    }
    this.global.fails += 1;
    if (this.global.fails >= 30) {
      this.global.lockedUntil = t + 10 * 60 * 1000;
      this.global.fails = 0;
    }
    return { ok: false, locked: this.lockedFor(key) };
  }
}

// Announcements: plain text only, short, no control characters.
function cleanAnnouncement(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

module.exports = { AdminLock, generateCode, cleanAnnouncement, MIN_LENGTH };
