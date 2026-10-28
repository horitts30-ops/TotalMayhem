'use strict';

// Tests for back items (capes, cloaks, hoodies), pack-only cosmetics, outfits and PACKS
// (public/js/packs.js, public/js/wardrobe.js). Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const cfg = require('../server/config');
const { io } = require('socket.io-client');
const { createGameServer } = require('../server/app');

const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', f)).href);

function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('catalogue sizes agree everywhere: constants, wardrobe drawing, shop and server config', async () => {
  const C = await load('constants.js');
  const W = await load('wardrobe.js');
  const shop = await load('shop.js');
  assert.equal(C.BACKS.length, 22);
  assert.equal(W.BACK_DEFS.length, C.BACKS.length);
  assert.equal(cfg.BACK_COUNT, C.BACKS.length);
  assert.equal(cfg.HAT_COUNT, C.HATS.length);
  assert.equal(cfg.SKIN_COUNT, C.SKINS.length);
  assert.equal(shop.countOf('back'), C.BACKS.length);
  assert.equal(new Set(C.BACKS).size, C.BACKS.length, 'back names are unique');
  assert.equal(new Set(C.HATS).size, C.HATS.length, 'hat names are unique');
  assert.equal(new Set(C.SKINS).size, C.SKINS.length, 'skin names are unique');
  assert.equal(C.BACKS[0], 'No back item');
  const types = new Set(W.BACK_DEFS.filter(Boolean).map((d) => d.type));
  assert.deepEqual([...types].sort(), ['cape', 'cloak', 'hoodie']);
});

test('your five hat collections are all in the game', async () => {
  const C = await load('constants.js');
  const wanted = [
    'Traffic cone', 'Emergency chicken', 'Warning sign', 'Spinning siren', 'Cardboard box',
    'Budget wizard', 'Unpaid unicorn', 'Cursed bucket', 'Tiny dragon', 'The Prophecy',
    'Burger crown', 'Noodle nest', 'Pizza slice', 'Angry popcorn', 'Forbidden cheese',
    'Tiny crown', 'Trophy head', 'Millionaire hair', 'Champion bucket', 'Main character',
    'UFO abduction', 'Alien antenna', 'Robot colander', 'Satellite dish', 'Experiment 404',
  ];
  const have = C.HATS.map((h) => h.toLowerCase());
  for (const w of wanted) assert.ok(have.includes(w.toLowerCase()), `missing hat: ${w}`);
});

test('shop: pack-only items cannot be bought with coins, and every one of them is in a pack pool', async () => {
  const shop = await load('shop.js');
  const P = await load('packs.js');
  const inPool = new Set(P.ITEMS.flat().map((it) => `${it.kind}:${it.index}`));
  let packOnly = 0;
  for (const k of ['hat', 'skin', 'back']) {
    for (const it of shop.catalogue(k)) {
      const key = `${k}:${it.index}`;
      if (it.price === shop.PACK_ONLY) {
        packOnly++;
        assert.ok(inPool.has(key), `${key} (${it.name}) is pack-only but no pack can drop it`);
        const w = shop.emptyWallet();
        w.coins = 999999;
        const r = shop.buy(w, k, it.index);
        assert.equal(r.ok, false, `${it.name} must not be buyable`);
        assert.equal(w.coins, 999999);
      }
      if (inPool.has(key)) assert.ok(it.price === shop.PACK_ONLY || it.price >= 0, `${key} pool item is unlock-only`);
    }
  }
  assert.ok(packOnly >= 40, `lots of pack-only things exist (${packOnly})`);
});

