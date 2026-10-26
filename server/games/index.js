'use strict';

// ---------------------------------------------------------------------------
// The minigame registry.
//
// Every minigame is a class with the same small interface (see the comment at
// the top of crumbleFloor.js or arenaBase.js). To add a minigame:
//   1. create server/games/yourGame.js (the open-arena games extend ArenaGame;
//      it has a static VARIANTS table, describe() and arena)
//   2. register it in GAMES below
// That is all: its variants join the match schedule automatically, and the
// rooms, lobby, scoring and results screens do not need to change. (The browser
// needs a small matching drawing function; see "Adding a minigame" in the README.)
// ---------------------------------------------------------------------------

const CrumbleFloor = require('./crumbleFloor');
const GoldGrab = require('./goldGrab');
const HotPotato = require('./hotPotato');
const HillHustle = require('./hillHustle');

const GAMES = {
  crumbleFloor: CrumbleFloor,
  goldGrab: GoldGrab,
  hotPotato: HotPotato,
  hillHustle: HillHustle,
};

// A "slot" says which game to run and which variant (twist) of it, for example
// { game: 'goldGrab', variant: 'jackpot' }. SCHEDULE_POOL lists every slot that
// exists; it is built from each game's VARIANTS table, so a new game or a new
// variant shows up here automatically.
const SCHEDULE_POOL = [];
for (const [game, Game] of Object.entries(GAMES)) {
  for (const variant of Object.keys(Game.VARIANTS)) SCHEDULE_POOL.push({ game, variant });
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Builds the list of rounds for one match:
//   * every minigame is used once before any is used again,
//   * the same minigame is never played twice in a row,
//   * round 1 uses the minigame's normal version (the others get a random twist).
function buildSchedule(rounds, rng = Math.random) {
  const ids = Object.keys(GAMES);
  const out = [];
  const used = new Set();
  let bag = [];
  let prev = null;
  for (let i = 0; i < rounds; i++) {
    if (bag.length === 0) {
      bag = shuffle(ids, rng);
      // `pop()` takes from the end, so make sure that is not what we just played
      if (bag.length > 1 && bag[bag.length - 1] === prev) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    const game = bag.pop();
    prev = game;
    const variants = Object.keys(GAMES[game].VARIANTS);
    let variant = variants[0];
    if (i > 0) {
      const fresh = variants.filter((v) => !used.has(`${game}:${v}`));
      const pool = fresh.length ? fresh : variants;
      variant = pool[Math.floor(rng() * pool.length)];
    }
    used.add(`${game}:${variant}`);
    out.push({ game, variant });
  }
  return out;
}

function describeSlot(slot) {
  return GAMES[slot.game].describe(slot.variant);
}

function createGame(slot, participants, options) {
  const Game = GAMES[slot.game];
  return new Game(participants, slot.variant, options);
}

function arenaFor(slot) {
  return GAMES[slot.game].arena;
}

module.exports = { GAMES, SCHEDULE_POOL, buildSchedule, describeSlot, createGame, arenaFor };
