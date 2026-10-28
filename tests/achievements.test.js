'use strict';

// Tests for the trophy case (public/js/achievements.js, an ES module).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const cfg = require('../server/config');

const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', f)).href);

const row = (o = {}) => ({ id: 'me', place: 2, abandoned: false, jumps: 0, shoves: 0, hitsTaken: 0, kos: 0, title: '', ...o });
const round = (o = {}) => ({ matchId: 'm1', round: 1, game: 'goldGrab', players: 3, ...o });
const ids = (list) => list.map((a) => a.id);

test('achievements: ids are unique and every special reward is a real, unlock-only item used once', async () => {
  const A = await load('achievements.js');
  const shop = await load('shop.js');
  assert.ok(A.ACHIEVEMENTS.length >= 20);
  assert.equal(new Set(A.ACHIEVEMENTS.map((a) => a.id)).size, A.ACHIEVEMENTS.length);
  const seen = new Set();
  for (const a of A.ACHIEVEMENTS) {
    assert.ok(a.name && a.desc && a.icon && a.goal >= 1 && typeof a.value === 'function', a.id);
    if (!a.reward) continue;
    const key = `${a.reward.kind}${a.reward.index}`;
    assert.ok(!seen.has(key), `${key} is given by only one achievement`);
    seen.add(key);
    assert.ok(a.reward.index < shop.countOf(a.reward.kind), `${a.id} reward exists`);
    assert.equal(shop.isUnlockOnly(a.reward.kind, a.reward.index), true, `${a.id} reward cannot be bought`);
  }
  // ...and every unlock-only item has an achievement that gives it.
  for (const k of ['hat', 'skin']) {
    for (const it of shop.catalogue(k)) {
      if (it.price === shop.UNLOCK_ONLY) assert.ok(A.achievementFor(k, it.index), `${it.name} can be earned`);
    }
  }
  assert.equal(shop.countOf('hat'), cfg.HAT_COUNT);
  assert.equal(shop.countOf('skin'), cfg.SKIN_COUNT);
});

test('achievements: finishing a round unlocks First Steps, and replaying the same results counts once', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  const first = A.recordRound(t, round(), row({ jumps: 4, shoves: 2 }));
  assert.deepEqual(ids(first), ['first_round']);
  assert.deepEqual(A.recordRound(t, round(), row({ jumps: 4, shoves: 2 })), [], 'a reload that replays the same round adds nothing');
  assert.equal(t.stats.rounds, 1);
  assert.equal(t.stats.jumps, 4);
  A.recordRound(t, round({ round: 2 }), row({ jumps: 1 }));
  assert.equal(t.stats.rounds, 2);
  assert.equal(t.stats.jumps, 5);
});

test('achievements: leaving mid-round counts for nothing', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  assert.deepEqual(A.recordRound(t, round(), row({ abandoned: true, place: 1 })), []);
  assert.deepEqual(A.recordRound(t, round(), null), []);
  assert.deepEqual(A.recordRound(t, null, row()), []);
  assert.equal(t.stats.rounds, 0);
});

test('achievements: wins only count with company, so practising alone cannot farm them', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  A.recordRound(t, round({ players: 1 }), row({ place: 1, title: 'Coin Goblin' }));
  assert.equal(t.stats.roundWins, 0);
  assert.equal(t.stats.titles, 0);
  assert.deepEqual(t.stats.wonGames, {});
  assert.deepEqual(A.recordFinal(t, { matchId: 'm1', players: 1, standings: [{}] }, 1), []);
  assert.equal(t.stats.matches, 0);
  assert.equal(t.stats.matchWins, 0);
  const real = A.recordRound(t, round({ round: 2, players: 2 }), row({ place: 1 }));
  assert.ok(ids(real).includes('round_win'));
});

test('achievements: Hat Trick needs three round wins inside ONE match', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  A.recordRound(t, round({ matchId: 'a', round: 1 }), row({ place: 1 }));
  A.recordRound(t, round({ matchId: 'a', round: 2 }), row({ place: 1 }));
  assert.equal(A.recordRound(t, round({ matchId: 'b', round: 1 }), row({ place: 1 })).some((a) => a.id === 'hat_trick'), false, 'a win in another match does not complete it');
  A.recordRound(t, round({ matchId: 'b', round: 2 }), row({ place: 1 }));
  const done = A.recordRound(t, round({ matchId: 'b', round: 3 }), row({ place: 1 }));
  assert.ok(ids(done).includes('hat_trick'));
});