test('packs: every pool item has exactly one rarity and no pool item is unlock-only or the free default', async () => {
  const shop = await load('shop.js');
  const P = await load('packs.js');
  const seen = new Map();
  P.ITEMS.forEach((list, r) => {
    assert.ok(list.length > 0, `rarity ${r} has items`);
    for (const it of list) {
      const key = `${it.kind}:${it.index}`;
      assert.ok(!seen.has(key), `${key} appears twice`);
      seen.set(key, r);
      assert.notEqual(shop.priceOf(it.kind, it.index), shop.UNLOCK_ONLY, key);
      assert.ok(it.index > 0 || it.kind === 'hat' || it.kind === 'skin' ? true : false);
      assert.equal(P.rarityOfItem(it.kind, it.index), r);
    }
  });
  assert.equal(P.ITEMS.length, 5);
});

test('outfits: all pieces exist, none is unlock-only, and the outfit rarity is its best pool piece', async () => {
  const shop = await load('shop.js');
  const P = await load('packs.js');
  assert.ok(P.OUTFITS.length >= 24);
  assert.equal(new Set(P.OUTFITS.map((o) => o.id)).size, P.OUTFITS.length);
  assert.equal(new Set(P.OUTFITS.map((o) => o.name)).size, P.OUTFITS.length);
  const perRarity = [0, 0, 0, 0, 0];
  for (const o of P.OUTFITS) {
    perRarity[o.rarity]++;
    let best = -1;
    for (const k of ['skin', 'back', 'hat']) {
      assert.ok(o[k] >= 0 && o[k] < shop.countOf(k), `${o.id}.${k}`);
      assert.notEqual(shop.priceOf(k, o[k]), shop.UNLOCK_ONLY, `${o.id}.${k} is unlock-only`);
      assert.ok(o[k] > 0, `${o.id}.${k} should not be the plain default`);
      best = Math.max(best, P.rarityOfItem(k, o[k]));
    }
    assert.equal(o.rarity, Math.max(best, 0), `${o.id}: rarity should equal its best pool piece (${best})`);
  }
  for (let r = 0; r < 5; r++) assert.ok(perRarity[r] >= 2, `rarity ${r} has outfits (${perRarity[r]})`);
});

test('packs: odds add to 100, better packs cost more and have better odds and guarantees', async () => {
  const P = await load('packs.js');
  const mean = (pack) => P.oddsOf(pack).reduce((s, o, r) => s + o * r, 0) / 100;
  for (let i = 0; i < P.PACKS.length; i++) {
    const pack = P.PACKS[i];
    assert.ok(Math.abs(P.oddsOf(pack).reduce((a, b) => a + b, 0) - 100) < 1e-9, pack.id);
    assert.ok(pack.cards >= 3 && pack.cards <= 8);
    if (i > 0) {
      const prev = P.PACKS[i - 1];
      assert.ok(pack.price > prev.price, `${pack.id} costs more`);
      assert.ok(mean(pack) > mean(prev), `${pack.id} has better odds`);
      assert.ok(pack.min >= prev.min, `${pack.id} guarantee is not worse`);
      assert.ok(pack.cards >= prev.cards);
    }
  }
  assert.ok(P.PACKS.at(-1).weights[4] > 0, 'the top pack can drop Legendary');
  assert.equal(P.PACKS[0].weights[4], 0, 'the cheapest pack cannot drop Legendary');
  assert.ok(P.PACKS.every((p) => p.min > 0 || p.id === 'basic' || p.id === 'classic'));
});

test('packs: duplicates can never make a profit - even a pack of pure duplicates pays back well under its price', async () => {
  const P = await load('packs.js');
  for (const pack of P.PACKS) {
    // The most you could ever get back = every card a duplicate of its rarity (outfits pay double).
    let ev = 0;
    P.oddsOf(pack).forEach((o, r) => {
      const hasOutfits = P.OUTFITS.some((x) => x.rarity === r);
      const perCard = hasOutfits ? (1 - P.OUTFIT_CHANCE) * P.DUPE_COINS[r] + P.OUTFIT_CHANCE * P.DUPE_COINS[r] * 2 : P.DUPE_COINS[r];
      ev += (o / 100) * perCard;
    });
    const worst = ev * pack.cards;
    assert.ok(worst < pack.price * 0.4, `${pack.id}: refund EV ${worst.toFixed(1)} vs price ${pack.price}`);
  }
});

