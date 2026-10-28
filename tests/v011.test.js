'use strict';

// Tests for v0.11: the 12 new skins, the 20 new achievements and their tracking.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const cfg = require('../server/config');
const { MAP_IDS } = require('../server/maps');

const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', f)).href);
const row = (o = {}) => ({ id: 'me', place: 2, abandoned: false, jumps: 0, shoves: 0, hitsTaken: 0, kos: 0, title: '', ...o });
let matchNo = 0;
const rnd = (o = {}) => ({ matchId: `m${++matchNo}`, round: 1, game: 'goldGrab', players: 3, map: '', rage: false, ...o });
const ids = (list) => list.map((a) => a.id);

test('there are 37 skins, the server accepts all of them, and 8 are unlock-only', async () => {
  const C = await load('constants.js');
  const shop = await load('shop.js');
  assert.equal(C.SKINS.length, 37);
  assert.equal(cfg.SKIN_COUNT, 37);
  assert.equal(new Set(C.SKINS).size, 37, 'skin names are unique');
  assert.equal(shop.catalogue('skin').filter((s) => s.price === shop.UNLOCK_ONLY).length, 8);
  // every skin that costs coins has a real price
  for (const s of shop.catalogue('skin')) assert.ok(s.price === shop.UNLOCK_ONLY || s.price === shop.PACK_ONLY || s.price >= 0, s.name);
  assert.ok(shop.catalogue('skin').slice(12, 20).every((s) => s.price >= 50), 'the new buyable skins are not free');
});

test('the server keeps a new skin index and rejects a bad one', () => {
  const { safeInt } = require('../server/util');
  assert.equal(safeInt(36, 0, cfg.SKIN_COUNT - 1, 0), 36);
  assert.equal(safeInt(37, 0, cfg.SKIN_COUNT - 1, 0), 36, 'clamped');
});

test('there are 52 achievements (20 new) and the new ones have names, icons and sane goals', async () => {
  const A = await load('achievements.js');
  assert.equal(A.ACHIEVEMENTS.length, 52);
  assert.equal(new Set(A.ACHIEVEMENTS.map((a) => a.name)).size, 52, 'names are unique');
  const fresh = A.ACHIEVEMENTS.slice(32);
  assert.equal(fresh.length, 20);
  for (const a of fresh) {
    assert.ok(a.name && a.desc && a.icon, a.id);
    assert.ok(a.goal >= 1 && a.goal <= 2000, a.id);
    assert.equal(typeof a.value(A.emptyTrophies().stats), 'number', a.id);
    assert.equal(a.value(A.emptyTrophies().stats), 0, `${a.id} starts at 0`);
  }
});

test('the four new unlock-only skins are each earned by one achievement', async () => {
  const A = await load('achievements.js');
  assert.equal(A.achievementFor('skin', 20).id, 'rage_win');
  assert.equal(A.achievementFor('skin', 21).id, 'cartographer');
  assert.equal(A.achievementFor('skin', 22).id, 'home_advantage');
  assert.equal(A.achievementFor('skin', 23).id, 'hoarder');
});

test('the client map list matches the server map list', async () => {
  const A = await load('achievements.js');
  assert.deepEqual([...A.ALL_MAPS].sort(), [...MAP_IDS].sort());
});

test('playing on 5 maps unlocks Map Hopper, all 11 unlock Cartographer and its Circuit skin', async () => {
  const A = await load('achievements.js');
  const shop = await load('shop.js');
  const t = A.emptyTrophies();
  let all = [];
  MAP_IDS.forEach((m, i) => {
    all = all.concat(A.recordRound(t, rnd({ map: m }), row()));
    if (i === 3) assert.ok(!ids(all).includes('map_hopper'), '4 maps is not enough');
  });
  assert.ok(ids(all).includes('map_hopper'));
  assert.ok(ids(all).includes('cartographer'));
  const w = shop.emptyWallet();
  A.applyRewards(t, w);
  assert.ok(shop.owns(w, 'skin', 21));
  // a made-up map id counts for nothing
  const t2 = A.emptyTrophies();
  A.recordRound(t2, rnd({ map: 'bogus' }), row());
  assert.equal(Object.keys(t2.stats.playedMaps).length, 0);
});

