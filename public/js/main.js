// ---------------------------------------------------------------------------
// main.js - the "conductor" of the browser side.
//
//  * talks to the server (net.js)
//  * switches between the title / lobby / game screens
//  * smooths the snapshots the server sends and hands them to the renderer
//  * turns server "events" (jump, shove, fall...) into sounds and effects
//
// Important idea: this file NEVER decides game results. The server is the
// referee; the browser only sends controls and draws what it is told.
// ---------------------------------------------------------------------------

import { socket, request, saveSession, loadSession, clearSession } from './net.js';
import { Renderer, drawPreview } from './renderer.js';
import { Input } from './input.js';
import { sfx, unlockAudio, isMuted, setMuted } from './audio.js';
import { STAGE_W, STAGE_H, OX, OY, COLORS, HATS, SKINS } from './constants.js';

const $ = (id) => document.getElementById(id);
const INTERP_MS = 100; // other players are drawn this far in the past, for smoothness

// =============================================================== state
const S = {
  me: null, // my player id
  room: null, // latest room state from the server
  view: 'title',
  phaseEndsAt: 0,
  snaps: [], // recent world snapshots: { r: receivedAtMs, s: snapshot }
  meta: new Map(), // player id -> { name, color, hat, skin }
  look: loadLook(),
  theme: 'sunny',
  avatars: [], // little canvases that animate (menus, results)
  lastFrame: performance.now(),
  cdShown: null, // which countdown number is on screen
  goUntil: 0,
  hudSig: '',
  rejoining: false,
  booted: false,
};

function loadLook() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('tm_look') || '{}') || {};
  } catch (e) {
    saved = {};
  }
  return {
    name: typeof saved.name === 'string' ? saved.name : '',
    color: Number.isInteger(saved.color) ? saved.color % COLORS.length : Math.floor(Math.random() * COLORS.length),
    hat: Number.isInteger(saved.hat) && saved.hat >= 0 ? saved.hat % HATS.length : 0,
    skin: Number.isInteger(saved.skin) && saved.skin >= 0 ? saved.skin % SKINS.length : 0,
  };
}
function saveLook() {
  try {
    localStorage.setItem('tm_look', JSON.stringify(S.look));
  } catch (e) {
    /* ignore */
  }
}

const renderer = new Renderer($('game-canvas'));

const input = new Input((controls) => {
  // (Normal emit, not "volatile": a lost "jump pressed" message would feel awful,
  // and these messages are tiny.)
  if (S.room && S.room.phase === 'playing') socket.emit('game:input', controls);
});
setInterval(() => input.heartbeat(), 250);

// =============================================================== tiny helpers
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function addAvatar(canvas, getLook, mood = 'normal') {
  S.avatars.push({ canvas, getLook, mood, off: Math.random() * 3 });
}

function animateAvatars(tSec) {
  S.avatars = S.avatars.filter((a) => a.canvas.isConnected);
  for (const a of S.avatars) drawPreview(a.canvas, a.getLook(), tSec + a.off, a.mood);
}

function showView(v) {
  S.view = v;
  $('screen-title').classList.toggle('hidden', v !== 'title');
  $('screen-lobby').classList.toggle('hidden', v !== 'lobby');
  $('stage-wrap').classList.toggle('hidden', v !== 'stage');
  if (v === 'stage') fitStage();
}

function fitStage() {
  const k = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const stage = $('stage');
  stage.style.transform = `scale(${k})`;
  stage.style.left = `${(window.innerWidth - STAGE_W * k) / 2}px`;
  stage.style.top = `${(window.innerHeight - STAGE_H * k) / 2}px`;
  renderer.resize(k);
}
window.addEventListener('resize', fitStage);

function iAmHost() {
  return !!(S.room && S.room.hostId === S.me);
}
function myRoomPlayer() {
  return S.room ? S.room.players.find((p) => p.id === S.me) : null;
}

// =============================================================== title screen
function buildLogo() {
  const logo = $('logo');
  const colors = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#ff6fb5', '#9b5de5'];
  let i = 0;
  for (const word of ['TOTAL', 'MAYHEM']) {
    const w = el('span', 'word');
    for (const ch of word) {
      const s = el('span', 'ch', ch);
      s.style.setProperty('--c', colors[i % colors.length]);
      s.style.setProperty('--i', String(i));
      w.appendChild(s);
      i++;
    }
    logo.appendChild(w);
  }
}