test('openPack: pays exactly, gives the cards, and refuses unknown packs or empty wallets', async () => {
  const shop = await load('shop.js');
  const P = await load('packs.js');
  const w = shop.emptyWallet();
  w.coins = 50;
  const poor = P.openPack(w, 'basic', rngOf(1));
  assert.equal(poor.ok, false);
  assert.equal(w.coins, 50, 'nothing taken');
  assert.equal(P.openPack(w, 'nope', rngOf(1)).ok, false);
  assert.equal(P.openPack(w, undefined, rngOf(1)).ok, false);

  w.coins = 1000;
  const before = JSON.stringify(w.owned);
  const r = P.openPack(w, 'basic', rngOf(7));
  assert.equal(r.ok, true);
  assert.equal(r.cards.length, 3);
  assert.equal(r.spent, 120);
  assert.equal(w.coins, 1000 - 120 + r.refund);
  assert.equal(w.packs, 1);
  const newCount = r.cards.filter((c) => c.isNew).length;
  assert.ok(newCount >= 1, 'a fresh wallet gets something new');
  assert.notEqual(JSON.stringify(w.owned), before);
  for (const c of r.cards) {
    if (c.type === 'item') assert.ok(shop.owns(w, c.kind, c.index), 'you own what you drew');
    else for (const k of ['skin', 'back', 'hat']) assert.ok(shop.owns(w, k, c.outfit[k]));
  }
  // best card is last
  const rars = r.cards.map((c) => c.rarity);
  assert.deepEqual(rars, [...rars].sort((a, b) => a - b));
});

test('openPack: the pack guarantee holds over thousands of random packs', async () => {
  const shop = await load('shop.js');
  const P = await load('packs.js');
  for (const pack of P.PACKS) {
    const rng = rngOf(100 + pack.price);
    for (let n = 0; n < 1500; n++) {
      const w = shop.emptyWallet();
      w.coins = 5000;
      const r = P.openPack(w, pack.id, rng);
      assert.equal(r.cards.length, pack.cards);
      assert.ok(Math.max(...r.cards.map((c) => c.rarity)) >= pack.min, `${pack.id} gave less than rarity ${pack.min}`);
      for (const c of r.cards) assert.ok(c.rarity >= 0 && c.rarity <= 4);
    }
  }
});

test('openPack: the cheapest pack never drops Epic or Legendary, and observed rarities match the shown odds', async () => {
  const shop = await load('shop.js');
  const P = await load('packs.js');
  const rng = rngOf(99);
  const basic = P.PACKS[0];
  const counts = [0, 0, 0, 0, 0];
  let total = 0;
  for (let n = 0; n < 4000; n++) {
    const w = shop.emptyWallet();
    w.coins = 1000;
    for (const c of P.openPack(w, 'basic', rng).cards) {
      counts[c.rarity]++;
      total++;
    }
  }
  assert.equal(counts[3] + counts[4], 0);
  const odds = P.oddsOf(basic);
  // Rare is 5% in the odds; the guarantee only lifts packs that had no Uncommon+, so allow some slack.
  assert.ok(counts[2] / total > 0.03 && counts[2] / total < 0.08, `rare share ${(counts[2] / total).toFixed(3)} vs ${odds[2]}%`);
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2]);
});

