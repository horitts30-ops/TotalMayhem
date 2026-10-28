// ---------------------------------------------------------------------------
// shop.js - the wallet and the shop catalogue. No drawing and no network here,
// just rules, so it is easy to test (see tests/shop.test.js).
//
// IMPORTANT: coins only buy COSMETICS (hats, skins, back items, colours). Nothing in the
// shop changes how a minigame plays. There is no real money anywhere. Packs (packs.js) are a
// random-card feature paid ONLY with in-game coins, with the odds shown on screen.
//
// The wallet is saved in this browser's localStorage. The server decides how
// many coins a round is worth (server/rewards.js), but it does not keep the
// wallet - so someone who edits their own localStorage can only give
// THEMSELVES hats. That is an acceptable trade for a no-accounts game.
// ---------------------------------------------------------------------------

import { COLORS, HATS, SKINS, BACKS } from './constants.js';

export const WALLET_KEY = 'tm_wallet';

// price 0 = everybody starts with it.
// price -1 (UNLOCK_ONLY) = cannot be bought at all; you earn it with an
// achievement (see achievements.js), so coins never buy the special ones.
// Edit the numbers freely. A normal 3-round match with friends earns roughly 50-60 coins.
export const UNLOCK_ONLY = -1;
const U = UNLOCK_ONLY;
// price -2 (PACK_ONLY) = cannot be bought directly either; you get it by opening packs (see packs.js).
export const PACK_ONLY = -2;
const P = PACK_ONLY;
const HAT_PRICES = [0, 0, 150, 40, 0, 40, 40, 80, 100, 80, 100, 40, 120, 0, 40, 100, U, U, U, U, U, U, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P];
// (hats 22-51 are all pack-only)
const SKIN_PRICES = [0, 0, 40, 60, 60, 60, 80, 200, U, U, U, U, 50, 90, 70, 100, 120, 110, 80, 90, U, U, U, U, P, P, P, P, P, P, P, P, P, P, P, P, P];
const BACK_PRICES = [0, 70, 70, 90, 90, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P];
const COLOR_PRICES = [0, 0, 0, 0, 0, 0, 30, 30, 30, 30, 30, 50];

export const KINDS = ['hat', 'skin', 'back', 'color'];

const NAMES = { hat: HATS, skin: SKINS, back: BACKS, color: COLORS.map((c) => c.name) };
const PRICES = { hat: HAT_PRICES, skin: SKIN_PRICES, back: BACK_PRICES, color: COLOR_PRICES };
export const KIND_LABEL = { hat: 'Hats', skin: 'Skins', back: 'Back', color: 'Colors' };

export function countOf(kind) {
  return NAMES[kind].length;
}
export function nameOf(kind, index) {
  return NAMES[kind][index];
}
export function priceOf(kind, index) {
  return PRICES[kind][index] || 0;
}
export function isUnlockOnly(kind, index) {
  return priceOf(kind, index) === UNLOCK_ONLY;
}
export function isPackOnly(kind, index) {
  return priceOf(kind, index) === PACK_ONLY;
}

// Every item as a flat list (handy for tests and the shop grid).
export function catalogue(kind) {
  return NAMES[kind].map((name, index) => ({ kind, index, name, price: priceOf(kind, index) }));
}

// ---------------------------------------------------------------- wallet
export function emptyWallet() {
  const owned = {};
  for (const k of KINDS) owned[k] = [];
  const w = { coins: 0, owned, paid: [], pity: 0, packs: 0, trades: [] };
  return normalizeWallet(w);
}

// Turns whatever was in localStorage into a safe wallet: right shapes, numbers
// in range, and every free item always owned.
export function normalizeWallet(raw) {
  const w = raw && typeof raw === 'object' ? raw : {};
  const coins = Number.isFinite(w.coins) ? Math.max(0, Math.min(999999, Math.floor(w.coins))) : 0;
  const owned = {};
  for (const k of KINDS) {
    const set = new Set();
    for (let i = 0; i < countOf(k); i++) if (priceOf(k, i) === 0) set.add(i);
    const saved = w.owned && Array.isArray(w.owned[k]) ? w.owned[k] : [];
    for (const i of saved) if (Number.isInteger(i) && i >= 0 && i < countOf(k)) set.add(i);
    owned[k] = [...set].sort((a, b) => a - b);
  }
  const paid = Array.isArray(w.paid) ? w.paid.filter((x) => typeof x === 'string').slice(-40) : [];
  // pity = packs opened since the last Epic-or-better card; packs = packs opened in total (packs.js)
  const pity = Number.isFinite(w.pity) ? Math.max(0, Math.min(999, Math.floor(w.pity))) : 0;
  const packs = Number.isFinite(w.packs) ? Math.max(0, Math.min(1e6, Math.floor(w.packs))) : 0;
  // ids of finished trades, so the same trade can never be applied twice (trades.js on the server re-sends a
  // finished trade if your connection dropped at the wrong moment)
  const trades = Array.isArray(w.trades) ? w.trades.filter((x) => typeof x === 'string' && x.length <= 20).slice(-20) : [];
  return { coins, owned, paid, pity, packs, trades };
}

export function loadWallet(storage) {
  try {
    return normalizeWallet(JSON.parse(storage.getItem(WALLET_KEY) || '{}'));
  } catch (e) {
    return emptyWallet();
  }
}

export function saveWallet(storage, wallet) {
  try {
    storage.setItem(WALLET_KEY, JSON.stringify(wallet));
  } catch (e) {
    /* private mode etc: the game still works, coins just will not be remembered */
  }
}

export function owns(wallet, kind, index) {
  return wallet.owned[kind].includes(index);
}

