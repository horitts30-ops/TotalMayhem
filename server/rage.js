'use strict';

// ---------------------------------------------------------------------------
// RAGE BAIT mode: a room setting the host can switch on in the lobby.
//
// It is deliberately almost unfair: shoves launch people across the whole arena,
// the floor is slippery, and every minigame is tuned to be much harder. It is
// still FAIR in the ways that matter: the rules are identical for every player in
// the room, nobody is ever eliminated for good, and it earns the same coins and
// power-ups as a normal match (no pay-to-win, no extra rewards for suffering).
//
// Two parts:
//   1. rageVariant()  - physics for every game (stronger shoves, slidier floor...)
//   2. each game's own RAGE table (see the bottom of the game files) - its rules made harder
// ---------------------------------------------------------------------------

const RAGE = {
  shove: 3.0, // knockback speed multiplier (about 3x the normal push)
  slide: 0.85, // knockback friction: shoved players slide further
  grip: 0.6, // ground steering: everything is a bit slippery
  stun: 2.2, // dizzy time after a shove
  immune: 0.5, // a shoved player can be shoved again sooner (combos!)
};

// Takes a variant table entry and returns a harder copy of it (the original is untouched).
function rageVariant(v) {
  const out = {
    ...v,
    shoveSpeed: (v.shoveSpeed || 1) * RAGE.shove,
    slide: (v.slide || 1) * RAGE.slide,
    grip: (v.grip || 1) * RAGE.grip,
    stun: RAGE.stun,
    immune: RAGE.immune,
  };
  // Crumble Floor's own knobs: tiles crack and fall faster, waves come sooner.
  if (v.crack !== undefined) out.crack = v.crack * 0.6;
  if (v.interval !== undefined) out.interval = v.interval * 0.7;
  return out;
}

module.exports = { RAGE, rageVariant };
