// ---------------------------------------------------------------------------
// packs.js - cosmetic PACKS, a bit like trading-card packs. Pure rules (no drawing,
// no network), so it is easy to test (tests/packs.test.js).
//
// What a pack is:
//   * You pay coins (earned by playing; there is NO real money anywhere in this game).
//   * You get a few cards. Each card is either one cosmetic (a skin, hat or back item)
//     or a whole OUTFIT (a matching skin + back item + hat).
//   * Every card has a rarity: Common, Uncommon, Rare, Epic or Legendary.
//   * Better packs cost more, and have better odds and a guaranteed good card.
//
// Rules that keep it friendly:
//   * The odds are shown to the player on the packs screen, exactly as they are here.
//   * Every pack guarantees a minimum rarity (see `min`), and a "pity" counter makes sure
//     that after PITY_LIMIT packs without an Epic or better, the next pack has one.
//   * A card you already own is never wasted: it pays coins back (DUPE_COINS). The refunds
//     are far smaller than the price (tests/packs.test.js checks this), so you cannot make
//     coins by opening packs.
//   * Cosmetics only. Nothing in a pack changes how a minigame plays.
// ---------------------------------------------------------------------------

import { SKINS, HATS, BACKS } from './constants.js';
import { owns, grant } from './shop.js';

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const RARITY_LABEL = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
// What each rarity means, in plain words (shown in the "Rarity guide" on the Packs screen).
export const RARITY_BLURB = [
  'Everyday silly hats',
  'More distinctive designs',
  'Animated or extra-detailed hats',
  'Big visual effects and unusual designs',
  'Signature cosmetics with special animations',
];
export const RARITY_COLOR = ['#9aa5b1', '#4caf50', '#3a86ff', '#a855f7', '#ffb400'];

// Coins paid back for a card you already own (outfits pay double).
export const DUPE_COINS = [5, 15, 40, 100, 250];
export const OUTFIT_CHANCE = 0.25; // chance that a card is an outfit (when that rarity has outfits)
export const PITY_LIMIT = 10; // packs without an Epic+ before the next one is guaranteed to have one
const EPIC = 3;

// weights = the chance (in percent) that ONE card is of each rarity. `min` = the pack always
// has at least one card of this rarity or better (0 = common, no guarantee).
export const PACKS = [
  { id: 'basic', name: 'Basic Pack', price: 120, cards: 3, weights: [70, 25, 5, 0, 0], min: 0, icon: '\u{1F4E6}' },
  { id: 'classic', name: 'Classic Pack', price: 260, cards: 4, weights: [55, 25, 13, 6, 1], min: 0, icon: '\u{1F3B4}' },
  { id: 'super', name: 'Super Pack', price: 300, cards: 4, weights: [40, 38, 18, 4, 0], min: 1, icon: '\u{1F381}' },
  { id: 'ultra', name: 'Ultra Pack', price: 700, cards: 5, weights: [10, 35, 38, 15, 2], min: 2, icon: '\u{1F48E}' },
  { id: 'legend', name: 'Legend Pack', price: 1500, cards: 5, weights: [0, 20, 45, 28, 7], min: 3, icon: '\u{1F451}' },
];

// The cosmetics that come out of packs, by rarity. (Names must exist in constants.js.)
const POOL_NAMES = [
  { skin: ['Denim', 'Pinstripe', 'Plaid'], hat: ['Fez', 'Warning sign', 'Cardboard box', 'Budget wizard', 'Noodle nest', 'Pizza slice', 'Robot colander'], back: ['Red cape', 'Blue cape', 'Gray hoodie', 'Green cloak', 'Yellow cape', 'Pink hoodie', 'Orange hoodie', 'Brown cloak'] },
  { skin: ['Leopard', 'Snowflakes', 'Sunset'], hat: ['Sombrero', 'Emergency chicken', 'Unpaid unicorn', 'Burger crown', 'Tiny crown', 'Alien antenna'], back: ['Striped cape', 'Frog hoodie', 'Cat hoodie', 'Black cloak'] },
  { skin: ['Ocean', 'Pixel', 'Toxic'], hat: ['Knight helm', 'Spinning siren', 'Cursed bucket', 'Angry popcorn', 'Trophy head', 'Champion bucket', 'Satellite dish'], back: ['Hero cape', 'Wizard cloak', 'Royal cape', 'Vampire cloak'] },
  { skin: ['Neon', 'Stained glass'], hat: ['Ninja band', 'Dragon horns', 'Tiny dragon', 'The Prophecy', 'Forbidden cheese', 'Millionaire hair', 'Experiment 404'], back: ['Flame cape', 'Ice cloak', 'Rainbow cape'] },
  { skin: ['Aurora', 'Diamond'], hat: ['Royal crown', 'Main character', 'UFO abduction'], back: ['Golden cape', 'Galaxy cloak'] },
];