test('map wins only count with company and on that map', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  assert.ok(!ids(A.recordRound(t, rnd({ map: 'donut', players: 1 }), row({ place: 1 }))).includes('win_donut'), 'solo practice');
  assert.ok(!ids(A.recordRound(t, rnd({ map: 'table' }), row({ place: 2 }))).includes('win_table'), 'not first');
  assert.ok(ids(A.recordRound(t, rnd({ map: 'donut' }), row({ place: 1 }))).includes('win_donut'));
  assert.ok(!t.unlocked.win_table);
  for (const [m, id] of [['table', 'win_table'], ['stones', 'win_stones'], ['cheese', 'win_cheese'], ['peaks', 'win_peaks']]) {
    assert.ok(ids(A.recordRound(t, rnd({ map: m }), row({ place: 1 }))).includes(id), id);
  }
  // 5 different winning maps -> Home Advantage + Frost skin
  assert.ok(t.unlocked.home_advantage, 'donut, table, stones, cheese, peaks = 5 maps');
  const shop = await load('shop.js');
  const w = shop.emptyWallet();
  A.applyRewards(t, w);
  assert.ok(shop.owns(w, 'skin', 22));
});

test('Rage Bait achievements: finishing counts, winning needs company, 10 rounds for Cool Under Fire', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  assert.ok(ids(A.recordRound(t, rnd({ rage: true, players: 1 }), row({ place: 1 }))).includes('rage_play'), 'solo rage round counts as played');
  assert.ok(!t.unlocked.rage_win, 'but a solo win is not a win');
  assert.ok(ids(A.recordRound(t, rnd({ rage: true }), row({ place: 1 }))).includes('rage_win'));
  for (let i = 0; i < 8; i++) A.recordRound(t, rnd({ rage: true }), row());
  assert.ok(t.unlocked.rage_veteran, '10 rage rounds');
  assert.equal(t.stats.rageRounds, 10);
  const t2 = A.emptyTrophies();
  A.recordRound(t2, rnd({ rage: false }), row({ place: 1 }));
  assert.equal(t2.stats.rageRounds, 0, 'a normal round is not a rage round');
});

test('win streak counts rounds in a row, resets on a loss, ignores solo practice', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  A.recordRound(t, rnd(), row({ place: 1 }));
  A.recordRound(t, rnd(), row({ place: 1 }));
  A.recordRound(t, rnd({ players: 1 }), row({ place: 1 })); // solo: neither counts nor breaks
  assert.equal(t.stats.streak, 2);
  A.recordRound(t, rnd(), row({ place: 3 }));
  assert.equal(t.stats.streak, 0);
  assert.equal(t.stats.bestStreak, 2);
  assert.ok(!t.unlocked.on_a_roll);
  for (let i = 0; i < 3; i++) A.recordRound(t, rnd(), row({ place: 1 }));
  assert.ok(t.unlocked.on_a_roll);
});

test('Podium Regular needs 4+ players and a top-3 finish', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  for (let i = 0; i < 25; i++) A.recordRound(t, rnd({ players: 3 }), row({ place: 1 }));
  assert.equal(t.stats.podiums, 0, '3 players is not enough');
  for (let i = 0; i < 19; i++) A.recordRound(t, rnd({ players: 4 }), row({ place: 3 }));
  A.recordRound(t, rnd({ players: 4 }), row({ place: 4 }));
  assert.equal(t.stats.podiums, 19);
  assert.ok(!t.unlocked.podium);
  A.recordRound(t, rnd({ players: 5 }), row({ place: 2 }));
  assert.ok(t.unlocked.podium);
});

