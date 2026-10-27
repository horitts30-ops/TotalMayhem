// Thin wrapper around Socket.IO. `io` comes from the script tag
// <script src="/socket.io/socket.io.js"> which the server provides.

/* global io */
// WebSocket first (lowest delay). Plain HTTP polling stays as a fallback for
// networks that block websockets.
export const socket = io({ transports: ['websocket', 'polling'] });

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
