'use strict';

// Makes the game snapshots smaller before they go over the network (and the browser undoes it).
//
// A snapshot has a list of players, and every player repeats the same ~20 field names
// ({"id":..,"x":..,"vx":..}). Sending the names ONCE and then just rows of values cuts the
// size of a snapshot roughly in half, which means less to download (less lag on slow
// connections, and less work for the server when 8 players are connected).
//
//   before:  { t, ps: [ {id, x, y, ...}, {id, x, y, ...} ] }
//   after:   { t, pk: ['id','x','y',...], pv: [ ['a',1,2,...], ['b',3,4,...] ] }
//
// A field a player does not have is sent as null and left out again when decoding.
// public/js/snapcodec.js is the browser copy of decodeSnap (tests/packs.test.js-style
// "same answer" check lives in tests/optimize.test.js).

function encodeSnap(snap) {
  const ps = snap && snap.ps;
  if (!Array.isArray(ps) || ps.length === 0) return snap;
  const keys = [];
  const seen = new Set();
  for (const p of ps) {
    for (const k of Object.keys(p)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const pv = ps.map((p) => keys.map((k) => (k in p ? p[k] : null)));
  const out = {};
  for (const k of Object.keys(snap)) if (k !== 'ps') out[k] = snap[k];
  out.pk = keys;
  out.pv = pv;
  return out;
}

function decodeSnap(snap) {
  if (!snap || !Array.isArray(snap.pk) || !Array.isArray(snap.pv)) return snap;
  const keys = snap.pk;
  const ps = snap.pv.map((row) => {
    const p = {};
    for (let i = 0; i < keys.length; i++) if (row[i] !== null && row[i] !== undefined) p[keys[i]] = row[i];
    return p;
  });
  const out = {};
  for (const k of Object.keys(snap)) if (k !== 'pk' && k !== 'pv') out[k] = snap[k];
  out.ps = ps;
  return out;
}

module.exports = { encodeSnap, decodeSnap };
