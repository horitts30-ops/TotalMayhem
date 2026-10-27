// ---------------------------------------------------------------------------
// achievements.js - the trophy case. Pure rules, no drawing, no network, so it
// is easy to test (tests/achievements.test.js).
//
// How it works:
//   * The SERVER reports what happened in each round and match (your place, jumps,
//     titles, ...). This file only counts those reports and unlocks achievements.
//   * Some achievements give a special hat or skin. Those cosmetics cannot be
//     bought with coins (shop.js marks them "unlock only").
//   * Everything is saved in this browser (localStorage), like the coin wallet.
//     Each round / match is counted once, even if the page reloads and the same
//     results screen is shown again.
//   * Winning and finishing matches only counts when someone else was playing, so
//     you cannot unlock the match achievements by practising alone.
// ---------------------------------------------------------------------------

import { grant, ownedCount } from './shop.js';

export const TROPHY_KEY = 'tm_trophies';

const ALL_GAMES = ['crumbleFloor', 'goldGrab', 'hotPotato', 'hillHustle', 'propHunt', 'meteorMayhem', 'crownChaos'];

// `value(stats)` says how far along you are, `goal` is what finishes it.
// `reward` is an optional special cosmetic: { kind: 'hat' | 'skin', index }.
const won = (id) => (s) => (s.wonGames[id] ? 1 : 0);

