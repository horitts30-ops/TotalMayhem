'use strict';

// ---------------------------------------------------------------------------
// Text chat between rounds. Safety rules, all enforced by the SERVER:
//   * only in the lobby, the results screen, the pit stop and the final scoreboard (never mid-round)
//   * plain text, max 140 characters, control characters removed
//   * at most 1 message per 1.2 seconds and 5 per 10 seconds per player
//   * a basic swear-word filter (see BAD_WORDS: add your own; it is NOT perfect)
//   * the host of the SERVER can switch chat off for everybody in the admin panel
// The browser shows messages with textContent, so nothing a player types can ever become HTML.
// ---------------------------------------------------------------------------

const MAX_LENGTH = 140;
const MIN_GAP_MS = 1200;
const BURST = 5;
const BURST_WINDOW_MS = 10000;
const HISTORY = 40;
const CHAT_PHASES = new Set(['lobby', 'results', 'pitstop', 'final']);

// Lower case. A match anywhere inside a word is masked (so "shitty" becomes "*****y"). Extend as you like.
const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dickhead', 'bastard', 'slut', 'whore', 'wanker'];

// Common look-alike swaps people use to dodge filters: f*ck, sh1t, b!tch ...
const LOOK_ALIKE = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', $: 's', '5': 's', '7': 't' };
const SUFFIX = '(?:s|es|ed|er|ers|ing|in|y|ty|face|head)?';

// "Assholee", "sh1tty" and "fuuuck" all collapse to the same shape as the word list.
const shape = (w) => w.replace(/(.)\1+/g, '$1');
const BAD_PATTERNS = BAD_WORDS.map((w) => new RegExp(`^${shape(w)}${SUFFIX}$`));

function matches(token) {
  let norm = '';
  for (const ch of token.toLowerCase()) {
    const c = ch in LOOK_ALIKE ? LOOK_ALIKE[ch] : ch;
    if (/[a-z]/.test(c)) norm += c;
  }
  if (norm.length < 3) return false;
  const sh = shape(norm);
  return BAD_PATTERNS.some((re) => re.test(sh));
}

function isBad(token) {
  const forms = new Set([token, token.replace(/[!*$@]+$/, '')]); // "shit!" is shit shouted, not a leet-speak i
  for (const f of forms) {
    if (f.includes('*')) {
      for (const v of 'aeiou') if (matches(f.replace(/\*/g, v))) return true; // f*ck
    }
    if (matches(f.replace(/\*/g, ''))) return true;
  }
  return false;
}

// Masks whole words that are swear words (this is a basic filter: it works word by word, so it does not
// flag innocent words that merely contain a swear word, and it does not catch "f u c k" spelled with spaces).
function maskBadWords(text) {
  return text
    .split(/(\s+)/)
    .map((tok) => (/\S/.test(tok) && isBad(tok.replace(/^[^\w@$!*]+|[^\w@$!*]+$/g, '')) ? tok.replace(/[A-Za-z0-9@$]/g, '*') : tok))
    .join('');
}

function cleanChat(text, { filter = true } = {}) {
  if (typeof text !== 'string') return '';
  let t = text
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ') // control + invisible direction tricks
    .replace(/\s+/g, ' ')
    .trim();
  t = Array.from(t).slice(0, MAX_LENGTH).join('');
  return filter ? maskBadWords(t) : t;
}

module.exports = { cleanChat, maskBadWords, CHAT_PHASES, MAX_LENGTH, MIN_GAP_MS, BURST, BURST_WINDOW_MS, HISTORY, BAD_WORDS };