test('achievements: winning a match unlocks Champion and hands out the Laurel wreath', async () => {
  const A = await load('achievements.js');
  const shop = await load('shop.js');
  const t = A.emptyTrophies();
  const w = shop.emptyWallet();
  assert.equal(shop.owns(w, 'hat', 16), false);
  const fresh = A.recordFinal(t, { matchId: 'm1', players: 3, standings: [{}, {}, {}] }, 1);
  assert.ok(ids(fresh).includes('champion'));
  assert.ok(ids(fresh).includes('party'));
  const rewards = A.applyRewards(t, w);
  assert.deepEqual(ids(rewards), ['champion']);
  assert.ok(shop.owns(w, 'hat', 16));
  assert.deepEqual(A.applyRewards(t, w), [], 'safe to repeat');
  assert.deepEqual(A.recordFinal(t, { matchId: 'm1', players: 3, standings: [{}, {}, {}] }, 1), [], 'the same final is not counted twice');
  assert.equal(t.stats.matchWins, 1);
});

test('achievements: losing a match still counts as played, not won', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  A.recordFinal(t, { matchId: 'm9', players: 6, standings: [] }, 4);
  assert.equal(t.stats.matches, 1);
  assert.equal(t.stats.matchWins, 0);
  assert.equal(t.stats.biggestMatch, 6);
  assert.ok(t.unlocked.full_house, '6 players unlocks Full House');
  assert.ok(!t.unlocked.champion);
});

test('achievements: each minigame has its own win, and winning every one gives the Galaxy skin', async () => {
  const A = await load('achievements.js');
  const shop = await load('shop.js');
  const t = A.emptyTrophies();
  const games = [
    'crumbleFloor', 'goldGrab', 'hotPotato', 'hillHustle', 'propHunt', 'meteorMayhem', 'crownChaos',
    'paintPanic', 'colorCall', 'jumpRope', 'lapDash', 'digDash', 'moleStomp',
  ];
  let unlocked = [];
  games.forEach((g, i) => {
    unlocked = unlocked.concat(ids(A.recordRound(t, round({ matchId: 'g' + i, game: g }), row({ place: 1 }))));
  });
  for (const id of ['win_floor', 'win_gold', 'win_potato', 'win_hill', 'win_prop', 'win_meteor', 'win_crown', 'win_paint', 'win_color', 'win_rope', 'win_lap', 'win_dig', 'win_mole', 'jack']) {
    assert.ok(unlocked.includes(id), id);
  }
  const w = shop.emptyWallet();
  A.applyRewards(t, w);
  assert.ok(shop.owns(w, 'skin', 10), 'Galaxy skin');
  assert.ok(shop.owns(w, 'hat', 20), 'Detective cap for Prop Hunt');
});

test('achievements: shared ties for first place count as a win, a made-up game name does not', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  A.recordRound(t, round({ game: 'banana' }), row({ place: 1 }));
  assert.equal(t.stats.roundWins, 1);
  assert.deepEqual(t.stats.wonGames, {}, 'unknown games are not remembered');
});

test('achievements: totals add up across rounds (jumps, shoves, hits, titles) and unlock rewards at the goal', async () => {
  const A = await load('achievements.js');
  const shop = await load('shop.js');
  const t = A.emptyTrophies();
  const w = shop.emptyWallet();
  for (let i = 1; i <= 10; i++) {
    A.recordRound(t, round({ matchId: 'x', round: i }), row({ jumps: 10, shoves: 5, hitsTaken: 3, title: 'Menace' }));
  }
  for (const id of ['pogo', 'shover', 'bowling_pin', 'clown']) assert.ok(t.unlocked[id], id);
  A.applyRewards(t, w);
  assert.ok(shop.owns(w, 'skin', 8), 'Bubbles for 100 jumps');
  assert.ok(shop.owns(w, 'hat', 18), 'Hard hat for 30 hits');
  assert.ok(shop.owns(w, 'hat', 21), 'Jester hat for 10 titles');
});

test('achievements: 3 knock-outs in one Crumble Floor round is Absolute Menace (Flames skin)', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  assert.deepEqual(ids(A.recordRound(t, round({ game: 'crumbleFloor', round: 1 }), row({ kos: 2 }))), ['first_round']);
  assert.ok(ids(A.recordRound(t, round({ game: 'crumbleFloor', round: 2 }), row({ kos: 3 }))).includes('menace'));
  const t2 = A.emptyTrophies();
  A.recordRound(t2, round({ game: 'goldGrab' }), row({ kos: 9 }));
  assert.ok(!t2.unlocked.menace, 'only Crumble Floor knock-outs count');
});

test('achievements: the Untouchable title unlocks the Space helmet', async () => {
  const A = await load('achievements.js');
  const shop = await load('shop.js');
  const t = A.emptyTrophies();
  A.recordRound(t, round({ game: 'meteorMayhem' }), row({ place: 1, title: 'Untouchable' }));
  const w = shop.emptyWallet();
  A.applyRewards(t, w);
  assert.ok(shop.owns(w, 'hat', 19));
});