export const ACHIEVEMENTS = [
  { id: 'first_round', icon: '\u{1F423}', name: 'First Steps', desc: 'Finish your first round.', goal: 1, value: (s) => s.rounds },
  { id: 'party', icon: '\u{1F389}', name: 'Party Animal', desc: 'Finish a match with at least one other player.', goal: 1, value: (s) => s.matches },
  { id: 'round_win', icon: '\u{1F947}', name: 'Round Winner', desc: 'Win a round against other players.', goal: 1, value: (s) => s.roundWins },
  { id: 'hat_trick', icon: '\u{1F3A9}', name: 'Hat Trick', desc: 'Win 3 rounds in the same match.', goal: 3, value: (s) => s.bestMatchWins },
  { id: 'champion', icon: '\u{1F3C6}', name: 'Champion', desc: 'Win a whole match against other players.', goal: 1, value: (s) => s.matchWins, reward: { kind: 'hat', index: 16 } },
  { id: 'threepeat', icon: '\u{1F451}', name: 'Three-Peat', desc: 'Win 3 matches.', goal: 3, value: (s) => s.matchWins, reward: { kind: 'hat', index: 17 } },
  { id: 'pogo', icon: '\u{1F998}', name: 'Pogo Pro', desc: 'Jump 100 times in total.', goal: 100, value: (s) => s.jumps, reward: { kind: 'skin', index: 8 } },
  { id: 'shover', icon: '\u{1F4AA}', name: 'Shove Machine', desc: 'Shove 50 times in total.', goal: 50, value: (s) => s.shoves },
  { id: 'bowling_pin', icon: '\u{1F3B3}', name: 'Bowling Pin', desc: 'Get shoved 30 times in total. (Here, wear a hard hat.)', goal: 30, value: (s) => s.hits, reward: { kind: 'hat', index: 18 } },
  { id: 'menace', icon: '\u{1F608}', name: 'Absolute Menace', desc: 'Knock out 3 players in one Crumble Floor round.', goal: 1, value: (s) => s.menaceRounds, reward: { kind: 'skin', index: 9 } },
  { id: 'win_floor', icon: '\u{1F9F1}', name: 'Last One Standing', desc: 'Win a Crumble Floor round.', goal: 1, value: won('crumbleFloor') },
  { id: 'win_gold', icon: '\u{1FA99}', name: 'Coin Goblin', desc: 'Win a Gold Grab round.', goal: 1, value: won('goldGrab') },
  { id: 'win_potato', icon: '\u{1F954}', name: 'Cool Potato', desc: 'Win a Hot Potato round.', goal: 1, value: won('hotPotato') },
  { id: 'win_hill', icon: '⛰️', name: 'King of the Hill', desc: 'Win a Hill Hustle round.', goal: 1, value: won('hillHustle') },
  { id: 'win_prop', icon: '\u{1F4E6}', name: 'Master of Disguise', desc: 'Win a Prop Hunt round.', goal: 1, value: won('propHunt'), reward: { kind: 'hat', index: 20 } },
  { id: 'win_meteor', icon: '☄️', name: 'Sky Dancer', desc: 'Win a Meteor Mayhem round.', goal: 1, value: won('meteorMayhem') },
  { id: 'win_crown', icon: '\u{1F48E}', name: 'Crown Jewel', desc: 'Win a Crown Chaos round.', goal: 1, value: won('crownChaos') },
  { id: 'untouchable', icon: '\u{1F6F8}', name: 'Untouchable', desc: 'Earn the "Untouchable" title in Meteor Mayhem.', goal: 1, value: (s) => s.untouchable, reward: { kind: 'hat', index: 19 } },
  { id: 'jack', icon: '\u{1F0CF}', name: 'Jack of All Trades', desc: 'Win a round of every minigame.', goal: ALL_GAMES.length, value: (s) => Object.keys(s.wonGames).length, reward: { kind: 'skin', index: 10 } },
  { id: 'clown', icon: '\u{1F921}', name: 'Class Clown', desc: 'Earn 10 funny round titles.', goal: 10, value: (s) => s.titles, reward: { kind: 'hat', index: 21 } },
  { id: 'shopper', icon: '\u{1F6D2}', name: 'Window Shopper', desc: 'Start a round with a pit-stop power-up.', goal: 1, value: (s) => s.powerRounds },
  { id: 'pit_crew', icon: '\u{1F527}', name: 'Pit Crew', desc: 'Start 10 rounds with a power-up.', goal: 10, value: (s) => s.powerRounds },
  { id: 'collector', icon: '\u{1F6CD}️', name: 'Collector', desc: 'Own 20 hats, skins and colours.', goal: 20, value: (s) => s.owned },
  { id: 'piggy', icon: '\u{1F437}', name: 'Piggy Bank', desc: 'Earn 500 coins in total.', goal: 500, value: (s) => s.coins, reward: { kind: 'skin', index: 11 } },
  { id: 'marathon', icon: '\u{1F3C3}', name: 'Marathon', desc: 'Finish 10 matches with other players.', goal: 10, value: (s) => s.matches },
  { id: 'full_house', icon: '\u{1F3E0}', name: 'Full House', desc: 'Play a match with 6 or more players.', goal: 6, value: (s) => s.biggestMatch },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const getAchievement = (id) => BY_ID.get(id) || null;

// Which achievement unlocks this hat / skin? (null if it is a normal item)
export function achievementFor(kind, index) {
  return ACHIEVEMENTS.find((a) => a.reward && a.reward.kind === kind && a.reward.index === index) || null;
}

// ------------------------------------------------------------------ saved data
const COUNTERS = [
  'rounds', 'roundWins', 'matches', 'matchWins', 'jumps', 'shoves', 'hits', 'menaceRounds',
  'untouchable', 'titles', 'powerRounds', 'coins', 'bestMatchWins', 'biggestMatch', 'owned',
];

export function emptyTrophies() {
  return normalizeTrophies({});
}

// Turns whatever was in localStorage into safe data (right shapes, sane numbers).
export function normalizeTrophies(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rs = r.stats && typeof r.stats === 'object' ? r.stats : {};
  const stats = {};
  for (const k of COUNTERS) stats[k] = Number.isFinite(rs[k]) ? Math.max(0, Math.min(1e9, Math.floor(rs[k]))) : 0;
  stats.wonGames = {};
  if (rs.wonGames && typeof rs.wonGames === 'object') {
    for (const g of ALL_GAMES) if (rs.wonGames[g] === true) stats.wonGames[g] = true;
  }
  const unlocked = {};
  if (r.unlocked && typeof r.unlocked === 'object') {
    for (const a of ACHIEVEMENTS) {
      const t = r.unlocked[a.id];
      if (Number.isFinite(t) && t > 0) unlocked[a.id] = Math.floor(t);
    }
  }
  const counted = Array.isArray(r.counted) ? r.counted.filter((x) => typeof x === 'string').slice(-80) : [];
  const cur = r.current && typeof r.current === 'object' && typeof r.current.matchId === 'string'
    ? { matchId: r.current.matchId, wins: Number.isFinite(r.current.wins) ? Math.max(0, Math.floor(r.current.wins)) : 0 }
    : { matchId: '', wins: 0 };
  return { stats, unlocked, counted, current: cur };
}

export function loadTrophies(storage) {
  try {
    return normalizeTrophies(JSON.parse(storage.getItem(TROPHY_KEY) || '{}'));
  } catch (e) {
    return emptyTrophies();
  }
}

export function saveTrophies(storage, tro) {
  try {
    storage.setItem(TROPHY_KEY, JSON.stringify(tro));
  } catch (e) {
    /* private mode etc: achievements still work this session, they just are not remembered */
  }
}

// ------------------------------------------------------------------ counting
// Each record*() returns the achievements that were NEWLY unlocked by it.
function once(tro, key) {
  if (tro.counted.includes(key)) return false;
  tro.counted.push(key);
  if (tro.counted.length > 80) tro.counted.shift();
  return true;
}

// Looks at every achievement and unlocks the ones whose goal is reached.
export function evaluate(tro, now = Date.now()) {
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (tro.unlocked[a.id]) continue;
    if (a.value(tro.stats) >= a.goal) {
      tro.unlocked[a.id] = now;
      fresh.push(a);
    }
  }
  return fresh;
}

