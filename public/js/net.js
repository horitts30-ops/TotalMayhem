// The connection to the game.
//
// Two ways to run the game, picked automatically when the page opens:
//   * A Node server is behind this page (npm start, Render, ...): classic Socket.IO, as always.
//   * Plain file hosting (GitHub Pages, any static site, or a file opened from disk): there is no server, so the
//     browser of whoever creates a room IS the server and friends connect to it directly (WebRTC). See p2pnet.js.
// Either way, `socket` has the same small interface (on / emit / timeout().emit / connected), so the rest of the
// game cannot tell the difference.
//
// To try one mode on purpose: add ?p2p or ?server to the address.

/* global io */
import { createP2PSocket } from './p2pnet.js';

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

async function serverIsHere() {
  if (params.has('p2p')) return false;
  if (params.has('server')) return true;
  try {
    const r = await fetch('health', { cache: 'no-store' }); // only the Node server answers this
    return r.ok && (await r.text()).trim() === 'ok';
  } catch (e) {
    return false;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

// Test hook: ?peerhost=localhost&peerport=9000 points the matchmaker at a private PeerJS server.
function peerOptions() {
  const o = { debug: 0 };
  if (params.get('peerhost')) {
    o.host = params.get('peerhost');
    o.port = Number(params.get('peerport')) || 9000;
    o.path = params.get('peerpath') || '/';
    o.secure = params.get('peersecure') === '1';
  }
  return o;
}

let hostLib = null;
let peerLib = null;
const here = (p) => new URL(p, import.meta.url).href;

export const isP2P = !(await serverIsHere());

let sock;
if (isP2P) {
  document.documentElement.classList.add('p2p'); // CSS hides the parts that need a real server (public list, admin)
  sock = createP2PSocket({
    peerOptions: peerOptions(),
    hasSession: () => !!loadSession(),
    loadHost: () => (hostLib = hostLib || import(here('./host.bundle.js'))),
    loadPeer: async () => {
      if (!peerLib) {
        if (!window.Peer) await loadScript(here('../vendor/peerjs.min.js'));
        peerLib = window.Peer;
      }
      return peerLib;
    },
  });
} else {
  await loadScript('socket.io/socket.io.js'); // provided by the Node server
  // WebSocket first (lowest delay). Plain HTTP polling stays as a fallback for
  // networks that block websockets.
  // tryAllTransports: if the WebSocket cannot connect at all (some networks, VPNs and antivirus programs block it),
  // really DO fall back to polling. Without this option the client gives up after the first transport fails.
  sock = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
}
export const socket = sock;

// "websocket" (good), "polling" (works, but slower) or "none" (not connected) - for the F3 panel and warnings.
export function transportName() {
  if (isP2P) return socket.transportName();
  try {
    const e = socket.io && socket.io.engine;
    return (e && e.transport && e.transport.name) || 'none';
  } catch (err) {
    return 'none';
  }
}

// The list of floor shapes for the lobby's map picker.
export async function fetchMaps() {
  if (isP2P) return socket.maps();
  const res = await fetch('api/maps');
  return res.json();
}

// Send a message and wait for the server's answer (or a friendly timeout).
// `onAnswer` (optional) runs immediately when the answer arrives, before any
// other message is processed - handy for remembering "who am I" in time.
export function request(event, data, onAnswer) {
  return new Promise((resolve) => {
    socket.timeout(6000).emit(event, data, (err, res) => {
      const answer = err
        ? { ok: false, error: 'The server did not answer. Is it still running?' }
        : res || { ok: false, error: 'Empty answer from the server.' };
      if (onAnswer) onAnswer(answer);
      resolve(answer);
    });
  });
}

// We keep the "seat" (room code + secret token) in sessionStorage, so refreshing
// the page puts you back in your room. It is per-tab on purpose: two tabs on one
// computer are two different players, which is exactly what you want for testing.
const KEY = 'tm_session';

export function saveSession(code, token) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ code, token }));
  } catch (e) {
    /* ignore */
  }
}

export function loadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return s && s.code && s.token ? s : null;
  } catch (e) {
    return null;
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch (e) {
    /* ignore */
  }
}