// Pay out coins once per `key` (a reconnect or page reload that replays the
// same results screen must not pay twice). Returns how many coins were added.
export function credit(wallet, amount, key) {
  const n = Math.floor(Number(amount));
  if (!Number.isFinite(n) || n <= 0 || typeof key !== 'string' || !key) return 0;
  if (wallet.paid.includes(key)) return 0;
  wallet.paid.push(key);
  if (wallet.paid.length > 40) wallet.paid.shift();
  wallet.coins = Math.min(999999, wallet.coins + n);
  return n;
}

// Gives an item for free (achievement rewards). Returns true if it is new.
export function grant(wallet, kind, index) {
  if (!KINDS.includes(kind) || !Number.isInteger(index) || index < 0 || index >= countOf(kind)) return false;
  if (owns(wallet, kind, index)) return false;
  wallet.owned[kind].push(index);
  wallet.owned[kind].sort((a, b) => a - b);
  return true;
}

// Returns { ok:true } or { ok:false, error }.
export function buy(wallet, kind, index) {
  if (!KINDS.includes(kind) || !Number.isInteger(index) || index < 0 || index >= countOf(kind)) {
    return { ok: false, error: 'No such item.' };
  }
  if (owns(wallet, kind, index)) return { ok: false, error: 'You already own that.' };
  if (isUnlockOnly(kind, index)) return { ok: false, error: 'Coins cannot buy this one. Unlock it with an achievement!' };
  if (isPackOnly(kind, index)) return { ok: false, error: 'This one only comes out of packs. Open a pack to try for it!' };
  const price = priceOf(kind, index);
  if (wallet.coins < price) return { ok: false, error: `You need ${price - wallet.coins} more coins.` };
  wallet.coins -= price;
  wallet.owned[kind].push(index);
  wallet.owned[kind].sort((a, b) => a - b);
  return { ok: true };
}

// The next OWNED index when stepping through a list (used by the < > buttons).
export function nextOwned(wallet, kind, current, dir) {
  const n = countOf(kind);
  for (let step = 1; step <= n; step++) {
    const i = (current + dir * step + n * step) % n;
    if (owns(wallet, kind, i)) return i;
  }
  return current;
}

// If a saved look uses something this wallet does not own, swap it for the
// nearest free/owned choice so nobody wears an item they have not bought.
export function sanitizeLook(wallet, look) {
  const out = { ...look };
  for (const k of KINDS) {
    const i = out[k];
    if (!Number.isInteger(i) || i < 0 || i >= countOf(k) || !owns(wallet, k, i)) {
      out[k] = wallet.owned[k][0];
    }
  }
  return out;
}

export function ownedCount(wallet) {
  let have = 0;
  let total = 0;
  for (const k of KINDS) {
    have += wallet.owned[k].length;
    total += countOf(k);
  }
  return { have, total };
}

// ---------------------------------------------------------------- trading (server/trade.js has the other half)
export const TRADE_MAX_ITEMS = 6;
export const TRADE_MAX_COINS = 99999;

// Free starter items are the same for everybody and trophy items must be earned, so neither can be traded.
// Everything bought with coins (or pulled from a pack) can.
export function isTradable(kind, index) {
  if (!KINDS.includes(kind) || !Number.isInteger(index) || index < 0 || index >= countOf(kind)) return false;
  const p = priceOf(kind, index);
  return p !== 0 && p !== UNLOCK_ONLY;
}

function checkSide(list, what) {
  if (!list || typeof list !== 'object') return `Bad ${what}.`;
  const { coins, items } = list;
  if (!Number.isInteger(coins) || coins < 0 || coins > TRADE_MAX_COINS) return `Coins must be 0 to ${TRADE_MAX_COINS}.`;
  if (!Array.isArray(items) || items.length > TRADE_MAX_ITEMS) return `At most ${TRADE_MAX_ITEMS} items.`;
  const seen = new Set();
  for (const it of items) {
    if (!it || !isTradable(it.kind, it.index)) return 'One of the items cannot be traded.';
    const key = `${it.kind}:${it.index}`;
    if (seen.has(key)) return 'The same item twice.';
    seen.add(key);
  }
  return null;
}

// Can THIS wallet do this trade? Returns an error text, or null if it is fine.
// give = what I hand over, get = what I receive; both { coins, items: [{kind, index}] }.
export function checkTrade(wallet, give, get) {
  const e1 = checkSide(give, 'offer');
  if (e1) return e1;
  const e2 = checkSide(get, 'offer');
  if (e2) return e2;
  if (wallet.coins < give.coins) return `You only have ${wallet.coins} coins.`;
  if (wallet.coins - give.coins + get.coins > 999999) return 'That would be more coins than a wallet can hold.';
  for (const it of give.items) if (!owns(wallet, it.kind, it.index)) return `You do not own ${nameOf(it.kind, it.index)}.`;
  for (const it of get.items) if (owns(wallet, it.kind, it.index)) return `You already own ${nameOf(it.kind, it.index)}.`;
  return null;
}

// Does the trade: my items and coins go, theirs arrive. Safe to call twice with the same trade id (the second
// call does nothing). Returns { ok:true, repeat? } or { ok:false, error }.
export function applyTrade(wallet, tradeId, give, get) {
  if (typeof tradeId !== 'string' || !tradeId) return { ok: false, error: 'Bad trade.' };
  if (wallet.trades.includes(tradeId)) return { ok: true, repeat: true };
  const err = checkTrade(wallet, give, get);
  if (err) return { ok: false, error: err };
  wallet.coins = wallet.coins - give.coins + get.coins;
  for (const it of give.items) wallet.owned[it.kind] = wallet.owned[it.kind].filter((i) => i !== it.index);
  for (const it of get.items) grant(wallet, it.kind, it.index);
  wallet.trades.push(tradeId);
  if (wallet.trades.length > 20) wallet.trades.shift();
  return { ok: true };
}
