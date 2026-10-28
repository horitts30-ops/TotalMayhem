'use strict';

// Tests for TRADES (server/trade.js and the wallet rules in public/js/shop.js). Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { io } = require('socket.io-client');
const { createGameServer } = require('../server/app');

const loadShop = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'shop.js')).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (s, ev, data) => new Promise((resolve) => s.emit(ev, data, resolve));
async function until(fn, ms = 3000, what = 'condition') {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function withTwo(body, config = {}) {
  const server = createGameServer({ quiet: true, config: { TRADE_REQUEST_GAP_MS: 0, INTRO_MS: 200, ...config } });
  const port = await server.start(0, '127.0.0.1');
  const socks = [];
  const mk = (name) =>
    new Promise((resolve) => {
      const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
      s.log = [];
      s.trade = null;
      s.on('trade:state', (v) => { s.trade = v; s.log.push(['state', v]); });
      s.on('trade:closed', (c) => { s.trade = null; s.log.push(['closed', c]); });
      s.on('trade:confirm', (c) => s.log.push(['confirm', c]));
      s.on('trade:done', (d) => s.log.push(['done', d]));
      s.on('connect', () => resolve(s));
      socks.push(s);
      s.myName = name;
    });
  try {
    const a = await mk('Ann');
    const b = await mk('Bob');
    const ca = await ask(a, 'room:create', { name: 'Ann' });
    const cb = await ask(b, 'room:join', { code: ca.code, name: 'Bob' });
    a.id = ca.playerId;
    b.id = cb.playerId;
    a.token = ca.token;
    a.code = ca.code;
    await until(() => a.state !== undefined || true);
    await sleep(80);
    await body({ a, b, server, port, mk });
  } finally {
    socks.forEach((s) => s.close());
    await server.stop();
  }
}
const last = (s, kind) => [...s.log].reverse().find((e) => e[0] === kind);

async function openWindow(a, b) {
  assert.equal((await ask(a, 'trade:request', { to: b.id })).ok, true);
  await until(() => b.trade && b.trade.state === 'invite', 2000, 'invite');
  assert.equal(b.trade.initiator, false);
  assert.equal(a.trade.initiator, true);
  assert.equal((await ask(b, 'trade:answer', { id: b.trade.id, yes: true })).ok, true);
  await until(() => a.trade && a.trade.state === 'open' && b.trade && b.trade.state === 'open', 2000, 'open');
}

test('trade: ask, say yes, offer, both accept, both confirm -> done for both with the right sides', async () => {
  await withTwo(async ({ a, b }) => {
    await openWindow(a, b);
    assert.equal((await ask(a, 'trade:offer', { id: a.trade.id, coins: 50, items: [{ kind: 'hat', index: 3 }] })).ok, true);
    assert.equal((await ask(b, 'trade:offer', { id: b.trade.id, coins: 0, items: [{ kind: 'skin', index: 5 }, { kind: 'back', index: 2 }] })).ok, true);
    await until(() => a.trade.theirs.items.length === 2 && b.trade.theirs.coins === 50, 2000, 'offers seen by the other side');
    assert.equal(a.trade.mine.coins, 50);
    assert.deepEqual(b.trade.theirs.items, [{ kind: 'hat', index: 3 }]);
    assert.equal((await ask(a, 'trade:accept', { id: a.trade.id, rev: a.trade.rev })).ok, true);
    await until(() => a.trade.mine.accepted && b.trade.theirs.accepted, 2000, 'a accepted');
    assert.equal(b.trade.mine.accepted, false);
    assert.equal((await ask(b, 'trade:accept', { id: b.trade.id, rev: b.trade.rev })).ok, true);
    await until(() => last(a, 'confirm') && last(b, 'confirm'), 2000, 'confirm asked of both');
    assert.equal(last(a, 'done'), undefined, 'nothing is done before both confirm');
    await ask(a, 'trade:commit', { id: a.trade.id, rev: a.trade.rev, ok: true });
    await sleep(60);
    assert.equal(last(b, 'done'), undefined, 'one confirmation is not enough');
    await ask(b, 'trade:commit', { id: b.trade.id, rev: b.trade.rev, ok: true });
    const da = (await until(() => last(a, 'done'), 2000, 'done for a'))[1];
    const db = (await until(() => last(b, 'done'), 2000, 'done for b'))[1];
    assert.equal(da.id, db.id);
    assert.deepEqual(da.give, { coins: 50, items: [{ kind: 'hat', index: 3 }] });
    assert.deepEqual(da.get, { coins: 0, items: [{ kind: 'skin', index: 5 }, { kind: 'back', index: 2 }] });
    assert.deepEqual(db.give, da.get);
    assert.deepEqual(db.get, da.give);
    // and the window is gone: no more trade actions work on it
    assert.equal((await ask(a, 'trade:offer', { id: da.id, coins: 1, items: [] })).ok, false);
  });
});

test('trade: changing the offer after somebody accepted clears every Accept; a stale Accept is refused', async () => {
  await withTwo(async ({ a, b }) => {
    await openWindow(a, b);
    await ask(a, 'trade:offer', { id: a.trade.id, coins: 10, items: [] });
    await until(() => b.trade.theirs.coins === 10);
    const oldRev = b.trade.rev;
    assert.equal((await ask(b, 'trade:accept', { id: b.trade.id, rev: oldRev })).ok, true);
    await until(() => a.trade.theirs.accepted);
    // A sneaks in a change after B accepted
    await ask(a, 'trade:offer', { id: a.trade.id, coins: 500, items: [] });
    await until(() => b.trade.theirs.coins === 500);
    assert.equal(b.trade.mine.accepted, false, 'B is no longer accepted');
    assert.equal(a.trade.theirs.accepted, false);
    const stale = await ask(b, 'trade:accept', { id: b.trade.id, rev: oldRev });
    assert.equal(stale.ok, false, 'accepting the old version is refused');
    assert.equal(last(a, 'done'), undefined);
  });
});

test('trade: one side cannot do it (commit false) -> the trade is cancelled and nothing is done', async () => {
  await withTwo(async ({ a, b }) => {
    await openWindow(a, b);
    await ask(a, 'trade:offer', { id: a.trade.id, coins: 10, items: [] });
    await until(() => b.trade.theirs.coins === 10);
    await ask(a, 'trade:accept', { id: a.trade.id, rev: a.trade.rev });
    await ask(b, 'trade:accept', { id: b.trade.id, rev: b.trade.rev });
    await until(() => last(a, 'confirm') && last(b, 'confirm'));
    const rev = last(a, 'confirm')[1].rev;
    await ask(a, 'trade:commit', { id: a.trade.id, rev, ok: true });
    await ask(b, 'trade:commit', { id: b.trade.id, rev, ok: false });
    await until(() => last(a, 'closed') && last(b, 'closed'), 2000, 'closed');
    assert.equal(last(a, 'done'), undefined);
    assert.equal(last(b, 'done'), undefined);
    assert.match(last(a, 'closed')[1].reason, /cannot do this trade/);
  });
});

test('trade: empty trades cannot be accepted; bad offers are rejected (coins, items, duplicates, default items, too many)', async () => {
  await withTwo(async ({ a, b }) => {
    await openWindow(a, b);
    assert.equal((await ask(a, 'trade:accept', { id: a.trade.id, rev: a.trade.rev })).ok, false, 'nothing in the trade');
    const bad = [
      { coins: -1, items: [] },
      { coins: 1.5, items: [] },
      { coins: 'lots', items: [] },
      { coins: 100000, items: [] },
      { coins: 0, items: 'hat' },
      { coins: 0, items: [{ kind: 'hat', index: 0 }] }, // the free default
      { coins: 0, items: [{ kind: 'hat', index: 9999 }] },
      { coins: 0, items: [{ kind: 'nope', index: 1 }] },
      { coins: 0, items: [{ kind: 'hat', index: 3 }, { kind: 'hat', index: 3 }] },
      { coins: 0, items: Array.from({ length: 7 }, (_, i) => ({ kind: 'hat', index: i + 1 })) },
      { coins: 0, items: [null] },
    ];
    for (const offer of bad) assert.equal((await ask(a, 'trade:offer', { id: a.trade.id, ...offer })).ok, false, JSON.stringify(offer));
    assert.equal(a.trade.mine.coins, 0);
    assert.equal((await ask(a, 'trade:offer', { id: a.trade.id, coins: 99999, items: [{ kind: 'color', index: 4 }] })).ok, true);
    // junk to the handlers never crashes anything
    for (const junk of [null, undefined, 5, 'x', [], { id: 7 }]) {
      await ask(a, 'trade:accept', junk);
      await ask(a, 'trade:commit', junk);
      await ask(a, 'trade:answer', junk);
    }
    await sleep(1100); // (the junk above used up this connection's 20-messages-a-second allowance)
    assert.equal((await ask(a, 'trade:offer', { id: a.trade.id, coins: 1, items: [] })).ok, true, 'the server is still fine');
  });
});

test('trade: only people in the same room, one trade at a time, no self-trade, and a stranger cannot touch your trade', async () => {
  await withTwo(async ({ a, b, mk, port }) => {
    assert.equal((await ask(a, 'trade:request', { to: a.id })).ok, false, 'not yourself');
    assert.equal((await ask(a, 'trade:request', { to: 'nobody' })).ok, false);
    const c = await mk('Cat');
    const cc = await ask(c, 'room:join', { code: a.code, name: 'Cat' });
    c.id = cc.playerId;
    await sleep(60);
    await openWindow(a, b);
    assert.equal((await ask(c, 'trade:request', { to: a.id })).ok, false, 'a is busy');
    assert.equal((await ask(a, 'trade:request', { to: c.id })).ok, false, 'a already has a trade');
    // C tries to mess with A and B's trade
    const tid = a.trade.id;
    assert.equal((await ask(c, 'trade:offer', { id: tid, coins: 5, items: [] })).ok, false);
    assert.equal((await ask(c, 'trade:accept', { id: tid, rev: 1 })).ok, false);
    await ask(c, 'trade:cancel', { id: tid });
    await sleep(50);
    assert.ok(a.trade && b.trade, "C's cancel did nothing");
    // a player in ANOTHER room cannot be asked
    const other = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
    await new Promise((r) => other.on('connect', r));
    const oc = await ask(other, 'room:create', { name: 'Zed' });
    assert.equal((await ask(other, 'trade:request', { to: a.id })).ok, false, 'different room');
    assert.equal((await ask(a, 'trade:request', { to: oc.playerId })).ok, false);
    other.close();
  });
});

test('trade: a "no thanks" or a cancel closes it for both, and leaving or disconnecting cancels it', async () => {
  await withTwo(async ({ a, b }) => {
    assert.equal((await ask(a, 'trade:request', { to: b.id })).ok, true);
    await until(() => b.trade);
    await ask(b, 'trade:answer', { id: b.trade.id, yes: false });
    await until(() => last(a, 'closed'), 2000, 'a told no');
    assert.match(last(a, 'closed')[1].reason, /no thanks/);

    await openWindow(a, b);
    await ask(a, 'trade:cancel', { id: a.trade.id });
    await until(() => !a.trade && !b.trade);

    await openWindow(a, b);
    a.close();
    await until(() => last(b, 'closed') && b.trade === null, 2000, 'b told a left');
    // b can trade again afterwards
    assert.equal(b.trade, null);
  });
});

test('trade: only in the lobby - starting a match cancels an open trade, and you cannot ask mid-match', async () => {
  await withTwo(async ({ a, b }) => {
    await openWindow(a, b);
    b.emit('room:ready', true);
    const r = await ask(a, 'match:start', null);
    assert.equal(r.ok, true);
    await until(() => last(a, 'closed') && last(b, 'closed'), 3000, 'trade cancelled by the match start');
    assert.match(last(a, 'closed')[1].reason, /match is starting/);
    assert.equal((await ask(a, 'trade:request', { to: b.id })).ok, false, 'no trading mid-match');
  }, { SCHEDULE_OVERRIDE: [{ game: 'goldGrab', variant: 'classic' }] });
});

test('trade: requests are rate-limited', async () => {
  await withTwo(async ({ a, b }) => {
    const first = await ask(a, 'trade:request', { to: b.id });
    assert.equal(first.ok, true);
    await ask(a, 'trade:cancel', { id: a.trade.id });
    const second = await ask(a, 'trade:request', { to: b.id });
    assert.equal(second.ok, false);
    assert.match(second.error, /Slow down/);
  }, { TRADE_REQUEST_GAP_MS: 5000 });
});

test('trade: a finished trade is re-sent to a browser that was offline, until it acknowledges', async () => {
  await withTwo(async ({ a, b }) => {
    await openWindow(a, b);
    await ask(a, 'trade:offer', { id: a.trade.id, coins: 7, items: [] });
    await until(() => b.trade.theirs.coins === 7);
    await ask(a, 'trade:accept', { id: a.trade.id, rev: a.trade.rev });
    await ask(b, 'trade:accept', { id: b.trade.id, rev: b.trade.rev });
    await until(() => last(a, 'confirm') && last(b, 'confirm'));
    const rev = last(a, 'confirm')[1].rev;
    await ask(a, 'trade:commit', { id: a.trade.id, rev, ok: true });
    await ask(b, 'trade:commit', { id: b.trade.id, rev, ok: true });
    await until(() => last(a, 'done') && last(b, 'done'));
    const before = b.log.filter((e) => e[0] === 'done').length;
    await ask(b, 'trade:pending', {});
    await until(() => b.log.filter((e) => e[0] === 'done').length === before + 1, 2000, 'resent');
    await ask(b, 'trade:ack', { id: last(b, 'done')[1].id });
    await ask(b, 'trade:pending', {});
    await sleep(100);
    assert.equal(b.log.filter((e) => e[0] === 'done').length, before + 1, 'after the ack it is not sent again');
  });
});

// ------------------------------------------------------------------ wallet rules (public/js/shop.js)
test('wallet: which items can be traded (not free starters, not trophy items; yes bought and pack items)', async () => {
  const shop = await loadShop();
  let tradable = 0;
  for (const k of shop.KINDS) {
    for (const it of shop.catalogue(k)) {
      const t = shop.isTradable(k, it.index);
      if (it.price === 0 || it.price === shop.UNLOCK_ONLY) assert.equal(t, false, `${k} ${it.name}`);
      else {
        assert.equal(t, true, `${k} ${it.name}`);
        tradable++;
      }
    }
  }
  assert.ok(tradable > 60);
  assert.equal(shop.isTradable('hat', -1), false);
  assert.equal(shop.isTradable('nope', 1), false);
  assert.equal(shop.isTradable('hat', 1.5), false);
});

function twoWallets(shop) {
  const a = shop.emptyWallet();
  const b = shop.emptyWallet();
  const priced = (k) => shop.catalogue(k).filter((it) => it.price > 0).map((it) => it.index);
  return { a, b, hat: priced('hat'), skin: priced('skin'), back: shop.catalogue('back').filter((it) => it.price !== 0 && it.price !== shop.UNLOCK_ONLY).map((it) => it.index) };
}

test('wallet: a trade moves exactly the coins and items, both ways, and conserves everything', async () => {
  const shop = await loadShop();
  const { a, b, hat, skin } = twoWallets(shop);
  a.coins = 500;
  b.coins = 20;
  shop.grant(a, 'hat', hat[0]);
  shop.grant(a, 'hat', hat[1]);
  shop.grant(b, 'skin', skin[0]);
  const giveA = { coins: 100, items: [{ kind: 'hat', index: hat[0] }] };
  const giveB = { coins: 5, items: [{ kind: 'skin', index: skin[0] }] };
  assert.equal(shop.checkTrade(a, giveA, giveB), null);
  assert.equal(shop.checkTrade(b, giveB, giveA), null);
  const total = a.coins + b.coins;
  assert.deepEqual(shop.applyTrade(a, 't1', giveA, giveB), { ok: true });
  assert.deepEqual(shop.applyTrade(b, 't1', giveB, giveA), { ok: true });
  assert.equal(a.coins, 500 - 100 + 5);
  assert.equal(b.coins, 20 - 5 + 100);
  assert.equal(a.coins + b.coins, total, 'no coins appear or vanish');
  assert.equal(shop.owns(a, 'hat', hat[0]), false);
  assert.equal(shop.owns(b, 'hat', hat[0]), true);
  assert.equal(shop.owns(a, 'skin', skin[0]), true);
  assert.equal(shop.owns(b, 'skin', skin[0]), false);
  assert.equal(shop.owns(a, 'hat', hat[1]), true, 'untouched items stay');
  assert.equal(shop.owns(a, 'hat', 0), true, 'the free default is always kept');
});

test('wallet: a trade is refused when you lack the coins/items, already own what you would get, or it is not tradable', async () => {
  const shop = await loadShop();
  const { a, b, hat, skin } = twoWallets(shop);
  a.coins = 50;
  shop.grant(a, 'hat', hat[0]);
  shop.grant(b, 'hat', hat[0]);
  const none = { coins: 0, items: [] };
  assert.match(shop.checkTrade(a, { coins: 51, items: [] }, none), /only have 50/);
  assert.match(shop.checkTrade(a, { coins: 0, items: [{ kind: 'hat', index: hat[1] }] }, none), /do not own/);
  assert.match(shop.checkTrade(a, none, { coins: 0, items: [{ kind: 'hat', index: hat[0] }] }), /already own/);
  assert.ok(shop.checkTrade(a, { coins: 0, items: [{ kind: 'hat', index: 0 }] }, none), 'the free default cannot be given');
  const trophy = shop.catalogue('hat').find((it) => it.price === shop.UNLOCK_ONLY);
  assert.ok(trophy);
  assert.ok(shop.checkTrade(a, none, { coins: 0, items: [{ kind: 'hat', index: trophy.index }] }), 'trophy items cannot be traded');
  assert.ok(shop.checkTrade(a, { coins: -5, items: [] }, none));
  assert.ok(shop.checkTrade(a, { coins: 1.5, items: [] }, none));
  assert.ok(shop.checkTrade(a, none, { coins: 100000, items: [] }));
  assert.ok(shop.checkTrade(a, none, null));
  a.coins = 999990;
  assert.match(shop.checkTrade(a, none, { coins: 50, items: [] }), /more coins than/);
  // a refused trade changes nothing
  const before = JSON.stringify(a);
  assert.equal(shop.applyTrade(a, 'tx', { coins: 99999999, items: [] }, none).ok, false);
  assert.equal(JSON.stringify(a), before);
});

test('wallet: the same finished trade is never applied twice (re-sent after a dropped connection)', async () => {
  const shop = await loadShop();
  const { a } = twoWallets(shop);
  a.coins = 100;
  const give = { coins: 40, items: [] };
  const get = { coins: 0, items: [] };
  assert.deepEqual(shop.applyTrade(a, 'same', give, get), { ok: true });
  assert.equal(a.coins, 60);
  assert.deepEqual(shop.applyTrade(a, 'same', give, get), { ok: true, repeat: true });
  assert.equal(a.coins, 60, 'second time does nothing');
  assert.equal(shop.applyTrade(a, '', give, get).ok, false);
  // it survives saving and loading, and hostile saved data is cleaned
  const store = {};
  const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  shop.saveWallet(storage, a);
  assert.deepEqual(shop.loadWallet(storage).trades, ['same']);
  const evil = shop.normalizeWallet({ coins: 1, trades: [1, null, 'ok', 'x'.repeat(50), ...Array.from({ length: 40 }, (_, i) => `t${i}`)] });
  assert.ok(evil.trades.every((t) => typeof t === 'string' && t.length <= 20));
  assert.ok(evil.trades.length <= 20);
  assert.deepEqual(shop.normalizeWallet({}).trades, []);
});