test('achievements: power-ups count once per round and need at least one', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  assert.deepEqual(A.recordPowerRound(t, 'm', 2, 0), []);
  assert.deepEqual(ids(A.recordPowerRound(t, 'm', 2, 1)), ['shopper']);
  assert.deepEqual(A.recordPowerRound(t, 'm', 2, 2), [], 'the same round is not counted twice');
  assert.equal(t.stats.powerRounds, 1);
  for (let r = 3; r <= 11; r++) A.recordPowerRound(t, 'm', r, 1);
  assert.ok(t.unlocked.pit_crew);
});

test('achievements: 500 coins earned gives the Gold skin; Collector follows what you own', async () => {
  const A = await load('achievements.js');
  const shop = await load('shop.js');
  const t = A.emptyTrophies();
  const w = shop.emptyWallet();
  assert.deepEqual(A.recordCoins(t, 0), []);
  assert.deepEqual(A.recordCoins(t, -50), []);
  A.recordCoins(t, 300);
  assert.ok(!t.unlocked.piggy);
  A.recordCoins(t, 200);
  assert.ok(t.unlocked.piggy);
  A.applyRewards(t, w);
  assert.ok(shop.owns(w, 'skin', 11));

  const have = shop.ownedCount(w).have;
  assert.ok(have < 20);
  for (let i = 0; i < 40 && shop.ownedCount(w).have < 20; i++) {
    shop.grant(w, 'hat', i % shop.countOf('hat'));
    shop.grant(w, 'skin', i % shop.countOf('skin'));
    shop.grant(w, 'color', i % shop.countOf('color'));
  }
  assert.ok(ids(A.recordOwned(t, w)).includes('collector'));
});

test('achievements: saved data is cleaned up, so junk in localStorage cannot break the game', async () => {
  const A = await load('achievements.js');
  const junk = {
    stats: { rounds: -5, jumps: 'many', shoves: 1e20, wonGames: { goldGrab: true, banana: true, hotPotato: 'yes' } },
    unlocked: { champion: 123456, nope: 5, party: 'x' },
    counted: ['a', 1, null, 'b'],
    current: { matchId: 7, wins: 'lots' },
  };
  const t = A.normalizeTrophies(junk);
  assert.equal(t.stats.rounds, 0);
  assert.equal(t.stats.jumps, 0);
  assert.equal(t.stats.shoves, 1e9);
  assert.deepEqual(t.stats.wonGames, { goldGrab: true });
  assert.deepEqual(Object.keys(t.unlocked), ['champion']);
  assert.deepEqual(t.counted, ['a', 'b']);
  assert.deepEqual(t.current, { matchId: '', wins: 0 });
  for (const bad of [null, undefined, 'x', 42, []]) assert.equal(A.normalizeTrophies(bad).stats.rounds, 0);
});

test('achievements: save and load round-trips, and a broken or missing storage is fine', async () => {
  const A = await load('achievements.js');
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
  const t = A.emptyTrophies();
  A.recordRound(t, round(), row({ jumps: 7 }));
  A.saveTrophies(storage, t);
  const back = A.loadTrophies(storage);
  assert.equal(back.stats.jumps, 7);
  assert.ok(back.unlocked.first_round);
  assert.equal(A.loadTrophies({ getItem: () => '{not json' }).stats.rounds, 0);
  assert.equal(A.loadTrophies({ getItem: () => { throw new Error('blocked'); } }).stats.rounds, 0);
  assert.doesNotThrow(() => A.saveTrophies({ setItem: () => { throw new Error('full'); } }, t));
});

test('achievements: progress is capped at the goal and reports done', async () => {
  const A = await load('achievements.js');
  const t = A.emptyTrophies();
  const pogo = A.getAchievement('pogo');
  A.recordRound(t, round(), row({ jumps: 40 }));
  assert.deepEqual(A.progressOf(t, pogo), { value: 40, goal: 100, done: false });
  for (let i = 2; i <= 6; i++) A.recordRound(t, round({ round: i }), row({ jumps: 40 }));
  assert.deepEqual(A.progressOf(t, pogo), { value: 100, goal: 100, done: true });
  assert.equal(A.unlockedCount(t) >= 2, true);
});

test('achievements: the server sends what the trophy case needs', async () => {
  // The browser counts from room state; make sure the server fields exist.
  const { Room } = require('../server/room');
  const cfgBase = require('../server/config');
  const io = { to: () => ({ emit() {} }) };
  const room = new Room(io, 'TEST', { ...cfgBase, PITSTOP_MS: 0 }, {});
  const a = room.addPlayer({ name: 'A' }).id;
  const b = room.addPlayer({ name: 'B' }).id;
  room.startMatch(a);
  room.beginPlaying();
  room.game._finish();
  room.beginResults();
  const st = room.publicState();
  assert.match(st.matchId, /^[0-9a-z]+-\d+$/);
  assert.equal(st.results.matchId, st.matchId);
  assert.equal(st.results.players, 2);
  assert.ok(typeof st.results.game === 'string' && st.results.game.length > 0);
  assert.ok(st.results.rows.every((r) => 'jumps' in r && 'place' in r && 'title' in r));
  assert.ok(b);
});