const LISTS = { skin: SKINS, hat: HATS, back: BACKS };
function indexOfName(kind, name) {
  const i = LISTS[kind].indexOf(name);
  if (i < 0) throw new Error(`packs.js: no ${kind} called "${name}"`);
  return i;
}

// ITEMS[rarity] = [{ kind, index }, ...]
export const ITEMS = POOL_NAMES.map((group) => {
  const out = [];
  for (const kind of ['skin', 'hat', 'back']) for (const name of group[kind]) out.push({ kind, index: indexOfName(kind, name) });
  return out;
});

// Outfits: a skin + a back item + a hat that look good together.
const OUTFIT_NAMES = [
  // [id, name, rarity, skin, back item, hat]. An outfit's rarity is the rarity of its best piece (tests check this).
  // common
  ['lazy', 'Lazy Sunday', 0, 'Plaid', 'Gray hoodie', 'Beanie'],
  ['rainy', 'Rainy Day', 0, 'Pinstripe', 'Brown cloak', 'Fez'],
  ['budgetmage', 'Budget Mage', 0, 'Stars', 'Blue cape', 'Budget wizard'],
  ['pizza', 'Pizza Party', 0, 'Polka', 'Red cape', 'Pizza slice'],
  // uncommon
  ['safari', 'Safari Scout', 1, 'Leopard', 'Orange hoodie', 'Cowboy hat'],
  ['bunny', 'Snow Bunny', 1, 'Snowflakes', 'Pink hoodie', 'Bunny ears'],
  ['sunset', 'Sunset Rider', 1, 'Sunset', 'Striped cape', 'Sombrero'],
  ['chicken', 'Chicken Wrangler', 1, 'Stripes', 'Orange hoodie', 'Emergency chicken'],
  ['unicorn', 'Unicorn Rental', 1, 'Hearts', 'Pink hoodie', 'Unpaid unicorn'],
  ['burger', 'Burger Boss', 1, 'Plaid', 'Yellow cape', 'Burger crown'],
  ['alien', 'Alien Contact', 1, 'Zigzag', 'Green cloak', 'Alien antenna'],
  // rare
  ['pirate', 'Pirate Captain', 2, 'Ocean', 'Black cloak', 'Pirate hat'],
  ['pixel', 'Pixel Hero', 2, 'Pixel', 'Hero cape', 'Knight helm'],
  ['slime', 'Slime Lord', 2, 'Toxic', 'Vampire cloak', 'Viking helmet'],
  ['siren', 'Siren Squad', 2, 'Lightning', 'Hero cape', 'Spinning siren'],
  ['trophy', 'Trophy Winner', 2, 'Pinstripe', 'Black cloak', 'Trophy head'],
  ['cursed', 'Cursed Knight', 2, 'Camo', 'Vampire cloak', 'Cursed bucket'],
  ['space', 'Space Command', 2, 'Pixel', 'Blue cape', 'Satellite dish'],
  // epic
  ['neon', 'Neon Wizard', 3, 'Neon', 'Wizard cloak', 'Wizard hat'],
  ['glass', 'Glass Saint', 3, 'Stained glass', 'Ice cloak', 'Halo'],
  ['tamer', 'Dragon Tamer', 3, 'Toxic', 'Flame cape', 'Tiny dragon'],
  ['cheese', 'Cheese Goblin', 3, 'Sunset', 'Brown cloak', 'Forbidden cheese'],
  ['millionaire', 'Millionaire', 3, 'Leopard', 'Royal cape', 'Millionaire hair'],
  ['scientist', 'Mad Scientist', 3, 'Toxic', 'Ice cloak', 'Experiment 404'],
  // legendary
  ['emperor', 'Cosmic Emperor', 4, 'Aurora', 'Galaxy cloak', 'Royal crown'],
  ['dragon', 'Golden Dragon', 4, 'Diamond', 'Golden cape', 'Dragon horns'],
  ['main', 'The Main Character', 4, 'Diamond', 'Royal cape', 'Main character'],
  ['abductee', 'Abductee', 4, 'Neon', 'Galaxy cloak', 'UFO abduction'],
];
export const OUTFITS = OUTFIT_NAMES.map(([id, name, rarity, skin, back, hat]) => ({
  id,
  name,
  rarity,
  skin: indexOfName('skin', skin),
  back: indexOfName('back', back),
  hat: indexOfName('hat', hat),
}));