const pickers = [];
function mountPicker(prefix) {
  const swatchesEl = $(`${prefix}-swatches`);
  COLORS.forEach((c, i) => {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.style.background = c.hex;
    b.title = c.name;
    b.addEventListener('click', () => {
      S.look.color = i;
      lookChanged();
    });
    swatchesEl.appendChild(b);
  });
  const step = (key, list, dir) => {
    S.look[key] = (S.look[key] + list.length + dir) % list.length;
    lookChanged();
  };
  $(`${prefix}-hat-prev`).addEventListener('click', () => step('hat', HATS, -1));
  $(`${prefix}-hat-next`).addEventListener('click', () => step('hat', HATS, 1));
  $(`${prefix}-skin-prev`).addEventListener('click', () => step('skin', SKINS, -1));
  $(`${prefix}-skin-next`).addEventListener('click', () => step('skin', SKINS, 1));
  pickers.push({ swatchesEl, hatEl: $(`${prefix}-hat-name`), skinEl: $(`${prefix}-skin-name`) });
}

function refreshPickers() {
  for (const p of pickers) {
    [...p.swatchesEl.children].forEach((b, i) => b.classList.toggle('on', i === S.look.color));
    p.hatEl.textContent = HATS[S.look.hat];
    p.skinEl.textContent = SKINS[S.look.skin];
  }
}

function lookChanged() {
  saveLook();
  refreshPickers();
  sfx.click();
  if (S.room && (S.room.phase === 'lobby' || S.room.phase === 'final')) {
    socket.emit('room:customize', { color: S.look.color, hat: S.look.hat, skin: S.look.skin });
  }
}

function titleError(msg) {
  $('title-error').textContent = msg || '';
}

function currentName() {
  const n = $('name-input').value.trim();
  S.look.name = n;
  saveLook();
  return n;
}

async function createRoom() {
  titleError('');
  $('btn-create').disabled = true;
  const res = await request(
    'room:create',
    { name: currentName(), color: S.look.color, hat: S.look.hat, skin: S.look.skin },
    (r) => {
      if (r.ok) enterRoom(r);
    }
  );
  $('btn-create').disabled = false;
  if (!res.ok) titleError(res.error);
}

async function joinRoom() {
  titleError('');
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length !== 4) {
    titleError('Room codes have 4 letters. Ask the host for theirs!');
    return;
  }
  $('btn-join').disabled = true;
  const res = await request(
    'room:join',
    { code, name: currentName(), color: S.look.color, hat: S.look.hat, skin: S.look.skin },
    (r) => {
      if (r.ok) enterRoom(r);
    }
  );
  $('btn-join').disabled = false;
  if (!res.ok) titleError(res.error);
  else if (res.lateJoin) toast('A round is in progress. You will jump in next round!');
}

function enterRoom(res) {
  S.me = res.playerId;
  saveSession(res.code, res.token);
  sfx.join();
}

function leaveToTitle(message) {
  clearSession();
  S.me = null;
  S.room = null;
  S.snaps = [];
  input.setEnabled(false);
  renderer.reset();
  $('overlay-intro').classList.add('hidden');
  $('overlay-results').classList.add('hidden');
  $('overlay-final').classList.add('hidden');
  showView('title');
  titleError(message || '');
}

async function leaveRoom() {
  await request('room:leave');
  leaveToTitle('');
}

