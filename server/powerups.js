'use strict';

// ---------------------------------------------------------------------------
// Power-ups: small boosts you can buy between rounds ("pit stop").
//
// Fair-play design (the game's rule is "no pay-to-win"):
//   * They are bought with a PIT-STOP PURSE that every player starts the match
//     with at zero. It fills up as you play rounds (same amount as the shop coins
//     for that round) and is thrown away when the match ends. So nobody can bring
//     a pile of coins from older matches to out-buy a newcomer, and nothing is
//     ever bought with real money.
//   * Each boost is small (10-30%), lasts for ONE round, and you can carry at most
//     two. Nobody can stack five.
//   * Whoever is in last place pays 30% less (a comeback helper).
//   * The SERVER keeps the purse and does the buying, so a modified browser
//     cannot give itself free power-ups.
// ---------------------------------------------------------------------------

const POWERUPS = [
  { id: 'speed', icon: '\u{1F45F}', name: 'Speedy Shoes', desc: 'Run 12% faster.', price: 20, mods: { speed: 1.12 } },
  { id: 'jump', icon: '\u{1F998}', name: 'Bouncy Boots', desc: 'Jump 18% higher.', price: 20, mods: { jump: 1.18 } },
  { id: 'quick', icon: '⚡', name: 'Quick Hands', desc: 'Your shove recharges 30% faster.', price: 25, mods: { shoveCd: 0.7 } },
  { id: 'reach', icon: '\u{1F4CF}', name: 'Long Arms', desc: 'Your shove reaches 25% further.', price: 20, mods: { range: 1.25 } },
  { id: 'sturdy', icon: '\u{1F6E1}️', name: 'Sturdy Soles', desc: 'Shoves push you 35% less.', price: 20, mods: { sturdy: 0.65 } },
];

const BY_ID = new Map(POWERUPS.map((p) => [p.id, p]));

const MAX_SLOTS = 2; // most power-ups one player can carry into a round
const UNDERDOG_DISCOUNT = 0.3; // last place pays this much less

// The boosts every game understands, and how far a modified request may go.
const NEUTRAL = { speed: 1, jump: 1, shoveCd: 1, range: 1, sturdy: 1 };
const LIMITS = {
  speed: [0.6, 1.4],
  jump: [0.6, 1.4],
  shoveCd: [0.5, 1.5],
  range: [0.6, 1.5],
  sturdy: [0.4, 1.5],
};

function getPowerup(id) {
  return BY_ID.get(id) || null;
}

function priceFor(def, underdog) {
  return underdog ? Math.max(1, Math.round(def.price * (1 - UNDERDOG_DISCOUNT))) : def.price;
}

function cheapestPrice() {
  return Math.min(...POWERUPS.map((p) => priceFor(p, true)));
}

// Several power-ups -> one set of multipliers.
function combine(ids) {
  const out = { ...NEUTRAL };
  const seen = new Set();
  for (const id of ids || []) {
    const def = BY_ID.get(id);
    if (!def || seen.has(id)) continue;
    seen.add(id);
    for (const [k, v] of Object.entries(def.mods)) out[k] *= v;
  }
  return out;
}

// What the games call: turns anything (even junk) into safe multipliers.
function normalizeMods(raw) {
  const out = { ...NEUTRAL };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(NEUTRAL)) {
    const v = Number(raw[k]);
    if (!Number.isFinite(v)) continue;
    out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
  }
  return out;
}

// What the browser needs to draw the pit stop.
function catalogue() {
  return POWERUPS.map((p) => ({
    id: p.id,
    icon: p.icon,
    name: p.name,
    desc: p.desc,
    price: p.price,
    underdogPrice: priceFor(p, true),
  }));
}

module.exports = { POWERUPS, MAX_SLOTS, UNDERDOG_DISCOUNT, NEUTRAL, getPowerup, priceFor, cheapestPrice, combine, normalizeMods, catalogue };
