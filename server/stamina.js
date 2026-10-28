'use strict';

// ---------------------------------------------------------------------------
// STAMINA - one pool of energy that JUMPING and SHOVING share.
//
// Every jump and every shove spends some. It refills by itself a moment after
// you stop spending. This is what stops anybody from shoving (or hopping)
// non-stop, so it is part of the game's "fair sabotage" rules.
//
// Two pit-stop power-ups change it (see powerups.js):
//   "Big Lungs"   -> a bigger pool       (mods.stamina)
//   "Second Wind" -> a faster refill     (mods.regen)
//
// This file has no sockets or drawing, so both Crumble Floor and the arena
// games use it and the tests can check it directly.
// ---------------------------------------------------------------------------

const STAMINA = {
  max: 100,
  jumpCost: 25, // four jumps from a full bar
  shoveCost: 35, // two shoves, and a bit left over
  regen: 20, // per second
  regenDelay: 0.45, // refilling starts this long after you spend
  tiredEventGap: 0.4, // at most one "too tired!" message this often
};

// Call once when a player is created (mods are already normalised).
function initStamina(p) {
  p.staminaMax = STAMINA.max * p.mods.stamina;
  p.stamina = p.staminaMax;
  p.staminaWait = 0;
  p.tiredCd = 0;
}

// Call every tick.
function tickStamina(p, dt) {
  p.tiredCd = Math.max(0, p.tiredCd - dt);
  if (p.staminaWait > 0) {
    p.staminaWait = Math.max(0, p.staminaWait - dt);
    return;
  }
  if (p.stamina < p.staminaMax) {
    p.stamina = Math.min(p.staminaMax, p.stamina + STAMINA.regen * p.mods.regen * dt);
  }
}

// Pays `cost` if the player can afford it. Returns true if paid.
function spendStamina(p, cost) {
  if (!(cost > 0)) return true;
  if (p.stamina + 1e-6 < cost) return false;
  p.stamina = Math.max(0, p.stamina - cost);
  p.staminaWait = STAMINA.regenDelay;
  return true;
}

module.exports = { STAMINA, initStamina, tickStamina, spendStamina };
