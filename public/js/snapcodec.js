// Browser copy of decodeSnap from server/snapcodec.js (see the comment there).
// The server sends players as one list of field names (pk) plus rows of values (pv);
// this turns them back into the usual list of player objects (ps).
export function decodeSnap(snap) {
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