test('openPack: duplicates pay coins back, are never granted twice, and outfits only grant missing pieces', async () => {
  const shop = await load('shop.js');
  const P = await load('packs.js');
  const rng = rngOf(5);
  const w = shop.emptyWallet();
  w.coins = 999999;
  let sawDupe = false;
  let sawOutfit = false;
  for (let n = 0; n < 300; n++) {
    const coinsBefore = w.coins;
    const ownedBefore = JSON.parse(JSON.stringify(w.owned));
    const r = P.openPack(w, 'super', rng);
    assert.equal(w.coins, Math.min(999999, coinsBefore - r.spent + r.refund));
    for (const k of ['hat', 'skin', 'back', 'color']) {
      assert.equal(new Set(w.owned[k]).size, w.owned[k].length, `no duplicates in owned.${k}`);
      assert.ok(ownedBefore[k].every((i) => w.owned[k].includes(i)), 'nothing is ever lost');
    }
    for (const c of r.cards) {
      if (c.type === 'item') {
        if (!c.isNew) {
          sawDupe = true;
          assert.equal(c.refund, P.DUPE_COINS[c.rarity]);
        } else assert.equal(c.refund, 0);
      } else {
        sawOutfit = true;
        if (!c.isNew) assert.equal(c.refund, P.DUPE_COINS[c.rarity] * 2);
        assert.equal(c.isNew, c.newPieces.length > 0);
      }
    }
    w.coins = 999999;
  }
  assert.ok(sawDupe && sawOutfit);
  assert.ok(w.packs === 300);
});

test('packs: pity - after 10 packs without an Epic or better, the next pack has one', async () => {
  const shop = await load('shop.js');
  const P = await load('packs.js');
  const w = shop.emptyWallet();
  w.coins = 999999;
  w.pity = P.PITY_LIMIT;
  // an rng that always rolls the lowest rarity
  const r = P.openPack(w, 'basic', () => 0.0001);
  assert.ok(Math.max(...r.cards.map((c) => c.rarity)) >= 3, 'pity gave an Epic+');
  assert.equal(r.pityUsed, true);
  assert.equal(w.pity, 0, 'counter resets');
  // below the limit: nothing is forced and the counter climbs
  w.pity = 3;
  const r2 = P.openPack(w, 'basic', () => 0.0001);
  assert.equal(r2.pityUsed, false);
  assert.equal(w.pity, 4);
  // an Epic by luck also resets it
  w.pity = 5;
  P.openPack(w, 'legend', () => 0.5);
  assert.equal(w.pity, 0);
});

test('outfits: you can wear one only when you own all three pieces', async () => {
  const shop = await load('shop.js');
  const P = await load('packs.js');
  const o = P.OUTFITS.find((x) => x.rarity >= 2); // all pieces are pack-only, nothing is owned by default
  const w = shop.emptyWallet();
  const look = { color: 3, hat: 0, skin: 0, back: 0, name: 'Z' };
  assert.equal(P.wearOutfit(w, look, o), null);
  assert.equal(P.outfitProgress(w, o).have, 0);
  shop.grant(w, 'skin', o.skin);
  shop.grant(w, 'back', o.back);
  assert.equal(P.outfitProgress(w, o).have, 2);
  assert.equal(P.wearOutfit(w, look, o), null);
  shop.grant(w, 'hat', o.hat);
  const worn = P.wearOutfit(w, look, o);
  assert.deepEqual([worn.skin, worn.back, worn.hat, worn.color, worn.name], [o.skin, o.back, o.hat, 3, 'Z']);
});

test('wallet: pity and packs counters survive saving, and hostile saved data is cleaned up', async () => {
  const shop = await load('shop.js');
  const w = shop.emptyWallet();
  w.pity = 4;
  w.packs = 9;
  w.owned.back.push(3, 3, 999, -1, 'x');
  const store = {};
  const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  shop.saveWallet(storage, w);
  const back = shop.loadWallet(storage);
  assert.equal(back.pity, 4);
  assert.equal(back.packs, 9);
  assert.deepEqual(back.owned.back, [0, 3]);

  const evil = shop.normalizeWallet({ coins: 5, pity: -5, packs: 'lots', owned: { back: [1e9, 2.5, null], hat: 'x', skin: {} } });
  assert.ok(evil.pity >= 0 && Number.isInteger(evil.pity));
  assert.ok(Number.isInteger(evil.packs) && evil.packs >= 0);
  for (const k of ['hat', 'skin', 'back', 'color']) assert.ok(evil.owned[k].includes(0), `${k}: the free default is always owned`);
  const old = shop.normalizeWallet({ coins: 10, owned: { hat: [0], skin: [0], color: [0] } }); // a wallet from before back items
  assert.deepEqual(old.owned.back, [0]);
  assert.equal(old.pity, 0);
});

