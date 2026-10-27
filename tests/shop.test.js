'use strict';

// Tests for the coin rewards (server/rewards.js) and the shop rules
// (public/js/shop.js, an ES module, so we load it with import()).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { REWARD, roundReward, finalReward } = require('../server/rewards');

const loadShop = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'shop.js')).href);

// ----------------------------------------------------------------- rewards
test('rewards: everybody who plays with others earns at least the participation coins', () => {
  const last = roundReward({ place: 8, points: 1, abandoned: false, title: '' }, 8);
  assert.equal(last.coins, REWARD.participation + 1);
  assert.ok(last.coins >= REWARD.participation);
});

test('rewards: winning and titles add a little, never a lot', () => {
  const plain = roundReward({ place: 2, points: 8, abandoned: false, title: '' }, 4).coins;
  const winner = roundReward({ place: 1, points: 10, abandoned: false, title: 'Coin Goblin' }, 4);
  assert.equal(winner.coins, REWARD.participation + 10 + REWARD.firstPlaceBonus + REWARD.titleBonus);
  assert.ok(winner.coins < plain * 2, 'the winner earns well under double what second place earns');
  assert.ok(winner.parts.some((p) => /win/.test(p)));
});

test('rewards: leaving mid-round earns nothing, solo practice earns a small flat amount', () => {
  assert.equal(roundReward({ place: 3, points: 0, abandoned: true }, 4).coins, 0);
  assert.equal(roundReward({ place: 1, points: 10, abandoned: false }, 1).coins, REWARD.soloFlat);
  assert.equal(roundReward(null, 4).coins, 0);
});

test('rewards: odd values never produce negative or fractional coins', () => {
  const r = roundReward({ place: 2, points: -5.7, abandoned: false }, 3);
  assert.equal(r.coins, REWARD.participation);
  const r2 = roundReward({ place: 2, points: 'lots', abandoned: false }, 3);
  assert.equal(r2.coins, REWARD.participation);
});

test('rewards: final bonus needs company and a connected player; winners get more', () => {
  assert.equal(finalReward({ place: 1, connected: true }, true), REWARD.finalWin);
  assert.equal(finalReward({ place: 3, connected: true }, true), REWARD.finalFinish);
  assert.equal(finalReward({ place: 1, connected: true }, false), 0);
  assert.equal(finalReward({ place: 1, connected: false }, true), 0);
});

// -------------------------------------------------------------------- shop
test('shop: a fresh wallet owns exactly the free items and has no coins', async () => {
  const shop = await loadShop();
  const w = shop.emptyWallet();
  assert.equal(w.coins, 0);
  for (const k of shop.KINDS) {
    for (const item of shop.catalogue(k)) {
      assert.equal(shop.owns(w, k, item.index), item.price === 0, `${k} ${item.name}`);
    }
    assert.ok(w.owned[k].length >= 1, `there is always something free to wear (${k})`);
  }
  assert.ok(shop.owns(w, 'hat', 0), 'No hat is free');
  assert.ok(shop.owns(w, 'skin', 0), 'Plain is free');
});

test('shop: prices line up with the catalogue sizes; only -1 ("unlock only") is ever negative', async () => {
  const shop = await loadShop();
  const cfg = require('../server/config');
  assert.equal(shop.countOf('hat'), cfg.HAT_COUNT);
  assert.equal(shop.countOf('skin'), cfg.SKIN_COUNT);
  assert.equal(shop.countOf('color'), cfg.COLOR_COUNT);
  for (const k of shop.KINDS) for (const it of shop.catalogue(k)) assert.ok(Number.isInteger(it.price) && (it.price >= 0 || it.price === shop.UNLOCK_ONLY));
});

test('shop: buying takes the exact price, adds the item and refuses when too poor', async () => {
  const shop = await loadShop();
  const w = shop.emptyWallet();
  const crown = 2; // costs 150
  assert.equal(shop.priceOf('hat', crown), 150);
  const poor = shop.buy(w, 'hat', crown);
  assert.equal(poor.ok, false);
  assert.match(poor.error, /150 more/);
  assert.equal(w.coins, 0);
  assert.equal(shop.owns(w, 'hat', crown), false);

  shop.credit(w, 160, 'm1:r1');
  const ok = shop.buy(w, 'hat', crown);
  assert.equal(ok.ok, true);
  assert.equal(w.coins, 10);
  assert.ok(shop.owns(w, 'hat', crown));

  const again = shop.buy(w, 'hat', crown);
  assert.equal(again.ok, false, 'cannot pay twice for the same item');
  assert.equal(w.coins, 10);
});

test('shop: buying rejects nonsense items without touching the wallet', async () => {
  const shop = await loadShop();
  const w = shop.emptyWallet();
  shop.credit(w, 500, 'x');
  for (const [kind, idx] of [['hat', -1], ['hat', 99], ['hat', 1.5], ['cape', 1], ['skin', '3'], [undefined, 0]]) {
    assert.equal(shop.buy(w, kind, idx).ok, false, `${kind} ${idx}`);
  }
  assert.equal(w.coins, 500);
});

test('shop: coins for the same round are only paid once, even if the screen is replayed', async () => {
  const shop = await loadShop();
  const w = shop.emptyWallet();
  assert.equal(shop.credit(w, 15, 'abc-1:r1'), 15);
  assert.equal(shop.credit(w, 15, 'abc-1:r1'), 0);
  assert.equal(shop.credit(w, 15, 'abc-1:r2'), 15);
  assert.equal(w.coins, 30);
  assert.equal(shop.credit(w, 0, 'k'), 0);
  assert.equal(shop.credit(w, -5, 'k2'), 0);
  assert.equal(shop.credit(w, NaN, 'k3'), 0);
  assert.equal(shop.credit(w, 5, ''), 0);
  assert.equal(w.coins, 30);
});