// =============================================================== lobby
function renderLobby(st) {
  $('lobby-code').textContent = st.code;
  const grid = $('lobby-players');
  grid.textContent = '';
  for (const p of st.players) {
    const card = el('div', 'pcard');
    if (p.id === S.me) card.classList.add('me');
    if (!p.connected) card.classList.add('off');
    if (p.ready) card.classList.add('ready');
    if (p.id === st.hostId) card.appendChild(el('div', 'crown', '\u{1F451}'));
    const cv = el('canvas');
    cv.width = 160;
    cv.height = 208;
    card.appendChild(cv);
    addAvatar(cv, () => S.meta.get(p.id) || { color: 0, hat: 0, skin: 0 }, p.ready ? 'happy' : 'normal');
    card.appendChild(el('div', 'pname', p.id === S.me ? `${p.name} (you)` : p.name));
    card.appendChild(
      el('div', 'pstatus', !p.connected ? 'reconnecting…' : p.id === st.hostId ? 'Host' : p.ready ? 'Ready!' : 'Not ready')
    );
    grid.appendChild(card);
  }

  const host = iAmHost();
  const me = myRoomPlayer();
  const others = st.players.filter((p) => p.connected && p.id !== st.hostId);
  const readyOthers = others.filter((p) => p.ready).length;

  const sel = $('rounds-select');
  if (sel.dataset.sig !== st.allowedRounds.join(',')) {
    sel.textContent = '';
    for (const n of st.allowedRounds) {
      const o = el('option', null, `${n} round${n > 1 ? 's' : ''}`);
      o.value = String(n);
      sel.appendChild(o);
    }
    sel.dataset.sig = st.allowedRounds.join(',');
  }
  sel.value = String(st.rounds);
  sel.disabled = !host;

  $('btn-ready').classList.toggle('hidden', host);
  $('btn-ready').textContent = me && me.ready ? 'Ready! (click to undo)' : "I'm ready!";
  $('btn-ready').classList.toggle('on', !!(me && me.ready));
  $('btn-start').classList.toggle('hidden', !host);
  $('btn-start').textContent =
    others.length === 0 ? 'Start solo practice' : readyOthers === others.length ? 'Start match!' : `Start anyway (${readyOthers}/${others.length} ready)`;

  $('lobby-hint').textContent = host
    ? others.length === 0
      ? 'Share the code or invite link. Solo practice works, but it is way funnier with friends!'
      : `${st.players.length}/${st.maxPlayers} players. Start whenever you like.`
    : 'Waiting for the host to start the match…';
}

// =============================================================== overlays
function renderIntro(st) {
  const g = st.intro;
  S.theme = g.theme || 'sunny';
  $('intro-round').textContent = `Round ${st.round} of ${st.rounds}  ·  ${g.category}`;
  $('intro-title').textContent = g.name;
  $('intro-tagline').textContent = g.tagline;
  const ol = $('intro-steps');
  ol.textContent = '';
  for (const line of g.instructions) ol.appendChild(el('li', null, line));
  const ctr = $('intro-controls');
  ctr.textContent = '';
  for (const c of g.controls) ctr.appendChild(el('span', null, `${c.label}: ${c.keys}`));
}