test('chat and emoji counters: 10 chats, 25 emoji, and all 8 different emoji', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  for (let i = 0; i < 9; i++) A.recordSocial(t, 'chat');
  assert.ok(!t.unlocked.chatty);
  assert.ok(ids(A.recordSocial(t, 'chat')).includes('chatty'));
  for (let i = 0; i < 7; i++) A.recordSocial(t, 'emoji', i);
  assert.ok(!t.unlocked.emoji_all);
  assert.ok(ids(A.recordSocial(t, 'emoji', 7)).includes('emoji_all'));
  assert.ok(!t.unlocked.emoji_fan, '8 emoji so far');
  for (let i = 0; i < 17; i++) A.recordSocial(t, 'emoji', 0);
  assert.ok(t.unlocked.emoji_fan, '25 emoji');
  // junk is ignored
  assert.deepEqual(A.recordSocial(t, 'nonsense'), []);
  A.recordSocial(t, 'emoji', 99);
  A.recordSocial(t, 'emoji', -1);
  assert.equal(Object.keys(t.stats.emotesUsed).length, 8);
});

test('long-term counters: Heavyweight, Trampoline, Round Veteran and Coin Hoarder (+ Disco skin)', async () => {
  const A = await load('achievements.js');
  const shop = await load('shop.js');
  const t = A.emptyTrophies();
  for (let i = 0; i < 100; i++) A.recordRound(t, rnd(), row({ shoves: 5, jumps: 10 }));
  for (const id of ['heavyweight', 'trampoline', 'veteran']) assert.ok(t.unlocked[id], id);
  assert.ok(!t.unlocked.hoarder);
  A.recordCoins(t, 1999);
  assert.ok(!t.unlocked.hoarder);
  A.recordCoins(t, 1);
  assert.ok(t.unlocked.hoarder);
  const w = shop.emptyWallet();
  A.applyRewards(t, w);
  assert.ok(shop.owns(w, 'skin', 23));
});

test('old saves (from before v0.11) load fine and new counters start at zero', async () => {
  const A = await load('achievements.js');
  const old = { stats: { rounds: 7, jumps: 50, wonGames: { goldGrab: true } }, unlocked: { first_round: 123 }, counted: ['a'] };
  const t = A.normalizeTrophies(old);
  assert.equal(t.stats.rounds, 7);
  assert.equal(t.stats.rageRounds, 0);
  assert.deepEqual(t.stats.playedMaps, {});
  assert.deepEqual(t.stats.emotesUsed, {});
  // hostile data in the new fields is cleaned
  const bad = A.normalizeTrophies({ stats: { playedMaps: { donut: true, evil: true, plus: 'yes' }, emotesUsed: { 0: true, 9: true }, chats: -5, bestStreak: 'x' } });
  assert.deepEqual(bad.stats.playedMaps, { donut: true });
  assert.deepEqual(bad.stats.emotesUsed, { 0: true });
  assert.equal(bad.stats.chats, 0);
  assert.equal(bad.stats.bestStreak, 0);
});

test('the server tells the browser which map and mode a round used', () => {
  const { Room } = require('../server/room');
  const io = { to: () => ({ emit() {} }), emit() {} };
  const room = new Room(io, 'TEST', { ...cfg }, { rng: () => 0.5 });
  room.hostId = 'h';
  room.setMap('h', 'cheese');
  room.setRage('h', true);
  room.schedule = [{ game: 'hotPotato', variant: 'classic' }];
  room.beginIntro();
  room.players.set('h', { id: 'h', name: 'H', connected: true, color: 0, hat: 0, skin: 0, score: 0, ready: true, power: [], purse: 0 });
  room.beginPlaying();
  room.game.time = 1;
  room.game.finished = true;
  room.beginResults();
  assert.equal(room.results.map, 'cheese');
  assert.equal(room.results.rage, true);
});

// A typo in a browser file would leave the title screen dead, and the other tests never load
// main.js (it needs a browser). So at least make sure every browser module PARSES.
test('every browser script parses as a valid ES module', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const dir = path.join(__dirname, '..', 'public', 'js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-parse-'));
  try {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const copy = path.join(tmp, f.replace(/\.js$/, '.mjs'));
      fs.copyFileSync(path.join(dir, f), copy);
      assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' }), `${f} has a syntax error`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