// One finished round. `round` is what the server sent in room state `results`
// (matchId, round, game, players) and `row` is MY row of that results table.
export function recordRound(tro, round, row, now = Date.now()) {
  if (!round || !row || row.abandoned) return [];
  if (!once(tro, `${round.matchId}:r${round.round}`)) return [];
  const s = tro.stats;
  const company = (round.players || 0) >= 2;
  s.rounds += 1;
  s.jumps += clampCount(row.jumps);
  s.shoves += clampCount(row.shoves);
  s.hits += clampCount(row.hitsTaken);
  if (company && row.title) s.titles += 1;
  if (row.title === 'Untouchable' && company) s.untouchable += 1;
  if (round.game === 'crumbleFloor' && company && clampCount(row.kos) >= 3) s.menaceRounds += 1;
  if (company && row.place === 1) {
    s.roundWins += 1;
    if (ALL_GAMES.includes(round.game)) s.wonGames[round.game] = true;
    if (tro.current.matchId !== round.matchId) tro.current = { matchId: round.matchId, wins: 0 };
    tro.current.wins += 1;
    s.bestMatchWins = Math.max(s.bestMatchWins, tro.current.wins);
  }
  return evaluate(tro, now);
}

// The match is over. `final` = room state `final`, `place` = my place.
export function recordFinal(tro, final, place, now = Date.now()) {
  if (!final || !Number.isInteger(place)) return [];
  if (!once(tro, `${final.matchId}:final`)) return [];
  const players = final.players || (final.standings ? final.standings.length : 1);
  if (players >= 2) {
    tro.stats.matches += 1;
    tro.stats.biggestMatch = Math.max(tro.stats.biggestMatch, players);
    if (place === 1) tro.stats.matchWins += 1;
  }
  return evaluate(tro, now);
}

// A round started and I was carrying `count` power-ups.
export function recordPowerRound(tro, matchId, round, count, now = Date.now()) {
  if (!(count > 0)) return [];
  if (!once(tro, `${matchId}:r${round}:pw`)) return [];
  tro.stats.powerRounds += 1;
  return evaluate(tro, now);
}

// Coins that were really paid out (shop.credit already makes sure of "once").
export function recordCoins(tro, amount, now = Date.now()) {
  if (!(amount > 0)) return [];
  tro.stats.coins = Math.min(1e9, tro.stats.coins + Math.floor(amount));
  return evaluate(tro, now);
}

// Call after anything that changes what you own.
export function recordOwned(tro, wallet, now = Date.now()) {
  tro.stats.owned = ownedCount(wallet).have;
  return evaluate(tro, now);
}

// Gives the special hats and skins of every unlocked achievement.
// Safe to call as often as you like. Returns the rewards that were new.
export function applyRewards(tro, wallet) {
  const added = [];
  for (const a of ACHIEVEMENTS) {
    if (a.reward && tro.unlocked[a.id] && grant(wallet, a.reward.kind, a.reward.index)) added.push(a);
  }
  return added;
}

export function progressOf(tro, a) {
  return { value: Math.min(a.goal, a.value(tro.stats)), goal: a.goal, done: !!tro.unlocked[a.id] };
}

export function unlockedCount(tro) {
  return ACHIEVEMENTS.filter((a) => tro.unlocked[a.id]).length;
}

function clampCount(n) {
  return Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.floor(n))) : 0;
}
