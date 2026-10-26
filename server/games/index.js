'use strict';

// ---------------------------------------------------------------------------
// The minigame registry.
//
// Every minigame is a class with the same small interface (see the comment at
// the top of crumbleFloor.js). To add a minigame in Milestone 3 you will:
//   1. create server/games/yourGame.js
//   2. register it in GAMES below
//   3. add it to the SCHEDULE_POOL
// The rooms, lobby, scoring and results screens do not need to change.
// ---------------------------------------------------------------------------

const CrumbleFloor = require('./crumbleFloor');

const GAMES = {
  crumbleFloor: CrumbleFloor,
};

// A "slot" says which game to run and which variant (twist) of it.
// With only one minigame so far, a match is the same game with three twists.
const SCHEDULE_POOL = [
  { game: 'crumbleFloor', variant: 'classic' },
  { game: 'crumbleFloor', variant: 'speedy' },
  { game: 'crumbleFloor', variant: 'slippery' },
];

function buildSchedule(rounds) {
  const out = [];
  for (let i = 0; i < rounds; i++) out.push(SCHEDULE_POOL[i % SCHEDULE_POOL.length]);
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