test('shop: the "already paid" list stays short', async () => {
  const shop = await loadShop();
  const w = shop.emptyWallet();
  for (let i = 0; i < 100; i++) shop.credit(w, 1, `k${i}`);
  assert.ok(w.paid.length <= 40);
  assert.equal(w.coins, 100);
});

test('shop: a damaged or hand-edited save is repaired safely', async () => {
  const shop = await loadShop();
  const w = shop.normalizeWallet({ coins: 'lots', owned: { hat: [2, 2, -4, 'x', 999, 3], skin: 'nope' }, paid: [1, 'a'] });
  assert.equal(w.coins, 0);
  assert.deepEqual(w.owned.hat.filter((i) => i === 2), [2], 'no duplicates');
  assert.ok(!w.owned.hat.includes(999) && !w.owned.hat.includes(-4));
  assert.ok(w.owned.skin.includes(0));
  assert.deepEqual(w.paid, ['a']);
  assert.equal(shop.loadWallet({ getItem: () => '{not json' }).coins, 0);
  assert.equal(shop.loadWallet({ getItem: () => { throw new Error('blocked'); } }).coins, 0);
  assert.equal(shop.normalizeWallet({ coins: -50 }).coins, 0);
});

test('shop: the < > buttons only step through owned items and wrap around', async () => {
  const shop = await loadShop();
  const w = shop.emptyWallet();
  const free = [...w.owned.hat];
  let cur = free[0];
  const seen = [cur];
  for (let i = 0; i < free.length; i++) {
    cur = shop.nextOwned(w, 'hat', cur, 1);
    seen.push(cur);
  }
  assert.deepEqual(seen.slice(0, free.length), free, 'visits every owned hat in order');
  assert.equal(seen[free.length], free[0], 'wraps back to the start');
  assert.ok(shop.owns(w, 'hat', shop.nextOwned(w, 'hat', free[0], -1)), 'stepping back also lands on an owned hat');
});

test('shop: an old saved look with unowned items is swapped for something owned', async () => {
  const shop = await loadShop();
  const w = shop.emptyWallet();
  const look = shop.sanitizeLook(w, { name: 'Ann', color: 11, hat: 2, skin: 7 });
  assert.ok(shop.owns(w, 'color', look.color));
  assert.ok(shop.owns(w, 'hat', look.hat));
  assert.ok(shop.owns(w, 'skin', look.skin));
  shop.credit(w, 400, 'z');
  shop.buy(w, 'hat', 2);
  assert.equal(shop.sanitizeLook(w, { color: 0, hat: 2, skin: 0 }).hat, 2, 'owned items are kept');
});

test('shop: a normal match earns enough that the cheap items are a short grind', async () => {
  const shop = await loadShop();
  // 3 rounds with 4 players, finishing mid-table every time + match finish bonus.
  let total = REWARD.finalFinish;
  for (const place of [2, 3, 2]) total += roundReward({ place, points: Math.round((10 * (4 - place + 1)) / 4), abandoned: false }, 4).coins;
  assert.ok(total >= 40, `one match should pay for a 40 coin item (earned ${total})`);
  assert.ok(total <= 80, `but not for the whole shop (earned ${total})`);
  const priciest = Math.max(...shop.KINDS.flatMap((k) => shop.catalogue(k).map((i) => i.price)));
  assert.ok(priciest / total >= 2, 'the best items take a few matches');
});

test('shop: unlock-only items cannot be bought with any number of coins, but can be granted', async () => {
  const shop = await loadShop();
  const w = shop.emptyWallet();
  shop.credit(w, 99999, 'rich');
  const unlockOnly = [];
  for (const k of shop.KINDS) for (const it of shop.catalogue(k)) if (it.price === shop.UNLOCK_ONLY) unlockOnly.push(it);
  assert.equal(unlockOnly.length, 10, '6 hats + 4 skins are earned, not bought');
  for (const it of unlockOnly) {
    assert.equal(shop.owns(w, it.kind, it.index), false, `${it.name} is not owned by default`);
    const res = shop.buy(w, it.kind, it.index);
    assert.equal(res.ok, false);
    assert.match(res.error, /achievement/i);
  }
  assert.equal(w.coins, 99999, 'a refused purchase costs nothing');
  const first = unlockOnly[0];
  assert.equal(shop.grant(w, first.kind, first.index), true);
  assert.equal(shop.owns(w, first.kind, first.index), true);
  assert.equal(shop.grant(w, first.kind, first.index), false, 'granting twice changes nothing');
  assert.equal(shop.grant(w, 'hat', 999), false);
  assert.equal(shop.grant(w, 'cape', 1), false);
  assert.equal(w.coins, 99999);
});

test('shop: a saved look that wears a locked achievement item falls back to something owned', async () => {
  const shop = await loadShop();
  const w = shop.emptyWallet();
  const look = shop.sanitizeLook(w, { name: 'X', color: 0, hat: 16, skin: 11 });
  assert.equal(look.hat, 0);
  assert.equal(look.skin, 0);
  shop.grant(w, 'hat', 16);
  assert.equal(shop.sanitizeLook(w, { name: 'X', color: 0, hat: 16, skin: 0 }).hat, 16);
});
