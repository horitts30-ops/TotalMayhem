'use strict';

// ---------------------------------------------------------------------------
// Coin rewards ("Mayhem Coins") for the shop.
//
// The SERVER decides how many coins a player earned, so a browser cannot just
// claim a million. (The coins themselves are saved in each player's own browser
// - see public/js/shop.js - and can only buy cosmetics, never an advantage.)
//
// Design rules:
//   * Everybody who plays a round earns something (struggling players are
//     never left with nothing).
//   * Winning earns more, but only a little more.
//   * Playing alone ("practice") earns a small flat amount so nobody can farm
//     the shop by beating themselves.
//   * Leaving mid-round earns nothing for that round.
// ---------------------------------------------------------------------------

const REWARD = {
  participation: 10, // for playing a round with other people
  firstPlaceBonus: 5,
  titleBonus: 3, // got one of the funny titles
  soloFlat: 3, // practice round with nobody else
  finalFinish: 5, // played a whole match with others
  finalWin: 10, // won the match (instead of the finish bonus)
};

// One results row -> { coins, parts: ['10 played', ...] }
function roundReward(row, participantCount) {
  if (!row || row.abandoned) return { coins: 0, parts: [] };
  if (participantCount < 2) return { coins: REWARD.soloFlat, parts: [`${REWARD.soloFlat} practice`] };
  const points = Math.max(0, Math.round(Number(row.points) || 0));
  const parts = [`${REWARD.participation} played`];
  let coins = REWARD.participation;
  if (points > 0) {
    coins += points;
    parts.push(`${points} points`);
  }
  if (row.place === 1) {
    coins += REWARD.firstPlaceBonus;
    parts.push(`${REWARD.firstPlaceBonus} win`);
  }
  if (row.title) {
    coins += REWARD.titleBonus;
    parts.push(`${REWARD.titleBonus} title`);
  }
  return { coins, parts };
}

// Final standings entry -> bonus coins for finishing the match.
function finalReward(entry, playedWithOthers) {
  if (!entry || !entry.connected || !playedWithOthers) return 0;
  return entry.place === 1 ? REWARD.finalWin : REWARD.finalFinish;
}

module.exports = { REWARD, roundReward, finalReward };