// ------------------------------------------------------------------ odds
// One card's chance of each rarity, in percent (what the packs screen shows).
export function oddsOf(pack) {
  const total = pack.weights.reduce((a, b) => a + b, 0);
  return pack.weights.map((w) => (w / total) * 100);
}

export function getPack(id) {
  return PACKS.find((p) => p.id === id) || null;
}

export function rarityOfItem(kind, index) {
  for (let r = 0; r < ITEMS.length; r++) if (ITEMS[r].some((it) => it.kind === kind && it.index === index)) return r;
  return -1;
}

// ------------------------------------------------------------------ outfits you own
export function outfitProgress(wallet, outfit) {
  const have = ['skin', 'back', 'hat'].filter((k) => owns(wallet, k, outfit[k])).length;
  return { have, complete: have === 3 };
}

// The look you get by wearing an outfit (colour and name stay yours). Returns null if you do not own all of it.
export function wearOutfit(wallet, look, outfit) {
  if (!outfitProgress(wallet, outfit).complete) return null;
  return { ...look, skin: outfit.skin, back: outfit.back, hat: outfit.hat };
}

// ------------------------------------------------------------------ opening
function rollRarity(weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let r = 0; r < weights.length; r++) {
    if (x < weights[r]) return r;
    x -= weights[r];
  }
  for (let r = weights.length - 1; r >= 0; r--) if (weights[r] > 0) return r;
  return 0;
}

function pick(list, rng) {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

// Chooses WHAT the card is, for a given rarity.
function drawCard(rarity, rng) {
  const outfits = OUTFITS.filter((o) => o.rarity === rarity);
  if (outfits.length && rng() < OUTFIT_CHANCE) return { type: 'outfit', rarity, outfit: pick(outfits, rng) };
  const it = pick(ITEMS[rarity], rng);
  return { type: 'item', rarity, kind: it.kind, index: it.index };
}

/**
 * Opens one pack: pays, rolls the cards, hands over what is new, refunds duplicates.
 * Returns { ok:false, error } or { ok:true, pack, cards, spent, refund, pityUsed }.
 * Each card: { type:'item', kind, index, rarity, isNew, refund }
 *         or { type:'outfit', outfit, rarity, isNew, newPieces:[{kind,index}], refund }.
 * `rng` is only replaced in tests.
 */
export function openPack(wallet, packId, rng = Math.random) {
  const pack = getPack(packId);
  if (!pack) return { ok: false, error: 'No such pack.' };
  if (wallet.coins < pack.price) return { ok: false, error: `You need ${pack.price - wallet.coins} more coins.` };

  // 1. roll a rarity for every card
  const rolls = [];
  for (let i = 0; i < pack.cards; i++) rolls.push(rollRarity(pack.weights, rng));

  // 2. the guarantees: the pack's own minimum, and the pity counter
  let pityUsed = false;
  const lift = (floor) => {
    if (Math.max(...rolls) >= floor) return false;
    let low = 0;
    for (let i = 1; i < rolls.length; i++) if (rolls[i] < rolls[low]) low = i;
    rolls[low] = floor;
    return true;
  };
  lift(pack.min);
  if (wallet.pity >= PITY_LIMIT) pityUsed = lift(EPIC);

  // 3. best card last (like opening a trading-card pack)
  rolls.sort((a, b) => a - b);

  // 4. pay, then hand the cards over one at a time (so a repeat inside the same pack counts as a duplicate)
  wallet.coins -= pack.price;
  let refund = 0;
  const cards = rolls.map((rarity) => {
    const c = drawCard(rarity, rng);
    if (c.type === 'item') {
      const isNew = !owns(wallet, c.kind, c.index);
      if (isNew) grant(wallet, c.kind, c.index);
      const back = isNew ? 0 : DUPE_COINS[rarity];
      refund += back;
      return { ...c, isNew, refund: back };
    }
    const newPieces = [];
    for (const kind of ['skin', 'back', 'hat']) {
      if (!owns(wallet, kind, c.outfit[kind])) {
        grant(wallet, kind, c.outfit[kind]);
        newPieces.push({ kind, index: c.outfit[kind] });
      }
    }
    const isNew = newPieces.length > 0;
    const back = isNew ? 0 : DUPE_COINS[rarity] * 2;
    refund += back;
    return { ...c, isNew, newPieces, refund: back };
  });
  wallet.coins = Math.min(999999, wallet.coins + refund);
  wallet.packs = Math.min(1e6, (wallet.packs || 0) + 1);
  wallet.pity = Math.max(...rolls) >= EPIC ? 0 : Math.min(999, (wallet.pity || 0) + 1);
  return { ok: true, pack, cards, spent: pack.price, refund, pityUsed };
}