function placeLabel(n) {
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

function renderResults(st) {
  const r = st.results;
  $('results-head').textContent = `Round ${r.round} results`;
  const rows = $('results-rows');
  rows.textContent = '';
  r.rows.forEach((row, i) => {
    const d = el('div', 'row');
    if (row.id === S.me) d.classList.add('me');
    if (row.place === 1) d.classList.add('first');
    d.style.animationDelay = `${i * 0.07}s`;
    d.appendChild(el('div', 'place', row.place === 1 ? '\u{1F3C6}' : placeLabel(row.place)));
    const cv = el('canvas');
    cv.width = 88;
    cv.height = 112;
    d.appendChild(cv);
    addAvatar(cv, () => ({ color: row.color, hat: row.hat, skin: row.skin }), row.place === 1 ? 'happy' : row.survived ? 'normal' : 'dizzy');
    const who = el('div', 'who', row.id === S.me ? `${row.name} (you)` : row.name);
    if (row.abandoned) who.appendChild(el('small', null, 'left the game'));
    else if (row.title) who.appendChild(el('small', null, row.title));
    d.appendChild(who);
    const pts = el('div', 'pts', `+${row.points}`);
    if (row.koBonus > 0) pts.appendChild(el('small', null, `${row.basePoints} place + ${row.koBonus} KO`));
    else pts.appendChild(el('small', null, row.detail || 'place'));
    d.appendChild(pts);
    d.appendChild(el('div', 'tot', `${row.total} total`));
    rows.appendChild(d);
  });
}

function renderFinal(st) {
  const f = st.final;
  const names = f.winners.map((id) => (f.standings.find((s) => s.id === id) || {}).name || '?');
  $('final-winner').textContent =
    names.length === 1 ? `${names[0]} wins!` : names.length === 2 ? `${names[0]} & ${names[1]} tie!` : "It's a big tie!";
  const rows = $('final-rows');
  rows.textContent = '';
  f.standings.forEach((s, i) => {
    const d = el('div', 'row tab');
    if (s.id === S.me) d.classList.add('me');
    if (s.place === 1) d.classList.add('first');
    d.style.animationDelay = `${i * 0.07}s`;
    d.appendChild(el('div', 'place', s.place === 1 ? '\u{1F3C6}' : placeLabel(s.place)));
    const cv = el('canvas');
    cv.width = 88;
    cv.height = 112;
    d.appendChild(cv);
    addAvatar(cv, () => ({ color: s.color, hat: s.hat, skin: s.skin }), s.place === 1 ? 'happy' : 'normal');
    d.appendChild(el('div', 'who', s.id === S.me ? `${s.name} (you)` : s.name));
    d.appendChild(el('div', 'pts', `${s.score}`));
    rows.appendChild(d);
  });
  const host = iAmHost();
  $('btn-again').classList.toggle('hidden', !host);
  $('btn-tolobby').classList.toggle('hidden', !host);
  $('final-wait').textContent = host ? '' : 'Waiting for the host to pick what happens next…';
}

// =============================================================== room state
function applyRoomState(st) {
  const prev = S.room;
  S.room = st;
  S.phaseEndsAt = performance.now() + st.endsInMs;
  for (const p of st.players) S.meta.set(p.id, { name: p.name, color: p.color, hat: p.hat, skin: p.skin });

  // If the server says we are not in this room any more, go back to the title.
  if (S.me && !st.players.some((p) => p.id === S.me)) {
    leaveToTitle('You are no longer in that room.');
    return;
  }

  const changed = !prev || prev.phase !== st.phase || prev.round !== st.round;
  if (changed) onPhaseEnter(prev, st);

  if (st.phase === 'lobby') renderLobby(st);
  $('overlay-intro').classList.toggle('hidden', st.phase !== 'intro');
  $('overlay-results').classList.toggle('hidden', st.phase !== 'results');
  $('overlay-final').classList.toggle('hidden', st.phase !== 'final');
  $('hud').classList.toggle('hidden', st.phase !== 'playing' && st.phase !== 'results');
  if (st.phase === 'intro') renderIntro(st);
  if (st.phase === 'results') renderResults(st);
  if (st.phase === 'final') renderFinal(st);
  if (st.phase !== 'playing') {
    $('overlay-countdown').classList.add('hidden');
    $('banner').classList.add('hidden');
  }
  S.hudSig = '';
}

function onPhaseEnter(prev, st) {
  if (prev && prev.phase === 'playing') input.setEnabled(false);
  switch (st.phase) {
    case 'lobby':
      renderer.reset();
      S.snaps = [];
      showView('lobby');
      break;
    case 'intro':
      renderer.reset();
      S.snaps = [];
      S.theme = (st.intro && st.intro.theme) || 'sunny';
      showView('stage');
      sfx.click();
      break;
    case 'playing': {
      renderer.reset();
      S.snaps = [];
      S.cdShown = null;
      S.goUntil = 0;
      showView('stage');
      const me = myRoomPlayer();
      input.setEnabled(!!(me && me.inRound));
      break;
    }
    case 'results': {
      showView('stage');
      const mine = st.results.rows.find((r) => r.id === S.me);
      if (mine && mine.place === 1 && !mine.abandoned) {
        sfx.win();
        renderer.confetti();
      } else sfx.lose();
      break;
    }
    case 'final': {
      showView('stage');
      sfx.win();
      renderer.confetti();
      break;
    }
    default:
      break;
  }
}

// =============================================================== snapshots
socket.on('room:state', applyRoomState);

socket.on('room:kicked', (info) => {
  leaveToTitle((info && info.reason) || 'You were removed from the room.');
});

socket.on('game:snap', (snap) => {
  if (!S.room || S.room.phase !== 'playing') return;
  snap.map = new Map(snap.ps.map((p) => [p.id, p]));
  S.snaps.push({ r: performance.now(), s: snap });
  if (S.snaps.length > 16) S.snaps.shift();
  handleEvents(snap);
  // Hot Potato: tick faster and louder for the last three seconds of the fuse.
  if (snap.bomb) {
    const f = Math.ceil(snap.bomb.fuse);
    if (f <= 3 && f > 0 && f !== S.lastFuse) sfx.fuse();
    S.lastFuse = f;
  } else {
    S.lastFuse = null;
  }
});

function nameOf(id) {
  const m = S.meta.get(id);
  return m ? m.name : '?';
}

const BONKS = ['BONK!', 'OOF!', 'YEET!', 'BOOP!', 'WHAM!', 'SHOVED!'];

function handleEvents(snap) {
  for (const ev of snap.ev) {
    const mine = ev.id === S.me;
    switch (ev.k) {
      case 'jump':
        renderer.markJump(ev.id);
        renderer.dust(OX + ev.x, OY + ev.y, '#ffffff', 4);
        sfx.jump(mine ? 1 : 0.3);
        break;
      case 'land':
        renderer.markLand(ev.id);
        renderer.dust(OX + ev.x, OY + ev.y, '#ffffff', 7);
        sfx.land(mine ? 1 : 0.35);
        break;
      case 'shove':
        sfx.shove();
        break;
      case 'hit':
        renderer.burst(OX + ev.x, OY + ev.y - 30, ['#ffe66d', '#ffffff', '#ff8fab'], 12, 240, 'star');
        renderer.floatText(OX + ev.x, OY + ev.y - 60, BONKS[Math.floor(Math.random() * BONKS.length)], '#fff27a', 24);
        renderer.addShake(ev.id === S.me ? 12 : 6);
        sfx.hit();
        break;
      case 'crack':
        sfx.crack();
        break;
      case 'fall':
        renderer.addShake(3);
        sfx.tileFall();
        break;
      case 'out': {
        renderer.markOut(ev.id);
        renderer.burst(OX + ev.x, OY + ev.y - 20, ['#ffffff', '#cfd8ff'], 8, 140, 'circle', 0.5);
        if (mine) renderer.addShake(10);
        sfx.fall();
        break;
      }
      case 'ko': {
        const victim = snap.map.get(ev.victim);
        const x = victim ? OX + victim.x : STAGE_W / 2;
        const y = victim ? OY + victim.y : STAGE_H / 2;
        renderer.floatText(x, y - 90, ev.id === S.me ? 'KO! +2' : `${nameOf(ev.id)} KO!`, '#ffd23f', ev.id === S.me ? 34 : 24);
        renderer.burst(x, y - 30, ['#ffd23f', '#ff6fb5', '#5ee08a'], 16, 280, 'star', 0.9);
        if (ev.id === S.me) sfx.ko();
        break;
      }
      case 'ghost':
        sfx.boo();
        break;
      case 'puddle':
        sfx.puddle();
        break;
      case 'slow':
        renderer.floatText(OX + ev.x, OY + ev.y - 70, 'SPLAT!', '#d9a7ff', 26);
        renderer.burst(OX + ev.x, OY + ev.y - 10, ['#9b5de5', '#d9a7ff'], 10, 160, 'circle', 0.6);
        sfx.slow();
        break;
      case 'deny':
        if (mine) {
          sfx.deny();
          toast('Float over solid floor to drop goo!');
        }
        break;
      case 'coin': {
        const gold = ev.jackpot ? ['#ffd23f', '#fff27a', '#ffffff'] : ['#ffd23f', '#ffffff'];
        renderer.burst(OX + ev.x, OY + ev.y - 14, gold, ev.jackpot ? 18 : 6, ev.jackpot ? 260 : 120, 'star', ev.jackpot ? 0.8 : 0.4);
        if (mine) {
          renderer.floatText(OX + ev.x, OY + ev.y - 44, `+${ev.v}`, '#ffe66d', ev.jackpot ? 36 : 22);
          sfx.coin(1);
          if (ev.jackpot) sfx.jackpot();
        } else sfx.coin(0.25);
        break;
      }
      case 'jackpot':
        renderer.floatText(OX + ev.x, OY + ev.y - 54, 'JACKPOT!', '#fff27a', 30);
        toast('A JACKPOT coin appeared!');
        sfx.jackpot();
        break;
      case 'drop':
        renderer.burst(OX + ev.x, OY + ev.y - 20, ['#ffd23f', '#ffe27a'], 8, 200, 'circle', 0.5);
        if (mine) renderer.floatText(OX + ev.x, OY + ev.y - 70, `-${ev.n}`, '#ff8a8a', 26);
        sfx.drop();
        break;
      case 'bomb':
        sfx.pass();
        if (ev.from) {
          renderer.floatText(OX + ev.x, OY + ev.y - 70, 'TAG!', '#ff8a3d', 28);
          renderer.burst(OX + ev.x, OY + ev.y - 30, ['#ffb02e', '#ff595e', '#ffffff'], 10, 220, 'star', 0.5);
        } else {
          toast(ev.id === S.me ? 'You have the bomb! SHOVE someone to pass it!' : `${nameOf(ev.id)} has the bomb!`);
        }
        break;
      case 'boom':
        renderer.burst(OX + ev.x, OY + ev.y - 25, ['#ff595e', '#ffb02e', '#ffe66d', '#3a3a4a'], 34, 440, 'star', 1.0);
        renderer.burst(OX + ev.x, OY + ev.y - 25, ['#ffffff', '#ffd9a0'], 14, 300, 'circle', 0.7);
        renderer.floatText(OX + ev.x, OY + ev.y - 90, 'BOOM!', '#ff8a3d', 40);
        renderer.addShake(ev.id === S.me ? 22 : 14);
        sfx.boom();
        break;
      case 'zoneWarn':
        toast('The hill is about to move!');
        sfx.tick();
        break;
      case 'zoneMove':
        renderer.addShake(3);
        sfx.zone();
        break;
      case 'go':
        sfx.go();
        renderer.addShake(8);
        break;
      case 'end':
        if (snap.alive >= 1) {
          renderer.confetti();
          sfx.win();
        }
        break;
      default:
        break;
    }
  }
}

// Build the world to draw "right now" from the buffered snapshots.
function sampleFrame(now) {
  const buf = S.snaps;
  if (buf.length === 0) return null;
  const latest = buf[buf.length - 1];
  const renderT = now - INTERP_MS;
  let i = buf.length - 1;
  while (i > 0 && buf[i].r > renderT) i--;
  const a = buf[i];
  const b = buf[Math.min(i + 1, buf.length - 1)];
  const span = b.r - a.r;
  const k = span > 0 ? Math.min(1, Math.max(0, (renderT - a.r) / span)) : 0;
  const ahead = Math.min(0.06, (now - latest.r) / 1000);

  const players = latest.s.ps.map((p) => {
    if (p.id === S.me) {
      // Your own character is drawn at the freshest position (plus a tiny
      // prediction) so it feels responsive.
      if (p.st !== 'alive') return p;
      return { ...p, x: p.x + p.vx * ahead, y: p.y + p.vy * ahead, z: Math.max(0, p.z + p.vz * ahead) };
    }
    const pa = a.s.map.get(p.id);
    const pb = b.s.map.get(p.id);
    if (!pa || !pb) return p;
    return {
      ...pb,
      x: pa.x + (pb.x - pa.x) * k,
      y: pa.y + (pb.y - pa.y) * k,
      z: pa.z + (pb.z - pa.z) * k,
    };
  });

  const arena = S.room && S.room.arena;
  return {
    theme: S.theme,
    time: latest.s.t + (S.room && S.room.phase === 'playing' ? Math.min(0.1, (now - latest.r) / 1000) : 0),
    tiles: latest.s.tiles,
    players,
    puddles: latest.s.pd,
    meta: S.meta,
    myId: S.me,
    cols: arena ? arena.cols : 14,
    rows: arena ? arena.rows : 9,
    finished: latest.s.fin,
    aliveCount: latest.s.alive,
    latest: latest.s,
  };
}

// =============================================================== HUD
function updateHud(frame) {
  const st = S.room;
  if (!st || !frame) return;
  const arena = st.arena;
  const t = frame.time;

  $('hud-round').textContent = `Round ${st.round}/${st.rounds}`;
  const left = Math.max(0, Math.ceil(arena.maxTime - Math.max(0, t)));
  const timer = $('hud-timer');
  if (timer.textContent !== String(left)) timer.textContent = String(left);
  timer.classList.toggle('danger', left <= 10 && t >= 0 && !frame.finished);
  const gid = frame.latest.gid;
  const arenaGame = !!gid && gid !== 'crumbleFloor'; // Gold Grab, Hot Potato, Hill Hustle...
  const status = arenaGame ? frame.latest.hud || '' : `${frame.aliveCount} standing`;
  if ($('hud-alive').textContent !== status) $('hud-alive').textContent = status;

  const mine = frame.latest.map.get(S.me);
  const ghost = !arenaGame && mine && mine.st === 'ghost';
  $('ab-jump-label').textContent = ghost ? 'Float' : arenaGame ? arena.jumpLabel || 'Jump' : 'Jump';
  $('ab-shove-label').textContent = ghost ? 'Drop goo' : arenaGame ? arena.shoveLabel || 'Shove' : 'Shove';
  const fill = $('ab-shove-fill');
  let frac = 1;
  if (mine && mine.st === 'alive') frac = 1 - Math.min(1, mine.cd / arena.shoveCooldown);
  else if (ghost) frac = mine.am <= 0 ? 0 : 1 - Math.min(1, mine.pc / arena.gooCooldown);
  fill.style.transform = `scaleX(${frac.toFixed(2)})`;
  $('ab-shove').classList.toggle('cooling', frac < 1);

  // Scoreboard chips (rebuilt only when something changes)
  // (In the arena games the chips show this round's score: coins, booms, seconds.)
  const sig = st.players.map((p) => `${p.id}:${p.score}:${(frame.latest.map.get(p.id) || {}).st}:${(frame.latest.map.get(p.id) || {}).rs}`).join('|');
  if (sig !== S.hudSig) {
    S.hudSig = sig;
    const box = $('hud-scores');
    box.textContent = '';
    const roundScore = (p) => ((frame.latest.map.get(p.id) || {}).rs || 0);
    const list = [...st.players];
    if (arenaGame) {
      const dir = arena.scoreDir === 'low' ? 1 : -1;
      list.sort((x, y) => dir * (roundScore(x) - roundScore(y)) || y.score - x.score);
    } else {
      list.sort((x, y) => y.score - x.score);
    }
    for (const p of list) {
      const ps = frame.latest.map.get(p.id);
      const chip = el('div', 'chip');
      if (p.id === S.me) chip.classList.add('me');
      if (ps && (ps.st === 'left' || (!arenaGame && ps.st !== 'alive'))) chip.classList.add('out');
      const dot = el('i');
      dot.style.background = COLORS[p.color % COLORS.length].hex;
      chip.appendChild(dot);
      chip.appendChild(el('span', null, arenaGame ? `${p.name} ${roundScore(p)}` : `${p.name} ${p.score}`));
      if (arenaGame && arena.scoreLabel) chip.title = `${roundScore(p)} ${arena.scoreLabel} this round (${p.score} points so far)`;
      box.appendChild(chip);
    }
  }

  // Countdown overlay
  const cd = $('overlay-countdown');
  const txt = $('countdown-text');
  if (st.phase === 'playing' && t < 0) {
    const n = Math.ceil(-t);
    cd.classList.remove('hidden');
    if (S.cdShown !== n) {
      S.cdShown = n;
      txt.textContent = String(n);
      txt.classList.remove('go');
      txt.style.animation = 'none';
      void txt.offsetWidth;
      txt.style.animation = '';
      sfx.tick();
    }
  } else if (st.phase === 'playing' && t >= 0 && t < 0.8) {
    cd.classList.remove('hidden');
    if (S.cdShown !== 'go') {
      S.cdShown = 'go';
      txt.textContent = 'GO!';
      txt.classList.add('go');
      txt.style.animation = 'none';
      void txt.offsetWidth;
      txt.style.animation = '';
    }
  } else {
    cd.classList.add('hidden');
  }

  // Spectator banner
  const banner = $('banner');
  if (st.phase === 'playing' && (!mine || mine.st === 'left')) {
    banner.textContent = "You're watching this round. You'll play in the next one!";
    banner.classList.remove('hidden');
  } else if (st.phase === 'playing' && mine && mine.st === 'ghost') {
    banner.textContent = 'You are a ghost! Press E over solid floor to drop goo on the survivors.';
    banner.classList.remove('hidden');
  } else if (st.phase === 'playing' && arenaGame && mine && mine.bm && t >= 0 && !frame.finished) {
    banner.textContent = 'YOU HAVE THE BOMB! Shove someone to pass it on!';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

// =============================================================== main loop
function updateTimersText(now) {
  const st = S.room;
  if (!st) return;
  const secs = Math.max(0, Math.ceil((S.phaseEndsAt - now) / 1000));
  if (st.phase === 'intro') $('intro-count').textContent = `Starting in ${secs}…`;
  if (st.phase === 'results') {
    $('results-foot').textContent = st.round < st.rounds ? `Next round in ${secs}…` : `Final scores in ${secs}…`;
  }
}

function loop(now) {
  const dt = Math.min(0.05, (now - S.lastFrame) / 1000);
  S.lastFrame = now;

  if (S.view === 'stage') {
    const frame = sampleFrame(now);
    if (frame) {
      renderer.draw(frame, dt);
      if (S.room && (S.room.phase === 'playing' || S.room.phase === 'results')) updateHud(frame);
    } else {
      renderer.idle(S.theme, dt);
    }
  }
  animateAvatars(now / 1000);
  updateTimersText(now);
  requestAnimationFrame(loop);
}

// =============================================================== wiring
function bindUi() {
  buildLogo();

  mountPicker('title');
  mountPicker('lobby');
  refreshPickers();
  addAvatar($('title-preview'), () => S.look);

  $('name-input').value = S.look.name;
  const params = new URLSearchParams(location.search);
  const codeParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (codeParam) $('code-input').value = codeParam;

  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click', joinRoom);
  $('code-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });
  $('code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  $('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ($('code-input').value.length === 4 ? joinRoom() : createRoom());
  });

  $('btn-leave').addEventListener('click', leaveRoom);
  $('btn-leave2').addEventListener('click', leaveRoom);
  $('btn-copy').addEventListener('click', async () => {
    const link = `${location.origin}/?room=${S.room ? S.room.code : ''}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied! Send it to your friends.');
    } catch (e) {
      window.prompt('Copy this invite link:', link);
    }
  });
  $('btn-ready').addEventListener('click', () => {
    const me = myRoomPlayer();
    socket.emit('room:ready', !(me && me.ready));
    sfx.click();
  });
  $('btn-start').addEventListener('click', async () => {
    $('lobby-error').textContent = '';
    const res = await request('match:start');
    if (!res.ok) $('lobby-error').textContent = res.error;
  });
  $('rounds-select').addEventListener('change', async (e) => {
    const res = await request('room:rounds', Number(e.target.value));
    if (!res.ok) $('lobby-error').textContent = res.error;
  });
  $('btn-again').addEventListener('click', async () => {
    const res = await request('match:start');
    if (!res.ok) toast(res.error);
  });
  $('btn-tolobby').addEventListener('click', async () => {
    const res = await request('match:toLobby');
    if (!res.ok) toast(res.error);
  });

  const muteBtn = $('mute-btn');
  const syncMute = () => {
    muteBtn.textContent = isMuted() ? '\u{1F507}' : '\u{1F50A}';
  };
  syncMute();
  muteBtn.addEventListener('click', () => {
    setMuted(!isMuted());
    syncMute();
  });
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (e.code === 'KeyM' && tag !== 'INPUT' && tag !== 'SELECT') {
      setMuted(!isMuted());
      syncMute();
    }
  });
  // Browsers only allow sound after the first click/key press.
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
}

// =============================================================== connection
async function tryRejoin() {
  const sess = loadSession();
  if (!sess || S.rejoining) return;
  S.rejoining = true;
  const res = await request('room:rejoin', sess, (r) => {
    if (r.ok) S.me = r.playerId;
  });
  S.rejoining = false;
  if (!res.ok) {
    leaveToTitle(S.room ? 'That room has ended.' : '');
  }
}

socket.on('connect', async () => {
  $('conn-banner').classList.add('hidden');
  if (S.booted) await tryRejoin();
});
socket.on('disconnect', () => {
  $('conn-banner').classList.remove('hidden');
  input.setEnabled(false);
});
socket.on('connect_error', () => {
  $('conn-banner').classList.remove('hidden');
});

async function boot() {
  bindUi();
  showView('title');
  requestAnimationFrame(loop);
  S.booted = true;
  if (loadSession()) await tryRejoin();
}

boot();