test('sanitizeLook: a saved look with a back item you do not own is swapped for one you do', async () => {
  const shop = await load('shop.js');
  const w = shop.emptyWallet();
  const fixed = shop.sanitizeLook(w, { color: 0, hat: 0, skin: 0, back: 7 });
  assert.equal(fixed.back, 0);
  shop.grant(w, 'back', 7);
  assert.equal(shop.sanitizeLook(w, { color: 0, hat: 0, skin: 0, back: 7 }).back, 7);
});

test('wardrobe: every back item, pack skin and fun hat draws without throwing (fake canvas)', async () => {
  const W = await load('wardrobe.js');
  const C = await load('constants.js');
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get: (t, k) => {
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
        if (k === 'measureText') return () => ({ width: 10 });
        return typeof t[k] === 'undefined' ? (...a) => { calls.push(k); } : t[k];
      },
      set: (t, k, v) => { t[k] = v; return true; },
    }
  );
  for (let b = 1; b < C.BACKS.length; b++) {
    for (const t of [0, 1.3]) {
      W.drawBackBehind(ctx, b, { walk: 0.5, fx: 1, t });
      W.drawBackFront(ctx, b, { walk: 0.5, fx: -1, t });
    }
  }
  for (let s = 24; s < C.SKINS.length; s++) W.drawPackSkin(ctx, s, '#e66');
  for (let h = 28; h < C.HATS.length; h++) {
    for (const mood of ['normal', 'scared', 'dizzy', 'happy']) {
      for (const t of [0, 0.7, 2.5, 4.6, 5.9, 11]) W.drawFunHat(ctx, h, t, mood);
    }
  }
  for (let h = 22; h < 28; h++) W.drawPackHat(ctx, h, 1);
  assert.ok(calls.length > 100);
});

// ---------------------------------------------------------------- server
test('server: the back item is range-checked, kept, and shown to everyone', async () => {
  const server = createGameServer({ quiet: true, config: {} });
  const port = await server.start(0, '127.0.0.1');
  const mk = () =>
    new Promise((resolve) => {
      const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
      s.state = null;
      s.on('room:state', (st) => { s.state = st; });
      s.on('connect', () => resolve(s));
    });
  const ask = (s, ev, data) => new Promise((resolve) => s.emit(ev, data, resolve));
  const until = async (fn) => {
    for (let i = 0; i < 200; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error('timeout');
  };
  const a = await mk();
  const b = await mk();
  try {
    const created = await ask(a, 'room:create', { name: 'Cape', color: 1, hat: 30, skin: 30, back: 21 });
    assert.equal(created.ok, true);
    await until(() => a.state);
    assert.equal(a.state.players[0].back, 21);
    assert.equal(a.state.players[0].hat, 30);
    await ask(b, 'room:join', { code: created.code, name: 'Viewer', back: 99999 });
    await until(() => a.state.players.length === 2);
    assert.equal(a.state.players[1].back, cfg.BACK_COUNT - 1, 'too-big index is clamped');
    a.emit('room:customize', { back: 5 });
    await until(() => b.state && b.state.players.find((p) => p.name === 'Cape').back === 5);
    a.emit('room:customize', { back: 'x' });
    a.emit('room:customize', { back: -3 });
    await new Promise((r) => setTimeout(r, 100));
    const me = b.state.players.find((p) => p.name === 'Cape');
    assert.ok(Number.isInteger(me.back) && me.back >= 0 && me.back < cfg.BACK_COUNT);
  } finally {
    a.close();
    b.close();
    await server.stop();
  }
});
