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

import { socket, request, saveSession, loadSession, clearSession, transportName } from './net.js';
import { Renderer, drawPreview } from './renderer.js';
import { Input } from './input.js';
import { Predictor, walkableFor } from './predict.js';
import { decodeSnap } from './snapcodec.js';
import { sfx, unlockAudio, isMuted, setMuted } from './audio.js';
import { music, sceneFor } from './music.js';
import { STAGE_W, STAGE_H, OX, OY, COLORS, HATS, SKINS, BACKS, THEMES, EMOTES } from './constants.js';
import {
  KINDS, KIND_LABEL, loadWallet, saveWallet, owns, credit, buy, nextOwned, sanitizeLook,
  catalogue, nameOf as itemName, priceOf, isUnlockOnly, isPackOnly,
  isTradable, checkTrade, applyTrade, TRADE_MAX_ITEMS, TRADE_MAX_COINS,
} from './shop.js';
import {
  PACKS, OUTFITS, RARITY_BLURB, getPack, RARITY_LABEL, RARITY_COLOR, PITY_LIMIT, DUPE_COINS, oddsOf, openPack, outfitProgress, wearOutfit, rarityOfItem,
} from './packs.js';
import {
  ACHIEVEMENTS, loadTrophies, saveTrophies, emptyTrophies, recordRound, recordFinal, recordPowerRound, recordCoins,
  recordOwned, recordSocial, applyRewards, achievementFor, progressOf, unlockedCount,
} from './achievements.js';

const $ = (id) => document.getElementById(id);
const INTERP_MIN = 55; // other players are drawn this far in the past (ms), for smoothness...
const INTERP_MAX = 160; // ...it adapts between these two to the network's current steadiness

// =============================================================== state
const S = {
  me: null, // my player id
  room: null, // latest room state from the server
  view: 'title',
  phaseEndsAt: 0,
  snaps: [], // recent world snapshots: { r: receivedAtMs, s: snapshot }
  meta: new Map(), // player id -> { name, color, hat, skin, back }
  wallet: loadWalletSafe(),
  trophies: loadTrophiesSafe(), // achievements (see achievements.js)
  look: null, // filled in right below (it needs the wallet)
  theme: 'sunny',
  avatars: [], // little canvases that animate (menus, results)
  lastFrame: performance.now(),
  cdShown: null, // which countdown number is on screen
  goUntil: 0,
  hudSig: '',
  rejoining: false,
  booted: false,
  drawFails: 0, // frames in a row that failed to draw (see onDrawError)
  drawErr: '',
  waitSince: 0, // since when no game data has arrived while playing (see watchGameData)
  interp: 90, // current interpolation delay in ms (adapts)
  chat: [], // text chat messages of this room (newest last)
  chatUnread: 0,
  chatOn: true,
  emotes: new Map(), // player id -> { e (emoji), born, until } for the bubbles above heads
  net: { lastSnapAt: 0, mean: 33, jitter: 4, snapsPerSec: 0, snapCount: 0, ping: null },
  perf: { frames: 0, since: performance.now(), fps: 60, worst: 0, lowWins: 0, goodWins: 0 },
  showPerf: /[?&]debug\b/.test(location.search),
};

function storage() {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}
function loadWalletSafe() {
  const st = storage();
  return st ? loadWallet(st) : loadWallet({ getItem: () => null });
}
function saveWalletNow() {
  const st = storage();
  if (st) saveWallet(st, S.wallet);
}
function loadTrophiesSafe() {
  const st = storage();
  return st ? loadTrophies(st) : emptyTrophies();
}
function saveTrophiesNow() {
  const st = storage();
  if (st) saveTrophies(st, S.trophies);
}

function loadLook() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('tm_look') || '{}') || {};
  } catch (e) {
    saved = {};
  }
  const ownedColors = S.wallet.owned.color;
  const look = {
    name: typeof saved.name === 'string' ? saved.name : '',
    color: Number.isInteger(saved.color) ? saved.color % COLORS.length : ownedColors[Math.floor(Math.random() * ownedColors.length)],
    hat: Number.isInteger(saved.hat) && saved.hat >= 0 ? saved.hat % HATS.length : 0,
    skin: Number.isInteger(saved.skin) && saved.skin >= 0 ? saved.skin % SKINS.length : 0,
    back: Number.isInteger(saved.back) && saved.back >= 0 ? saved.back % BACKS.length : 0,
  };
  // Never wear something you have not bought (e.g. an old saved look).
  return { ...look, ...sanitizeLook(S.wallet, look), name: look.name };
}
function saveLook() {
  try {
    localStorage.setItem('tm_look', JSON.stringify(S.look));
  } catch (e) {
    /* ignore */
  }
}

// Achievement rewards are re-granted on every start (it is safe to repeat), so a
// wiped or older wallet can never lose a hat you earned. This runs BEFORE the
// saved look is loaded, so a worn reward hat is still allowed.
applyRewards(S.trophies, S.wallet);
recordOwned(S.trophies, S.wallet);
applyRewards(S.trophies, S.wallet);
saveWalletNow();
saveTrophiesNow();

S.look = loadLook();

const renderer = new Renderer($('game-canvas'), $('bg-canvas'));
// If the browser throws away the canvas (memory pressure, graphics card reset), repaint everything when it is back.
$('game-canvas').addEventListener('contextlost', (e) => e.preventDefault());
$('game-canvas').addEventListener('contextrestored', () => renderer.resize());

const predictor = new Predictor();
// Handy for testing: add ?nopredict to the address to switch the movement guessing off (and compare
// how it feels), or ?debug to expose the latest drawn frame as window.__tmFrame.
const URL_FLAGS = new URLSearchParams(location.search);
const NO_PREDICT = URL_FLAGS.has('nopredict');
const DEBUG = URL_FLAGS.has('debug');
const input = new Input((controls) => {
  predictor.record(performance.now(), controls.mx, controls.my); // so your own character can react at once
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

let avatarFrame = 0;
function animateAvatars(tSec) {
  // The little menu characters only need ~30 pictures a second, and nothing needs drawing for a screen
  // that is hidden (the lobby's cards stay in the page while you play, which wasted time every frame).
  avatarFrame++;
  if (avatarFrame % 2 === 0) return;
  S.avatars = S.avatars.filter((a) => a.canvas.isConnected);
  for (const a of S.avatars) {
    if (a.canvas.getClientRects().length === 0) continue; // hidden
    drawPreview(a.canvas, a.getLook(), tSec + a.off, a.mood);
  }
}

// Things that depend on the room's settings: the Rage Bait look and the emoji button.
function syncRoomExtras() {
  const inRoom = !!S.room;
  document.body.classList.toggle('rage-bait', inRoom && !!S.room.rage);
  $('rage-badge').classList.toggle('hidden', !(inRoom && S.room.rage));
  $('emote-btn').classList.toggle('hidden', !inRoom);
  // Text chat opens only between rounds.
  const chatPhase = inRoom && ['lobby', 'results', 'pitstop', 'final'].includes(S.room.phase);
  $('chat').classList.toggle('hidden', !chatPhase);
  if (chatPhase && !$('chat').classList.contains('closed')) chatClearUnread();
  if (!inRoom) $('emote-pop').classList.add('hidden');
}

function showView(v) {
  S.view = v;
  if (v === 'title') {
    music.setScene(sceneFor({ phase: 'title' }));
    setTimeout(refreshPublicRooms, 50);
  }
  $('screen-title').classList.toggle('hidden', v !== 'title');
  $('screen-lobby').classList.toggle('hidden', v !== 'lobby');
  $('stage-wrap').classList.toggle('hidden', v !== 'stage');
  document.body.classList.toggle('in-arena', v === 'stage');
  $('btn-home').classList.toggle('hidden', v === 'title'); // in a room (lobby or match) there is always a way home
  resetHomeButton();
  if (v === 'stage') fitStage();
  syncRoomExtras();
}

function fitStage() {
  const k = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const stage = $('stage');
  const left = (window.innerWidth - STAGE_W * k) / 2;
  const top = (window.innerHeight - STAGE_H * k) / 2;
  stage.style.transform = `scale(${k})`;
  stage.style.left = `${left}px`;
  stage.style.top = `${top}px`;
  S.fit = { top, bottom: top + STAGE_H * k };
  S.bgSig = ''; // the window shape changed, so repaint the edges
  renderer.resize(k);
}
window.addEventListener('resize', fitStage);

// The game is a fixed 1024x720 picture scaled to fit the window. Instead of
// leaving black bars where it does not reach, the page behind it is painted
// with the same colours, so the picture just seems to continue to the edges.
function syncStageBg(themeKey) {
  const ph = S.room ? S.room.phase : '';
  const solid = ph === 'intro' || ph === 'pitstop' || ph === 'final';
  const dim = ph === 'results';
  const sig = `${themeKey}|${solid ? 's' : dim ? 'd' : 'n'}`;
  if (sig === S.bgSig || !S.fit) return;
  S.bgSig = sig;
  const wrap = $('stage-wrap');
  // The purple intro / pit stop / final screens are painted on the whole window
  // (see .solid-bg in style.css) so they have no edges either.
  wrap.classList.toggle('solid-bg', solid);
  if (solid) {
    wrap.style.background = '';
    return;
  }
  const t = THEMES[themeKey] || THEMES.sunny;
  const grad = `linear-gradient(180deg, ${t.bg[0]} ${S.fit.top}px, ${t.bg[1]} ${S.fit.bottom}px)`;
  wrap.style.background = dim ? `linear-gradient(rgba(26,15,46,0.62), rgba(26,15,46,0.62)), ${grad}` : grad;
}

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
      if (!owns(S.wallet, 'color', i)) {
        openShop('color', i);
        return;
      }
      S.look.color = i;
      lookChanged();
    });
    swatchesEl.appendChild(b);
  });
  // The < > buttons only cycle through things you own.
  const step = (key, dir) => {
    S.look[key] = nextOwned(S.wallet, key, S.look[key], dir);
    lookChanged();
  };
  $(`${prefix}-hat-prev`).addEventListener('click', () => step('hat', -1));
  $(`${prefix}-hat-next`).addEventListener('click', () => step('hat', 1));
  $(`${prefix}-skin-prev`).addEventListener('click', () => step('skin', -1));
  $(`${prefix}-skin-next`).addEventListener('click', () => step('skin', 1));
  $(`${prefix}-back-prev`).addEventListener('click', () => step('back', -1));
  $(`${prefix}-back-next`).addEventListener('click', () => step('back', 1));
  const packsBtn = $(`${prefix}-packs`);
  if (packsBtn) packsBtn.addEventListener('click', () => openPacks());
  const shopBtn = $(`${prefix}-shop`);
  if (shopBtn) shopBtn.addEventListener('click', () => openShop());
  const troBtn = $(`${prefix}-trophies`);
  if (troBtn) troBtn.addEventListener('click', () => openTrophies());
  pickers.push({ swatchesEl, hatEl: $(`${prefix}-hat-name`), skinEl: $(`${prefix}-skin-name`), backEl: $(`${prefix}-back-name`) });
}

function refreshPickers() {
  for (const p of pickers) {
    [...p.swatchesEl.children].forEach((b, i) => {
      b.classList.toggle('on', i === S.look.color);
      b.classList.toggle('locked', !owns(S.wallet, 'color', i));
    });
    p.hatEl.textContent = HATS[S.look.hat];
    p.skinEl.textContent = SKINS[S.look.skin];
    p.backEl.textContent = BACKS[S.look.back];
  }
  for (const c of document.querySelectorAll('.coin-count')) c.textContent = String(S.wallet.coins);
  for (const c of document.querySelectorAll('.trophy-count')) c.textContent = `${unlockedCount(S.trophies)}/${ACHIEVEMENTS.length}`;
}

function lookChanged() {
  saveLook();
  refreshPickers();
  if (SHOP.open) renderShop();
  sfx.click();
  if (S.room && (S.room.phase === 'lobby' || S.room.phase === 'final')) {
    socket.emit('room:customize', { color: S.look.color, hat: S.look.hat, skin: S.look.skin, back: S.look.back });
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
    { name: currentName(), color: S.look.color, hat: S.look.hat, skin: S.look.skin, back: S.look.back },
    (r) => {
      if (r.ok) enterRoom(r);
    }
  );
  $('btn-create').disabled = false;
  if (!res.ok) titleError(res.error);
}

async function joinRoom(forcedCode) {
  titleError('');
  const code = (typeof forcedCode === 'string' ? forcedCode : $('code-input').value).trim().toUpperCase();
  if (code.length !== 4) {
    titleError('Room codes have 4 letters. Ask the host for theirs!');
    return;
  }
  $('btn-join').disabled = true;
  const res = await request(
    'room:join',
    { code, name: currentName(), color: S.look.color, hat: S.look.hat, skin: S.look.skin, back: S.look.back },
    (r) => {
      if (r.ok) enterRoom(r);
    }
  );
  $('btn-join').disabled = false;
  if (!res.ok) titleError(res.error);
  else if (res.lateJoin) toast('A round is in progress. You will jump in next round!');
}

// ---- public rooms list (home page) -------------------------------------------
let publicBusy = false;
// ---- map picker (the list of maps comes from the server, so it can never drift)
let MAP_LIST = [];
async function loadMaps() {
  try {
    const res = await fetch('/api/maps');
    const list = await res.json();
    if (Array.isArray(list)) MAP_LIST = list.filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string');
  } catch (e) {
    MAP_LIST = []; // no picker; the game still picks maps on its own
  }
  if (S.room) fillMapSelect(S.room, S.room.hostId === S.me);
}
function fillMapSelect(st, host) {
  const sel = $('map-select');
  $('map-wrap').classList.toggle('hidden', !host || MAP_LIST.length === 0);
  if (sel.dataset.sig !== String(MAP_LIST.length)) {
    sel.textContent = '';
    const first = el('option', null, 'Random mix');
    first.value = 'random';
    sel.appendChild(first);
    for (const m of MAP_LIST) {
      const o = el('option', null, m.name);
      o.value = m.id;
      o.title = m.note || '';
      sel.appendChild(o);
    }
    sel.dataset.sig = String(MAP_LIST.length);
  }
  sel.value = st.mapPick || 'random';
}

async function refreshPublicRooms() {
  if (publicBusy || S.view !== 'title' || !socket.connected) return;
  publicBusy = true;
  const res = await request('rooms:list', null);
  publicBusy = false;
  renderPublicRooms(res && res.ok ? res.rooms : null);
}

function renderPublicRooms(rooms) {
  const box = $('public-list');
  box.textContent = '';
  if (!rooms) {
    box.appendChild(el('div', 'public-empty', 'Could not load the list. Try the refresh button.'));
    return;
  }
  if (rooms.length === 0) {
    box.appendChild(el('div', 'public-empty', 'No public rooms right now. Create one and tick "Public room" in the lobby!'));
    return;
  }
  for (const r of rooms) {
    const row = el('button', 'public-row');
    row.type = 'button';
    const playing = r.phase !== 'lobby' && r.phase !== 'final';
    row.appendChild(el('span', 'pr-host', `${r.host}'s room${r.rage ? ' \u{1F525}' : ''}`));
    row.appendChild(el('span', 'pr-code', r.code));
    row.appendChild(el('span', 'pr-count', `${r.players}/${r.max}`));
    row.appendChild(el('span', 'pr-state' + (playing ? ' live' : ''), playing ? `Playing (round ${r.round}/${r.rounds})` : 'In the lobby'));
    row.appendChild(el('span', 'pr-join', 'Join'));
    row.addEventListener('click', () => {
      sfx.click();
      $('code-input').value = r.code;
      joinRoom(r.code);
    });
    box.appendChild(row);
  }
}

setInterval(() => {
  if (!document.hidden) refreshPublicRooms();
}, 5000);

function enterRoom(res) {
  S.me = res.playerId;
  saveSession(res.code, res.token);
  sfx.join();
}

function leaveToTitle(message) {
  closeTradeWindow();
  clearSession();
  S.me = null;
  S.room = null;
  S.snaps = [];
  predictor.clear();
  S.emotes.clear();
  S.chat = [];
  S.chatUnread = 0;
  renderChat();
  input.setEnabled(false);
  renderer.reset();
  $('overlay-intro').classList.add('hidden');
  $('overlay-results').classList.add('hidden');
  $('overlay-final').classList.add('hidden');
  showView('title');
  titleError(message || '');
}

// The Home button (in the lobby and during a match). Two clicks, so nobody leaves a match by accident.
let homeTimer = 0;
function resetHomeButton() {
  clearTimeout(homeTimer);
  const b = $('btn-home');
  b.textContent = '\u{1F3E0} Home';
  b.classList.remove('sure');
}
function onHomeClick() {
  const b = $('btn-home');
  b.blur(); // so the space bar (jump) can never press it
  if (S.view === 'lobby' || b.classList.contains('sure')) {
    resetHomeButton();
    leaveRoom();
    return;
  }
  b.textContent = 'Leave the match? Click again';
  b.classList.add('sure');
  clearTimeout(homeTimer);
  homeTimer = setTimeout(resetHomeButton, 3000);
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
    card.dataset.pid = p.id;
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
    if (p.id !== S.me && p.connected) {
      const tb = el('button', 'trade-btn', '\u{1F91D} Trade');
      tb.type = 'button';
      tb.addEventListener('click', () => startTrade(p.id));
      card.appendChild(tb);
    }
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
  const maxSel = $('max-select');
  const cap = st.playerCap || st.maxPlayers;
  if (maxSel.dataset.sig !== String(cap)) {
    maxSel.textContent = '';
    for (let n = 2; n <= cap; n++) {
      const o = el('option', null, `up to ${n}`);
      o.value = String(n);
      maxSel.appendChild(o);
    }
    maxSel.dataset.sig = String(cap);
  }
  maxSel.value = String(st.maxPlayers);
  maxSel.disabled = !host;
  $('public-wrap').classList.toggle('hidden', !host);
  $('public-check').checked = !!st.isPublic;
  fillMapSelect(st, host);
  $('rage-wrap').classList.toggle('hidden', !host);
  $('rage-check').checked = !!st.rage;

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
  const pw = $('intro-power');
  const mine = (myRoomPlayer() || {}).power || [];
  pw.textContent = '';
  pw.classList.toggle('hidden', mine.length === 0);
  if (mine.length) {
    pw.appendChild(el('span', null, 'Your power-ups:'));
    for (const id of mine) {
      const def = powerDef(st, id);
      if (def) pw.appendChild(el('span', null, `${def.icon} ${def.name}`));
    }
  }
}

// =============================================================== pit stop
// Power-ups are bought with the "purse" that the SERVER keeps. The browser only
// asks (shop:buy / shop:refund / shop:done) and then draws whatever the server
// says in the next room state.
function powerDef(st, id) {
  return (st.powerups || []).find((p) => p.id === id) || null;
}

function pitMsg(text, good) {
  const m = $('pit-msg');
  m.textContent = text || '';
  m.classList.toggle('good', !!good);
}

async function pitAction(kind, id) {
  const res = await request(kind === 'buy' ? 'shop:buy' : 'shop:refund', id);
  if (res.ok) {
    sfx.coin();
    pitMsg('');
  } else {
    sfx.lose();
    pitMsg(res.error || 'That did not work.');
  }
}

function renderPitstop(st) {
  const me = myRoomPlayer();
  if (!me) return;
  const purseEl = $('pit-purse');
  if (purseEl.textContent !== String(me.purse)) {
    purseEl.textContent = String(me.purse);
    const chip = purseEl.parentElement;
    chip.classList.remove('bump');
    void chip.offsetWidth;
    chip.classList.add('bump');
  }
  const slots = st.maxPowerSlots || 2;
  const have = new Set(me.power);
  const full = me.power.length >= slots;
  const note = $('pit-note');
  note.textContent = `Power-ups last for the next round only. Carry up to ${slots} (you have ${me.power.length}).`;
  if (me.underdog) note.appendChild(el('b', null, ' Comeback price: 30% off for you!'));

  const offers = $('pit-offers');
  offers.textContent = '';
  for (const def of st.powerups) {
    const owned = have.has(def.id);
    const price = me.underdog ? def.underdogPrice : def.price;
    const cant = !owned && (full || me.purse < price);
    const b = el('button', 'pit-card' + (owned ? ' have' : '') + (cant ? ' cant' : ''));
    b.type = 'button';
    b.appendChild(el('div', 'ic', def.icon));
    b.appendChild(el('div', 'nm', def.name));
    b.appendChild(el('div', 'ds', def.desc));
    const pr = el('div', 'pr');
    if (owned) {
      pr.classList.add('got');
      pr.textContent = 'Got it ✓';
      b.title = 'Tap to get your coins back';
    }
    else {
      if (me.underdog) pr.appendChild(el('s', null, String(def.price)));
      pr.appendChild(document.createTextNode(String(price)));
    }
    b.appendChild(pr);
    b.addEventListener('click', () => {
      if (owned) pitAction('refund', def.id);
      else if (full) pitMsg(`You can carry ${slots} power-ups. Tap one you own to swap it out.`);
      else if (me.purse < price) pitMsg(`You need ${price - me.purse} more coins for that.`);
      else pitAction('buy', def.id);
    });
    offers.appendChild(b);
  }

  const others = $('pit-others');
  others.textContent = '';
  for (const p of st.players) {
    if (!p.connected) continue;
    const chip = el('div', 'chip' + (p.done ? ' ready' : '') + (p.id === S.me ? ' me' : ''));
    const dot = el('i');
    dot.style.background = COLORS[p.color % COLORS.length].hex;
    chip.appendChild(dot);
    const icons = p.power.map((id) => (powerDef(st, id) || {}).icon || '').join('');
    chip.appendChild(document.createTextNode(`${p.name}${p.done ? ' ✓' : ''} ${icons}`));
    others.appendChild(chip);
  }

  const btn = $('pit-done');
  btn.textContent = me.done ? 'Ready ✓ (tap to shop more)' : "I'm ready";
  btn.classList.toggle('waiting', !!me.done);
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
    addAvatar(cv, () => ({ color: row.color, hat: row.hat, skin: row.skin, back: row.back }), row.place === 1 ? 'happy' : row.survived ? 'normal' : 'dizzy');
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
    addAvatar(cv, () => ({ color: s.color, hat: s.hat, skin: s.skin, back: s.back }), s.place === 1 ? 'happy' : 'normal');
    d.appendChild(el('div', 'who', s.id === S.me ? `${s.name} (you)` : s.name));
    d.appendChild(el('div', 'pts', `${s.score}`));
    rows.appendChild(d);
  });
  const host = iAmHost();
  $('btn-again').classList.toggle('hidden', !host);
  $('btn-tolobby').classList.toggle('hidden', !host);
  $('final-wait').textContent = host ? '' : 'Waiting for the host to pick what happens next…';
}

// =============================================================== shop + coins
// Coins are paid out once per round / match (the server sends the amount and a
// unique id; shop.js remembers which ids were already paid).
function creditFromState(st) {
  if (!S.me) return;
  let gained = 0;
  let parts = [];
  let total = 0;
  if (st.phase === 'results' && st.results) {
    const row = st.results.rows.find((r) => r.id === S.me);
    if (!row) return;
    total = row.coins || 0;
    parts = row.coinParts || [];
    gained = credit(S.wallet, total, `${st.results.matchId}:r${st.results.round}`);
    showEarned('results-coins', total, parts);
  } else if (st.phase === 'final' && st.final) {
    const e = st.final.standings.find((x) => x.id === S.me);
    if (!e) return;
    total = e.bonus || 0;
    parts = [e.place === 1 ? 'match win' : 'finished the match'];
    gained = credit(S.wallet, total, `${st.final.matchId}:final`);
    showEarned('final-coins', total, parts);
  } else {
    return;
  }
  if (gained > 0) {
    saveWalletNow();
    refreshPickers();
    sfx.coin();
    afterUnlocks(recordCoins(S.trophies, gained));
  }
}

// =============================================================== achievements
// Called with whatever a record*() function just unlocked. Hands out the special
// hats/skins, saves, and shows the pop-ups.
function afterUnlocks(fresh) {
  const rewards = applyRewards(S.trophies, S.wallet);
  const more = rewards.length ? recordOwned(S.trophies, S.wallet) : [];
  const all = [...fresh, ...more];
  saveTrophiesNow();
  if (rewards.length || all.length) {
    saveWalletNow();
    refreshPickers();
    if (SHOP.open) renderShop();
    if (TRO.open) renderTrophies();
  }
  for (const a of all) showUnlock(a);
}

function showUnlock(a) {
  const box = $('unlocks');
  const t = el('div', 'unlock-toast');
  t.appendChild(el('div', 'ic', a.icon));
  const txt = el('div');
  txt.appendChild(el('div', 'tt', 'Achievement unlocked!'));
  txt.appendChild(el('div', 'nm', a.name));
  if (a.reward) txt.appendChild(el('div', 'rd', `New ${a.reward.kind}: ${itemName(a.reward.kind, a.reward.index)}!`));
  t.appendChild(txt);
  box.appendChild(t);
  while (box.children.length > 4) box.firstChild.remove();
  sfx.jackpot();
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 450);
  }, a.reward ? 6500 : 4500);
}

// Counts this round / match / pit stop for the trophy case (each is counted once).
function trackAchievements(st) {
  if (!S.me) return;
  let fresh = [];
  if (st.phase === 'results' && st.results) {
    const row = st.results.rows.find((r) => r.id === S.me);
    fresh = recordRound(S.trophies, st.results, row);
  } else if (st.phase === 'final' && st.final) {
    const e = st.final.standings.find((x) => x.id === S.me);
    if (e) fresh = recordFinal(S.trophies, st.final, e.place);
  } else if (st.phase === 'intro') {
    const me = myRoomPlayer();
    if (me) fresh = recordPowerRound(S.trophies, st.matchId, st.round, me.power.length);
  } else {
    return;
  }
  afterUnlocks(fresh);
}

const TRO = { open: false };

function openTrophies() {
  TRO.open = true;
  document.body.classList.add('modal-open');
  $('overlay-trophies').classList.remove('hidden');
  renderTrophies();
  sfx.click();
}

function closeTrophies() {
  TRO.open = false;
  document.body.classList.remove('modal-open');
  $('overlay-trophies').classList.add('hidden');
}

function renderTrophies() {
  $('trophy-total').textContent = `${unlockedCount(S.trophies)}/${ACHIEVEMENTS.length}`;
  const grid = $('trophy-grid');
  grid.textContent = '';
  for (const a of ACHIEVEMENTS) {
    const pr = progressOf(S.trophies, a);
    const card = el('div', 'trophy-card' + (pr.done ? ' done' : ''));
    card.appendChild(el('div', 'ic', a.icon));
    card.appendChild(el('div', 'nm', a.name));
    card.appendChild(el('div', 'ds', a.desc));
    if (pr.done) card.appendChild(el('div', 'pg', 'Unlocked \u2713'));
    else if (a.goal === 1) card.appendChild(el('div', 'pg', 'Not yet'));
    else {
      const wrap = el('div', 'pw');
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.round((pr.value / pr.goal) * 100)}%`;
      bar.appendChild(fill);
      wrap.appendChild(bar);
      wrap.appendChild(el('div', 'pg', `${pr.value} / ${pr.goal}`));
      card.appendChild(wrap);
    }
    if (a.reward) {
      const rw = el('div', 'rw');
      const cv = el('canvas');
      cv.width = 64;
      cv.height = 80;
      rw.appendChild(cv);
      drawPreview(cv, { ...S.look, [a.reward.kind]: a.reward.index }, 0);
      rw.appendChild(document.createTextNode(itemName(a.reward.kind, a.reward.index)));
      card.appendChild(rw);
    }
    grid.appendChild(card);
  }
}

function showPurseNote(st) {
  const box = $('results-purse');
  const me = myRoomPlayer();
  const show = st.phase === 'results' && me && st.powerups && st.powerups.length > 0 && st.round < st.rounds;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  box.textContent = '';
  box.appendChild(el('span', 'coin blue'));
  box.appendChild(document.createTextNode(` Pit-stop purse: ${me.purse}`));
  box.appendChild(el('small', null, '(power-ups for the next round, this match only)'));
}

function showEarned(id, total, parts) {
  const box = $(id);
  box.classList.toggle('hidden', total <= 0);
  if (total <= 0) return;
  box.textContent = '';
  const c = el('span', 'coin');
  box.appendChild(c);
  box.appendChild(document.createTextNode(` +${total} coins`));
  if (parts.length) box.appendChild(el('small', null, `(${parts.join(', ')})`));
}

const SHOP = { kind: 'hat', sel: { hat: 0, skin: 0, back: 0, color: 0 }, open: false };

function shopLook() {
  return { ...S.look, [SHOP.kind]: SHOP.sel[SHOP.kind] };
}

function openShop(kind, index) {
  SHOP.open = true;
  document.body.classList.add('modal-open');
  SHOP.kind = KINDS.includes(kind) ? kind : SHOP.kind;
  for (const k of KINDS) SHOP.sel[k] = S.look[k];
  if (KINDS.includes(kind) && Number.isInteger(index)) SHOP.sel[kind] = index;
  $('overlay-shop').classList.remove('hidden');
  $('shop-msg').textContent = '';
  afterUnlocks([]); // hands over any earned trophy rewards you are somehow missing
  renderShop();
  sfx.click();
}

function closeShop() {
  SHOP.open = false;
  document.body.classList.remove('modal-open');
  $('overlay-shop').classList.add('hidden');
}

function wearing(kind, index) {
  return S.look[kind] === index;
}

function renderShop() {
  $('shop-coins').textContent = String(S.wallet.coins);

  const tabs = $('shop-tabs');
  tabs.textContent = '';
  for (const k of KINDS) {
    const b = el('button', 'shop-tab' + (k === SHOP.kind ? ' on' : ''), KIND_LABEL[k]);
    b.type = 'button';
    const have = S.wallet.owned[k].length;
    b.appendChild(el('small', null, `${have}/${catalogue(k).length}`));
    b.addEventListener('click', () => {
      SHOP.kind = k;
      $('shop-msg').textContent = '';
      renderShop();
    });
    tabs.appendChild(b);
  }

  const grid = $('shop-grid');
  grid.textContent = '';
  for (const item of catalogue(SHOP.kind)) {
    const owned = owns(S.wallet, item.kind, item.index);
    const card = el('button', 'shop-card');
    card.type = 'button';
    if (!owned) card.classList.add('locked');
    if (owned && wearing(item.kind, item.index)) card.classList.add('worn');
    if (SHOP.sel[item.kind] === item.index) card.classList.add('sel');
    if (item.kind === 'color') {
      const dot = el('div', 'dot');
      dot.style.background = COLORS[item.index].hex;
      card.appendChild(dot);
    } else {
      const cv = el('canvas');
      cv.width = 64;
      cv.height = 80;
      card.appendChild(cv);
      drawPreview(cv, { ...S.look, [item.kind]: item.index }, 0);
    }
    card.appendChild(el('div', 'nm', item.name));
    const lockedByAch = !owned && isUnlockOnly(item.kind, item.index);
    const lockedByPack = !owned && isPackOnly(item.kind, item.index);
    const rar = rarityOfItem(item.kind, item.index);
    if (rar >= 0) card.style.setProperty('--rar', RARITY_COLOR[rar]);
    if (rar >= 0) card.classList.add('rar');
    const tag = el('div', 'tag' + (lockedByAch ? ' ach' : lockedByPack ? ' pk' : ''), owned ? (wearing(item.kind, item.index) ? 'Wearing' : 'Owned') : lockedByAch ? (S.trophies.unlocked[(achievementFor(item.kind, item.index) || {}).id] ? 'Claim!' : 'Trophy') : lockedByPack ? 'Pack' : String(item.price));
    card.appendChild(tag);
    card.addEventListener('click', () => {
      SHOP.sel[item.kind] = item.index;
      $('shop-msg').textContent = '';
      renderShop();
    });
    grid.appendChild(card);
  }

  const kind = SHOP.kind;
  const idx = SHOP.sel[kind];
  const owned = owns(S.wallet, kind, idx);
  const price = priceOf(kind, idx);
  $('shop-item').textContent = '';
  $('shop-item').appendChild(el('small', null, KIND_LABEL[kind].replace(/s$/, '')));
  $('shop-item').appendChild(document.createTextNode(itemName(kind, idx)));
  const act = $('shop-action');
  act.classList.remove('need');
  if (owned && wearing(kind, idx)) {
    act.textContent = 'Wearing it!';
    act.disabled = true;
  } else if (owned) {
    act.textContent = 'Wear it';
    act.disabled = false;
  } else if (isUnlockOnly(kind, idx)) {
    const a = achievementFor(kind, idx);
    const earned = !!(a && S.trophies.unlocked[a.id]);
    if (earned) {
      // The trophy is yours: one tap to claim the reward.
      act.textContent = '\u{1F3C6} Claim your reward!';
      act.disabled = false;
    } else {
      act.textContent = '\u{1F512} Locked - earn the trophy first';
      act.disabled = true;
      act.classList.add('need');
    }
    if (a) {
      const hint = el('div', 'shop-hint');
      hint.appendChild(el('b', null, `${a.icon} ${a.name}: `));
      hint.appendChild(document.createTextNode(a.desc));
      if (!earned) {
        const pr = progressOf(S.trophies, a);
        if (pr.goal > 1) hint.appendChild(document.createTextNode(` (${pr.value} / ${pr.goal})`));
      }
      $('shop-item').appendChild(hint);
    }
  } else if (isPackOnly(kind, idx)) {
    const r = rarityOfItem(kind, idx);
    act.textContent = '\u{1F381} Find it in Packs';
    act.disabled = false;
    const hint = el('div', 'shop-hint');
    hint.appendChild(el('b', null, `${r >= 0 ? RARITY_LABEL[r] : 'Pack'} item: `));
    hint.appendChild(document.createTextNode('only comes out of packs. Open one for a chance at it!'));
    $('shop-item').appendChild(hint);
  } else if (S.wallet.coins >= price) {
    act.textContent = `Buy for ${price} coins`;
    act.disabled = false;
  } else {
    act.textContent = `Need ${price - S.wallet.coins} more coins`;
    act.disabled = true;
    act.classList.add('need');
  }
}

function shopAction() {
  const kind = SHOP.kind;
  const idx = SHOP.sel[kind];
  const msg = $('shop-msg');
  msg.classList.remove('good');
  if (!owns(S.wallet, kind, idx) && isUnlockOnly(kind, idx)) {
    // Trophy item: hand it over if the achievement is really unlocked.
    const given = applyRewards(S.trophies, S.wallet);
    if (!owns(S.wallet, kind, idx)) {
      msg.textContent = 'Earn the trophy first - see the hint above.';
      renderShop();
      return;
    }
    saveWalletNow();
    sfx.jackpot();
    afterUnlocks(recordOwned(S.trophies, S.wallet));
    msg.textContent = given.length ? 'Reward claimed! Now wearing it.' : 'Now wearing it.';
    msg.classList.add('good');
  } else if (!owns(S.wallet, kind, idx) && isPackOnly(kind, idx)) {
    closeShop();
    openPacks();
    return;
  } else if (!owns(S.wallet, kind, idx)) {
    const res = buy(S.wallet, kind, idx);
    if (!res.ok) {
      msg.textContent = res.error;
      renderShop();
      return;
    }
    saveWalletNow();
    sfx.jackpot();
    afterUnlocks(recordOwned(S.trophies, S.wallet));
    msg.textContent = 'Bought! Now wearing it.';
    msg.classList.add('good');
    const chip = document.querySelector('.wallet-chip');
    chip.classList.remove('bump');
    void chip.offsetWidth;
    chip.classList.add('bump');
  }
  S.look[kind] = idx;
  lookChanged();
  renderShop();
}


// =============================================================== packs
const PK = { open: false, reveal: null, lastPack: null };

function openPacks() {
  PK.open = true;
  document.body.classList.add('modal-open');
  $('overlay-packs').classList.remove('hidden');
  renderPacks();
  sfx.click();
}

function closePacks() {
  PK.open = false;
  document.body.classList.remove('modal-open');
  $('overlay-packs').classList.add('hidden');
}

function pct(n) {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function renderPacks() {
  $('packs-coins').textContent = String(S.wallet.coins);
  const list = $('pack-list');
  list.textContent = '';
  PACKS.forEach((pack, i) => {
    const card = el('div', 'pack-card');
    card.style.setProperty('--tier', RARITY_COLOR[Math.min(4, i + 1)]);
    card.appendChild(el('div', 'pack-icon', pack.icon));
    card.appendChild(el('div', 'pack-name', pack.name));
    card.appendChild(el('div', 'pack-meta', `${pack.cards} cards`));
    const odds = el('div', 'pack-odds');
    oddsOf(pack).forEach((o, r) => {
      if (o <= 0) return;
      const chip = el('span', 'odds-chip', `${RARITY_LABEL[r]} ${pct(o)}%`);
      chip.style.setProperty('--rar', RARITY_COLOR[r]);
      odds.appendChild(chip);
    });
    card.appendChild(odds);
    card.appendChild(el('div', 'pack-guar', pack.min > 0 ? `At least 1 ${RARITY_LABEL[pack.min]} or better` : 'Chance for rare finds'));
    const btn = el('button', 'btn small', `Open for ${pack.price}`);
    btn.type = 'button';
    const need = pack.price - S.wallet.coins;
    if (need > 0) {
      btn.textContent = `Need ${need} more coins`;
      btn.disabled = true;
    }
    btn.addEventListener('click', () => startReveal(pack.id));
    card.appendChild(btn);
    list.appendChild(card);
  });

  // what each rarity means (and how often it comes out of a Classic Pack)
  const guide = $('rarity-guide');
  guide.textContent = '';
  guide.appendChild(el('div', 'rg-title', 'Rarity guide'));
  const classic = oddsOf(getPack('classic'));
  RARITY_LABEL.forEach((name, r) => {
    const row = el('div', 'rg-row');
    row.style.setProperty('--rar', RARITY_COLOR[r]);
    row.appendChild(el('span', 'rg-name', name));
    row.appendChild(el('span', 'rg-pct', `${pct(classic[r])}%`));
    row.appendChild(el('span', 'rg-desc', RARITY_BLURB[r]));
    guide.appendChild(row);
  });
  guide.appendChild(el('div', 'rg-note', 'Percentages are the chance for ONE card in a Classic Pack. Every pack shows its own odds above.'));

  const left = Math.max(0, PITY_LIMIT - (S.wallet.pity || 0));
  $('pack-pity').textContent = (S.wallet.pity || 0) >= PITY_LIMIT
    ? 'Lucky streak protection: your next pack is guaranteed to have an Epic or better card!'
    : `Lucky streak protection: if ${left} more pack${left === 1 ? '' : 's'} bring no Epic or better, the next one is guaranteed to have one. Packs opened so far: ${S.wallet.packs || 0}.`;

  const grid = $('outfit-grid');
  grid.textContent = '';
  let complete = 0;
  for (const outfit of OUTFITS) {
    const prog = outfitProgress(S.wallet, outfit);
    if (prog.complete) complete++;
    const card = el('button', 'shop-card rar' + (prog.complete ? '' : ' locked'));
    card.type = 'button';
    card.style.setProperty('--rar', RARITY_COLOR[outfit.rarity]);
    const cv = el('canvas');
    cv.width = 64;
    cv.height = 80;
    card.appendChild(cv);
    drawPreview(cv, { ...S.look, skin: outfit.skin, back: outfit.back, hat: outfit.hat }, 0);
    card.appendChild(el('div', 'nm', outfit.name));
    card.appendChild(el('div', 'tag' + (prog.complete ? '' : ' pk'), prog.complete ? 'Wear' : `${prog.have}/3 pieces`));
    card.addEventListener('click', () => {
      if (!prog.complete) {
        $('pack-pity').textContent = `${outfit.name}: collect all 3 pieces (skin, back item and hat) - you have ${prog.have}. Packs can drop the pieces one by one, or the whole outfit at once.`;
        return;
      }
      const look = wearOutfit(S.wallet, S.look, outfit);
      if (look) {
        S.look = { ...S.look, skin: look.skin, back: look.back, hat: look.hat };
        lookChanged();
        sfx.jackpot();
        $('pack-pity').textContent = `Now wearing ${outfit.name}!`;
      }
    });
    grid.appendChild(card);
  }
  $('outfit-count').textContent = `${complete}/${OUTFITS.length} complete`;
}

function cardPreviewLook(c) {
  if (c.type === 'outfit') return { ...S.look, skin: c.outfit.skin, back: c.outfit.back, hat: c.outfit.hat };
  return { ...S.look, [c.kind]: c.index };
}

function cardTitle(c) {
  return c.type === 'outfit' ? c.outfit.name : itemName(c.kind, c.index);
}

function cardKindLabel(c) {
  return c.type === 'outfit' ? 'Outfit' : KIND_LABEL[c.kind].replace(/s$/, '');
}

function startReveal(packId) {
  const res = openPack(S.wallet, packId);
  if (!res.ok) {
    $('pack-pity').textContent = res.error;
    renderPacks();
    return;
  }
  saveWalletNow();
  afterUnlocks(recordOwned(S.trophies, S.wallet));
  PK.lastPack = packId;
  PK.reveal = { res, flipped: res.cards.map(() => false), rolling: 0 };
  $('overlay-reveal').classList.remove('hidden');
  $('reveal-title').textContent = res.pack.name;
  $('reveal-hint').textContent = 'Click a card to flip it! The best one is last.';
  $('reveal-summary').textContent = '';
  $('reveal-again').classList.add('hidden');
  $('reveal-all').classList.remove('hidden');
  const wrap = $('reveal-cards');
  wrap.textContent = '';
  res.cards.forEach((c, i) => {
    const card = el('button', 'rv-card');
    card.type = 'button';
    card.style.setProperty('--rar', RARITY_COLOR[c.rarity]);
    const inner = el('div', 'rv-inner');
    const back = el('div', 'rv-face rv-back', '?');
    const front = el('div', 'rv-face rv-front');
    const rarEl = el('div', 'rv-rarity', RARITY_LABEL[c.rarity]);
    front.appendChild(rarEl);
    const cv = el('canvas');
    cv.width = 96;
    cv.height = 120;
    front.appendChild(cv);
    front.appendChild(el('div', 'rv-kind', cardKindLabel(c)));
    const nameEl = el('div', 'rv-name', cardTitle(c));
    front.appendChild(nameEl);
    const newEl = el('div', 'rv-new' + (c.isNew ? '' : ' dupe'), c.isNew
      ? (c.type === 'outfit' && c.newPieces.length < 3 ? `NEW! ${c.newPieces.length} new piece${c.newPieces.length === 1 ? '' : 's'}` : 'NEW!')
      : `Duplicate +${c.refund} coins`);
    front.appendChild(newEl);
    card._parts = { rarEl, nameEl, newEl };
    inner.appendChild(back);
    inner.appendChild(front);
    card.appendChild(inner);
    card.addEventListener('click', () => flipCard(i, card, cv, c));
    wrap.appendChild(card);
    card._draw = () => drawPreview(cv, cardPreviewLook(c), 0);
  });
  sfx.click();
}

// Outfit cards "roll" like a slot machine: the card flips over, then the picture, name and rarity colour flick
// through random outfits, slow down, and land on the one you really got. The result was decided before the roll
// starts (openPack already ran), so this is only a show - skipping or closing it never changes what you won.
const ROLL_STEPS = 13;
function rollOutfit(R, card, c, done) {
  const { rarEl, nameEl, newEl } = card._parts;
  const cv = card.querySelector('canvas');
  card.classList.add('rolling');
  newEl.style.visibility = 'hidden';
  let step = 0;
  const quiet = R.rolling > 1; // lots of cards rolling at once (Flip all): only the clicks of one are worth hearing
  const tick = () => {
    if (PK.reveal !== R) return; // the window was closed
    if (step >= ROLL_STEPS) {
      rarEl.textContent = RARITY_LABEL[c.rarity];
      card.style.setProperty('--rar', RARITY_COLOR[c.rarity]);
      nameEl.textContent = cardTitle(c);
      card._draw();
      newEl.style.visibility = '';
      card.classList.remove('rolling');
      card.classList.add('landed');
      done();
      return;
    }
    let o;
    do o = OUTFITS[Math.floor(Math.random() * OUTFITS.length)]; while (o === c.outfit && OUTFITS.length > 1);
    drawPreview(cv, { ...S.look, skin: o.skin, back: o.back, hat: o.hat }, step * 0.1);
    nameEl.textContent = o.name;
    rarEl.textContent = RARITY_LABEL[o.rarity];
    card.style.setProperty('--rar', RARITY_COLOR[o.rarity]);
    if (!quiet || card === R.firstRoller) sfx.click();
    step++;
    setTimeout(tick, 55 * Math.pow(1.19, step));
  };
  tick();
}

function flipCard(i, card, cv, c) {
  const R = PK.reveal;
  if (!R || R.flipped[i]) return;
  R.flipped[i] = true;
  card.classList.add('flipped');
  const land = () => {
    if (c.rarity >= 3) {
      card.classList.add('shine');
      sfx.jackpot();
    } else if (c.isNew) sfx.coin(0.8);
    else sfx.click();
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (c.type === 'outfit' && !reduced) {
    R.rolling++;
    if (!R.firstRoller) R.firstRoller = card;
    // draw something right away so the card is not blank while it turns over
    card._draw();
    setTimeout(() => {
      if (PK.reveal !== R) return;
      rollOutfit(R, card, c, () => {
        R.rolling--;
        land();
        if (R.flipped.every(Boolean) && R.rolling === 0) finishReveal();
      });
    }, 350); // let the flip finish first
    return;
  }
  card._draw();
  land();
  if (R.flipped.every(Boolean) && R.rolling === 0) finishReveal();
}

function finishReveal() {
  const R = PK.reveal;
  if (!R) return;
  const { res } = R;
  const fresh = res.cards.filter((c) => c.isNew).length;
  const parts = [`${fresh} new`];
  if (res.refund > 0) parts.push(`+${res.refund} coins back for duplicates`);
  $('reveal-summary').textContent = parts.join(' - ');
  $('reveal-hint').textContent = res.pityUsed ? 'Lucky streak protection kicked in!' : 'All flipped!';
  $('reveal-all').classList.add('hidden');
  const again = $('reveal-again');
  again.classList.remove('hidden');
  const pack = res.pack;
  if (S.wallet.coins >= pack.price) {
    again.textContent = `Open another (${pack.price})`;
    again.disabled = false;
  } else {
    again.textContent = `Need ${pack.price - S.wallet.coins} more coins`;
    again.disabled = true;
  }
}

function closeReveal() {
  // Cards you have not flipped are already yours; just show them all before leaving.
  PK.reveal = null;
  $('overlay-reveal').classList.add('hidden');
  if (PK.open) renderPacks();
}

function flipAll() {
  const cards = $('reveal-cards').children;
  const R = PK.reveal;
  if (!R) return;
  Array.from(cards).forEach((card, i) => flipCard(i, card, null, R.res.cards[i]));
}


// =============================================================== trading
// The server (server/trade.js) runs the trade window; this is the screen for it. Your coins and items are in
// YOUR browser, so when a trade is finished each browser moves its own side (shop.js applyTrade).
const TR = { view: null, open: false, tab: 'hat', picking: false, offerTimer: 0 };

function openTradeWindow() {
  if (!TR.open) {
    // only one big window at a time
    if (SHOP.open) closeShop();
    if (PK.open) closePacks();
    if (TRO.open) closeTrophies();
    TR.open = true;
    TR.picking = false;
    document.body.classList.add('modal-open');
    $('overlay-trade').classList.remove('hidden');
  }
}

function closeTradeWindow() {
  TR.open = false;
  TR.view = null;
  TR.picking = false;
  clearTimeout(TR.offerTimer);
  document.body.classList.remove('modal-open');
  $('overlay-trade').classList.add('hidden');
  $('trade-invite').classList.add('hidden');
}

async function startTrade(pid) {
  const res = await request('trade:request', { to: pid });
  if (!res.ok) toast(res.error || 'Could not start a trade.');
  else sfx.click();
}

function tradeSides() {
  const v = TR.view;
  return {
    give: { coins: v.mine.coins, items: v.mine.items },
    get: { coins: v.theirs.coins, items: v.theirs.items },
  };
}

function sendOffer(coins, items) {
  if (!TR.view) return;
  clearTimeout(TR.offerTimer); // this offer already carries the coins, so the delayed "coins changed" one is not needed
  socket.emit('trade:offer', { id: TR.view.id, coins, items });
}

// The coins number as typed right now. (Someone can type 200 and straight away click an item; the server has not
// heard about the 200 yet, so adding an item must send what is in the box, not the older number.)
function typedCoins() {
  const raw = Math.floor(Number($('trade-my-coins').value));
  if (!Number.isFinite(raw)) return TR.view ? TR.view.mine.coins : 0;
  return Math.max(0, Math.min(TRADE_MAX_COINS, raw));
}

function tradeChip(item, removable) {
  const chip = el('div', 'trade-chip');
  const rar = rarityOfItem(item.kind, item.index);
  if (rar >= 0) chip.style.setProperty('--rar', RARITY_COLOR[rar]);
  const cv = el('canvas');
  cv.width = 48;
  cv.height = 60;
  chip.appendChild(cv);
  if (item.kind === 'color') {
    const ctx = cv.getContext('2d');
    ctx.fillStyle = COLORS[item.index].hex;
    ctx.beginPath();
    ctx.arc(24, 30, 18, 0, Math.PI * 2);
    ctx.fill();
  } else drawPreview(cv, { ...S.look, [item.kind]: item.index }, 0);
  chip.appendChild(el('div', 'nm', itemName(item.kind, item.index)));
  if (removable) {
    const x = el('button', 'x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove');
    x.addEventListener('click', () => {
      const v = TR.view;
      sendOffer(typedCoins(), v.mine.items.filter((i) => !(i.kind === item.kind && i.index === item.index)));
    });
    chip.appendChild(x);
  }
  return chip;
}

function renderTrade() {
  const v = TR.view;
  if (!v || !TR.open) return;
  $('trade-coins').textContent = String(S.wallet.coins);
  $('trade-title').textContent = `Trade with ${v.with.name}`;
  $('trade-their-title').textContent = `${v.with.name} gives`;
  const open = v.state === 'open';
  const status = $('trade-status');
  if (v.state === 'invite') status.textContent = `Waiting for ${v.with.name} to say yes...`;
  else if (v.state === 'confirming') status.textContent = 'Both accepted! Checking that everything is in place...';
  else status.textContent = 'Put coins or items in. When you are both happy, both press Accept. Changing anything cancels both Accepts.';

  // my side
  const coinInput = $('trade-my-coins');
  if (document.activeElement !== coinInput) coinInput.value = String(v.mine.coins);
  coinInput.disabled = !open;
  const mine = $('trade-my-items');
  mine.textContent = '';
  for (const it of v.mine.items) mine.appendChild(tradeChip(it, open));
  if (!v.mine.items.length) mine.appendChild(el('div', 'trade-empty', 'No items yet'));
  $('trade-add').disabled = !open || v.mine.items.length >= TRADE_MAX_ITEMS;
  $('trade-my-state').textContent = v.mine.accepted ? '✅ You accepted' : '';

  // their side
  $('trade-their-coins').textContent = `Coins: ${v.theirs.coins}`;
  const theirs = $('trade-their-items');
  theirs.textContent = '';
  for (const it of v.theirs.items) {
    const chip = tradeChip(it, false);
    if (owns(S.wallet, it.kind, it.index)) chip.classList.add('dupe');
    theirs.appendChild(chip);
  }
  if (!v.theirs.items.length) theirs.appendChild(el('div', 'trade-empty', 'No items yet'));
  $('trade-their-state').textContent = v.theirs.accepted ? `✅ ${v.with.name} accepted` : '';

  // can I accept?
  const { give, get } = tradeSides();
  const empty = give.coins === 0 && get.coins === 0 && !give.items.length && !get.items.length;
  const err = checkTrade(S.wallet, give, get);
  const note = $('trade-note');
  note.textContent = open && err ? err + (err.startsWith('You already own') ? ' Ask them to take it out.' : '') : '';
  const accept = $('trade-accept');
  accept.disabled = !open || empty || !!err || v.mine.accepted;
  accept.textContent = v.mine.accepted ? 'Waiting for them...' : empty ? 'Put something in first' : 'Accept trade';

  renderTradePicker();
}

function renderTradePicker() {
  const v = TR.view;
  const box = $('trade-picker');
  box.classList.toggle('hidden', !(TR.picking && v && v.state === 'open'));
  if (box.classList.contains('hidden')) return;
  const tabs = $('trade-tabs');
  tabs.textContent = '';
  const chosen = new Set(v.mine.items.map((i) => `${i.kind}:${i.index}`));
  for (const k of KINDS) {
    const list = catalogue(k).filter((it) => owns(S.wallet, k, it.index) && isTradable(k, it.index));
    const b = el('button', 'shop-tab' + (k === TR.tab ? ' on' : ''), KIND_LABEL[k]);
    b.type = 'button';
    b.appendChild(el('small', null, String(list.length)));
    b.addEventListener('click', () => {
      TR.tab = k;
      renderTradePicker();
    });
    tabs.appendChild(b);
  }
  const grid = $('trade-grid');
  grid.textContent = '';
  const mineList = catalogue(TR.tab).filter((it) => owns(S.wallet, TR.tab, it.index) && isTradable(TR.tab, it.index));
  if (!mineList.length) grid.appendChild(el('div', 'trade-empty', 'Nothing here can be traded. (Free starter items and trophy items cannot be traded.)'));
  for (const it of mineList) {
    const card = el('button', 'shop-card rar');
    card.type = 'button';
    const rar = rarityOfItem(it.kind, it.index);
    if (rar >= 0) card.style.setProperty('--rar', RARITY_COLOR[rar]);
    if (chosen.has(`${it.kind}:${it.index}`)) card.classList.add('sel');
    if (S.look[it.kind] === it.index) card.appendChild(el('div', 'worn-tag', 'wearing'));
    if (it.kind === 'color') {
      const dot = el('div', 'dot');
      dot.style.background = COLORS[it.index].hex;
      card.appendChild(dot);
    } else {
      const cv = el('canvas');
      cv.width = 64;
      cv.height = 80;
      card.appendChild(cv);
      drawPreview(cv, { ...S.look, [it.kind]: it.index }, 0);
    }
    card.appendChild(el('div', 'nm', it.name));
    card.addEventListener('click', () => {
      const cur = TR.view.mine.items;
      const has = cur.some((i) => i.kind === it.kind && i.index === it.index);
      if (!has && cur.length >= TRADE_MAX_ITEMS) return;
      const next = has ? cur.filter((i) => !(i.kind === it.kind && i.index === it.index)) : [...cur, { kind: it.kind, index: it.index }];
      sendOffer(typedCoins(), next);
    });
    grid.appendChild(card);
  }
}

socket.on('trade:state', (view) => {
  if (!S.room) return;
  TR.view = view;
  if (view.state === 'invite' && !view.initiator) {
    $('trade-invite-text').textContent = `${view.with.name} wants to trade with you.`;
    $('trade-invite').classList.remove('hidden');
    sfx.coin(0.6);
    return;
  }
  $('trade-invite').classList.add('hidden');
  openTradeWindow();
  renderTrade();
});

socket.on('trade:closed', (info) => {
  const wasOpen = TR.open || !$('trade-invite').classList.contains('hidden');
  closeTradeWindow();
  if (wasOpen && info && info.reason) toast(info.reason);
});

// Both people pressed Accept: double-check that I can really do it, and say so.
socket.on('trade:confirm', ({ id, rev }) => {
  const v = TR.view;
  let ok = false;
  if (v && v.id === id && v.rev === rev) {
    const { give, get } = tradeSides();
    ok = !checkTrade(S.wallet, give, get);
  }
  socket.emit('trade:commit', { id, rev, ok });
});

// The trade is final: move my coins and items.
socket.on('trade:done', (p) => {
  const res = applyTrade(S.wallet, p.id, p.give, p.get);
  socket.emit('trade:ack', { id: p.id });
  if (!res.ok) {
    closeTradeWindow();
    toast(`The trade could not be finished: ${res.error}`);
    return;
  }
  if (res.repeat) return;
  saveWalletNow();
  S.look = { ...S.look, ...sanitizeLook(S.wallet, S.look) }; // took off anything you just traded away
  lookChanged();
  refreshPickers();
  closeTradeWindow();
  sfx.jackpot();
  const bits = [];
  if (p.get.coins) bits.push(`${p.get.coins} coins`);
  for (const it of p.get.items) bits.push(itemName(it.kind, it.index));
  toast(bits.length ? `Trade done! You got ${bits.join(', ')}.` : 'Trade done!');
  afterUnlocks(recordOwned(S.trophies, S.wallet));
});

// =============================================================== room state
function applyRoomState(st) {
  const prev = S.room;
  S.room = st;
  syncRoomExtras();
  if (!prev) loadChatHistory();
  S.phaseEndsAt = performance.now() + st.endsInMs;
  for (const p of st.players) S.meta.set(p.id, { name: p.name, color: p.color, hat: p.hat, skin: p.skin, back: p.back });

  // If the server says we are not in this room any more, go back to the title.
  if (S.me && !st.players.some((p) => p.id === S.me)) {
    leaveToTitle('You are no longer in that room.');
    return;
  }

  const changed = !prev || prev.phase !== st.phase || prev.round !== st.round;
  if (changed) onPhaseEnter(prev, st);

  if (st.phase === 'lobby') renderLobby(st);
  $('overlay-intro').classList.toggle('hidden', st.phase !== 'intro');
  $('overlay-pitstop').classList.toggle('hidden', st.phase !== 'pitstop');
  $('overlay-results').classList.toggle('hidden', st.phase !== 'results');
  $('overlay-final').classList.toggle('hidden', st.phase !== 'final');
  $('hud').classList.toggle('hidden', st.phase !== 'playing' && st.phase !== 'results');
  if (st.phase === 'intro') renderIntro(st);
  if (st.phase === 'pitstop') renderPitstop(st);
  if (st.phase === 'results') renderResults(st);
  if (st.phase === 'final') renderFinal(st);
  creditFromState(st);
  trackAchievements(st);
  showPurseNote(st);
  if (st.phase !== 'playing') music.setScene(sceneFor({ phase: st.phase }));
  if (st.phase !== 'results') {
    $('results-coins').classList.add('hidden');
    $('results-purse').classList.add('hidden');
  }
  if (st.phase !== 'final') $('final-coins').classList.add('hidden');
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
      predictor.clear();
      showView('lobby');
      break;
    case 'intro':
      renderer.reset();
      S.snaps = [];
      predictor.clear();
      S.theme = (st.intro && st.intro.theme) || 'sunny';
      showView('stage');
      sfx.click();
      break;
    case 'pitstop':
      renderer.reset();
      S.snaps = [];
      predictor.clear();
      pitMsg('');
      showView('stage');
      sfx.click();
      break;
    case 'playing': {
      renderer.reset();
      S.snaps = [];
      predictor.clear();
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

// =============================================================== text chat (between rounds)
function chatClearUnread() {
  S.chatUnread = 0;
  $('chat-unread').classList.add('hidden');
}

function renderChat() {
  const log = $('chat-log');
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.textContent = '';
  if (S.chat.length === 0) log.appendChild(el('div', 'empty', 'No messages yet. Say hi!'));
  for (const m of S.chat) {
    const row = el('div', 'msg' + (m.id === S.me ? ' me' : ''));
    const meta = S.meta.get(m.id);
    const who = el('b', null, m.name);
    who.style.color = meta && COLORS[meta.color] ? COLORS[meta.color].hex : '#2a1a3c';
    row.appendChild(who);
    row.appendChild(document.createTextNode(m.text)); // text node: a message can never become HTML
    log.appendChild(row);
  }
  if (stick) log.scrollTop = log.scrollHeight;
  const on = S.chatOn;
  $('chat-input').disabled = !on;
  $('chat-note').textContent = on ? '' : 'Chat is switched off on this server right now.';
}

async function loadChatHistory() {
  const res = await request('chat:history');
  if (res && res.ok) {
    S.chat = res.messages.slice(-40);
    S.chatOn = res.enabled !== false;
    renderChat();
  }
}

function setupChat() {
  $('chat-toggle').addEventListener('click', () => {
    const closed = $('chat').classList.toggle('closed');
    $('chat-toggle').setAttribute('aria-expanded', String(!closed));
    if (!closed) {
      chatClearUnread();
      const log = $('chat-log');
      log.scrollTop = log.scrollHeight;
    }
  });
  $('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text) return;
    const res = await request('chat:send', { text });
    if (res && res.ok) {
      input.value = '';
      $('chat-note').textContent = '';
      afterUnlocks(recordSocial(S.trophies, 'chat'));
    } else {
      $('chat-note').textContent = (res && res.error) || 'Could not send.';
    }
  });
}

socket.on('chat:msg', (m) => {
  if (!m || typeof m.text !== 'string' || typeof m.name !== 'string') return;
  S.chat.push({ n: m.n, id: m.id, name: m.name, text: m.text });
  if (S.chat.length > 60) S.chat.shift();
  renderChat();
  if (m.id !== S.me && $('chat').classList.contains('closed')) {
    S.chatUnread += 1;
    const b = $('chat-unread');
    b.textContent = String(Math.min(S.chatUnread, 99));
    b.classList.remove('hidden');
  }
});
socket.on('chat:enabled', (m) => {
  S.chatOn = !m || m.enabled !== false;
  renderChat();
});

// =============================================================== emoji bubbles
let lastEmoteSent = 0;
function sendEmote(i) {
  if (!S.room || !(i >= 0 && i < EMOTES.length)) return;
  const now = performance.now();
  if (now - lastEmoteSent < 600) return; // the server also limits this
  lastEmoteSent = now;
  socket.emit('chat:emoji', i);
  afterUnlocks(recordSocial(S.trophies, 'emoji', i));
}

function setupEmotes() {
  const pop = $('emote-pop');
  EMOTES.forEach((emoji, i) => {
    const b = el('button', null, emoji);
    b.type = 'button';
    b.title = `Send ${emoji} (key ${i + 1})`;
    b.appendChild(el('small', null, String(i + 1)));
    b.addEventListener('click', () => {
      sendEmote(i);
      pop.classList.add('hidden');
    });
    pop.appendChild(b);
  });
  $('emote-btn').addEventListener('click', () => {
    sfx.click();
    pop.classList.toggle('hidden');
  });
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const m = /^Digit([1-8])$/.exec(e.code);
    if (m && S.room) sendEmote(Number(m[1]) - 1);
  });
}

socket.on('chat:emoji', (m) => {
  if (!m || typeof m.id !== 'string' || !Number.isInteger(m.e) || m.e < 0 || m.e >= EMOTES.length) return;
  const now = performance.now();
  S.emotes.set(m.id, { e: EMOTES[m.e], born: now, until: now + 2600 });
  // In the lobby the bubble pops up on that player's card instead.
  const card = document.querySelector(`#lobby-players .pcard[data-pid="${CSS.escape(m.id)}"]`);
  if (card) {
    const old = card.querySelector('.pbubble');
    if (old) old.remove();
    const b = el('div', 'pbubble', EMOTES[m.e]);
    card.appendChild(b);
    setTimeout(() => b.remove(), 2600);
  }
});

let announceTimer = 0;
// Coins sent by the admin panel (server/app.js admin:giveCoins). Added to THIS browser's wallet and saved.
socket.on('admin:coins', (m) => {
  const n = m && Number.isInteger(m.amount) ? m.amount : 0;
  if (n < 1 || n > 999999) return;
  const got = credit(S.wallet, n, `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  if (!got) return;
  saveWalletNow();
  refreshPickers();
  if (SHOP.open) renderShop();
  if (PK.open) renderPacks();
  if (TR.open) renderTrade();
  toast(`+${got} coins!`);
  sfx.coin(1);
});

socket.on('server:announce', (m) => {
  if (!m || typeof m.text !== 'string') return;
  const box = $('announce');
  box.textContent = `\u{1F4E2} ${m.text.slice(0, 120)}`; // (textContent: never HTML)
  box.classList.add('show');
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => box.classList.remove('show'), 7000);
});

// =============================================================== admin panel
let adminTimer = 0;
function adminOpen(on) {
  $('overlay-admin').classList.toggle('hidden', !on);
  if (!on) {
    clearInterval(adminTimer);
    adminTimer = 0;
  }
}

function adminShowMain(yes) {
  $('admin-login').classList.toggle('hidden', yes);
  $('admin-main').classList.toggle('hidden', !yes);
  clearInterval(adminTimer);
  adminTimer = 0;
  if (yes) {
    adminRefresh();
    adminTimer = setInterval(adminRefresh, 3000);
  }
}

function adminCoinsAmount() {
  return Math.floor(Number($('admin-coins-amount').value));
}

async function adminRefresh() {
  const res = await request('admin:status');
  if (!res || !res.ok) {
    adminShowMain(false); // lost admin rights (for example after a reconnect)
    $('admin-error').textContent = 'Please enter the code again.';
    return;
  }
  const st = res.stats;
  $('admin-chat-toggle').textContent = `Chat: ${st.chatOn ? 'ON (click to switch off)' : 'OFF (click to switch on)'}`;
  $('admin-chat-toggle').dataset.on = st.chatOn ? '1' : '0';
  const mins = Math.floor(st.uptimeSec / 60);
  const stats = $('admin-stats');
  stats.textContent = '';
  for (const t of [`Up ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}`, `${st.rooms}/${st.maxRooms} rooms`, `${st.connected} players online`, `${st.sockets} connections`, `${st.memoryMB} MB memory`]) {
    stats.appendChild(el('span', null, t));
  }
  const box = $('admin-rooms');
  box.textContent = '';
  if (res.rooms.length === 0) box.appendChild(el('div', 'public-empty', 'No rooms right now.'));
  for (const r of res.rooms) {
    const card = el('div', 'admin-room');
    const h = el('h4');
    h.appendChild(el('b', null, r.code));
    h.appendChild(el('span', null, `${r.host}'s room`));
    h.appendChild(el('span', 'tag', r.phase === 'lobby' || r.phase === 'final' ? r.phase : `round ${r.round}/${r.rounds} (${r.phase})`));
    if (r.isPublic) h.appendChild(el('span', 'tag', 'public'));
    if (r.rage) h.appendChild(el('span', 'tag rage', 'rage bait'));
    h.appendChild(el('span', 'tag', `${r.players.length}/${r.max}`));
    h.appendChild(el('span', 'grow'));
    const view = el('button', null, `Chat (${r.chatCount})`);
    view.type = 'button';
    view.style.background = '#cfe8ff';
    view.addEventListener('click', async () => {
      const old = card.querySelector('.admin-chatlog');
      if (old) return old.remove();
      const res2 = await request('admin:chat', { code: r.code });
      const box2 = el('div', 'admin-chatlog');
      if (res2 && res2.ok && res2.messages.length) for (const m of res2.messages) box2.appendChild(el('div', null, `${m.name}: ${m.text}`));
      else box2.appendChild(el('div', null, 'No messages.'));
      card.appendChild(box2);
    });
    h.appendChild(view);
    const close = el('button', null, 'Close room');
    close.type = 'button';
    close.addEventListener('click', async () => {
      if (!window.confirm(`Close room ${r.code} and send everybody in it back to the title screen?`)) return;
      await request('admin:close', { code: r.code });
      adminRefresh();
    });
    h.appendChild(close);
    card.appendChild(h);
    for (const p of r.players) {
      const chip = el('span', 'admin-player' + (p.connected ? '' : ' off'), p.name);
      const kick = el('button', null, 'Kick');
      kick.type = 'button';
      kick.addEventListener('click', async () => {
        await request('admin:kick', { code: r.code, playerId: p.id });
        adminRefresh();
      });
      chip.appendChild(kick);
      const give = el('button', null, '+coins');
      give.type = 'button';
      give.disabled = !p.connected;
      give.addEventListener('click', async () => {
        const res = await request('admin:giveCoins', { amount: adminCoinsAmount(), code: r.code, playerId: p.id });
        toast(res && res.ok ? `Gave ${adminCoinsAmount()} coins to ${res.who}.` : (res && res.error) || 'Could not give coins.');
      });
      chip.appendChild(give);
      card.appendChild(chip);
    }
    box.appendChild(card);
  }
}

function setupAdmin() {
  $('admin-link').addEventListener('click', () => {
    adminOpen(true);
    $('admin-error').textContent = '';
    $('admin-code').value = '';
    // If this connection is already unlocked, go straight to the panel.
    request('admin:status').then((res) => {
      adminShowMain(!!(res && res.ok));
      if (!(res && res.ok)) $('admin-code').focus();
    });
  });
  $('admin-close').addEventListener('click', () => adminOpen(false));
  $('overlay-admin').addEventListener('click', (e) => {
    if (e.target === $('overlay-admin')) adminOpen(false);
  });
  $('admin-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('admin-code').value;
    $('admin-code').value = '';
    const res = await request('admin:login', { code });
    if (res && res.ok) {
      $('admin-error').textContent = '';
      adminShowMain(true);
    } else {
      $('admin-error').textContent = (res && res.error) || 'Could not check the code.';
    }
  });
  $('admin-coins-btn').addEventListener('click', async () => {
    const res = await request('admin:giveCoins', { amount: adminCoinsAmount() });
    if (!(res && res.ok)) toast((res && res.error) || 'Could not give coins.');
  });
  $('admin-chat-toggle').addEventListener('click', async () => {
    const turnOn = $('admin-chat-toggle').dataset.on !== '1';
    await request('admin:chatToggle', { on: turnOn });
    adminRefresh();
  });
  $('admin-logout').addEventListener('click', async () => {
    await request('admin:logout');
    adminShowMain(false);
    $('admin-code').focus();
  });
  $('admin-announce-btn').addEventListener('click', async () => {
    const text = $('admin-announce-text').value;
    const res = await request('admin:announce', { text });
    if (res && res.ok) {
      $('admin-announce-text').value = '';
      toast('Announcement sent.');
    } else toast((res && res.error) || 'Could not send.');
  });
}

// =============================================================== snapshots
socket.on('room:state', applyRoomState);

socket.on('room:kicked', (info) => {
  leaveToTitle((info && info.reason) || 'You were removed from the room.');
});

socket.on('game:snap', (raw) => {
  const snap = decodeSnap(raw);
  if (!S.room || S.room.phase !== 'playing') return;
  snap.map = new Map(snap.ps.map((p) => [p.id, p]));
  const arrived = performance.now();
  trackSnapshotTiming(arrived);
  S.snaps.push({ r: arrived, s: snap });
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

// A player's colour as a CSS colour (for splashes and floating text).
function colorOf(id) {
  const m = S.meta.get(id);
  return m ? COLORS[m.color % COLORS.length].hex : '#ffffff';
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
      case 'splat':
        renderer.burst(OX + ev.x, OY + ev.y - 10, [colorOf(ev.id), '#ffffff'], 12, 220, 'circle', 0.6);
        renderer.floatText(OX + ev.x, OY + ev.y - 60, 'SPLAT!', colorOf(ev.id), 24);
        sfx.hit();
        break;
      case 'call':
        sfx.pass();
        renderer.addShake(2);
        break;
      case 'safe':
        renderer.burst(OX + ev.x, OY + ev.y - 20, ['#8ef0a8', '#ffffff'], mine ? 10 : 4, 160, 'star', 0.5);
        if (mine) {
          renderer.floatText(OX + ev.x, OY + ev.y - 70, 'SAFE! +1', '#8ef0a8', 24);
          sfx.coin();
        }
        break;
      case 'miss':
        renderer.burst(OX + ev.x, OY + ev.y - 10, ['#9b5de5', '#d9a7ff'], 10, 170, 'circle', 0.6);
        renderer.floatText(OX + ev.x, OY + ev.y - 64, 'SPLAT!', '#d9a7ff', 24);
        if (mine) {
          sfx.slow();
          renderer.addShake(8);
        }
        break;
      case 'clear':
        renderer.burst(OX + ev.x, OY + ev.y - 40, ['#ffe66d', '#ffffff'], mine ? 10 : 4, 150, 'star', 0.5);
        if (mine) {
          renderer.floatText(OX + ev.x, OY + ev.y - 80, '+1', '#fff27a', 28);
          sfx.coin();
        }
        break;
      case 'tangle':
        renderer.burst(OX + ev.x, OY + ev.y - 20, ['#ff9a8b', '#ffffff'], 8, 170, 'circle', 0.5);
        renderer.floatText(OX + ev.x, OY + ev.y - 64, 'TANGLED!', '#ffb3a7', 22);
        renderer.addShake(mine ? 9 : 3);
        sfx.hit();
        break;
      case 'flipWarn':
        toast('The rope is about to REVERSE!');
        sfx.tick();
        break;
      case 'flip':
        renderer.addShake(5);
        sfx.zone();
        break;
      case 'gate':
        if (mine) {
          sfx.gate();
          if (ev.lap) {
            renderer.floatText(OX + ev.x, OY + ev.y - 50, 'LAP!', '#fff27a', 30);
            sfx.jackpot();
          }
        }
        break;
      case 'trip':
        renderer.dust(OX + ev.x, OY + ev.y, '#ffffff', 8);
        renderer.floatText(OX + ev.x, OY + ev.y - 60, 'TRIPPED!', '#ffb3a7', 22);
        renderer.addShake(mine ? 8 : 3);
        sfx.deny();
        break;
      case 'dug':
        renderer.burst(OX + ev.x, OY + ev.y - 14, ['#ffd23f', '#fff27a', '#ffffff'], ev.v >= 5 ? 20 : 8, ev.v >= 5 ? 260 : 150, 'star', 0.7);
        renderer.floatText(OX + ev.x, OY + ev.y - 56, `+${ev.v}`, '#fff27a', 28);
        if (ev.v >= 5) sfx.jackpot();
        else sfx.coin(mine ? 1 : 0.5);
        break;
      case 'dugBomb':
        renderer.burst(OX + ev.x, OY + ev.y - 10, ['#ff9a3c', '#ff5a4d', '#ffffff'], 24, 320, 'circle', 0.7);
        renderer.floatText(OX + ev.x, OY + ev.y - 70, 'BOOM!', '#ff9a8b', 34);
        renderer.addShake(14);
        sfx.boom();
        break;
      case 'rumble':
        sfx.rumble();
        break;
      case 'stomp':
        renderer.burst(OX + ev.x, OY + ev.y - 16, ev.gold ? ['#ffd23f', '#fff27a', '#ffffff'] : ['#c9a66b', '#ffffff'], ev.gold ? 18 : 9, 200, 'star', 0.6);
        renderer.floatText(OX + ev.x, OY + ev.y - 70, `+${ev.v}`, '#fff27a', 28);
        renderer.addShake(mine ? 6 : 2);
        sfx.stomp(mine ? 1 : 0.5);
        if (ev.gold) sfx.jackpot();
        break;
      case 'bite':
        renderer.floatText(OX + ev.x, OY + ev.y - 70, 'OUCH! -2', '#ff9a8b', 26);
        renderer.addShake(mine ? 9 : 3);
        sfx.deny();
        break;
      case 'tired':
        if (mine) {
          sfx.deny();
          const box = $('stamina');
          box.classList.remove('tired');
          void box.offsetWidth;
          box.classList.add('tired');
          renderer.floatText(OX + ev.x, OY + ev.y - 70, 'TIRED!', '#ffb3a7', 22);
        }
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
      case 'warn':
        sfx.tick();
        break;
      case 'impact':
        renderer.burst(OX + ev.x, OY + ev.y - 6, ['#ffb02e', '#ff595e', '#6b5b6e', '#ffe66d'], 22, 340, 'star', 0.8);
        renderer.dust(OX + ev.x, OY + ev.y, '#d9d3e8', 10);
        renderer.addShake(ev.hits ? 10 : 5);
        sfx.boom();
        break;
      case 'meteorHit':
        renderer.floatText(OX + ev.x, OY + ev.y - 70, ev.id === S.me ? 'OUCH!' : 'OOF!', '#ff8a8a', 28);
        if (ev.id === S.me) renderer.addShake(14);
        sfx.hit();
        break;
      case 'dodge':
        renderer.floatText(OX + ev.x, OY + ev.y - 70, 'HOP!', '#9bffb0', 26);
        if (mine) sfx.coin(1);
        break;
      case 'crown':
        renderer.burst(OX + ev.x, OY + ev.y - 40, ['#ffd23f', '#fff27a', '#ffffff'], 14, 240, 'star', 0.7);
        renderer.floatText(OX + ev.x, OY + ev.y - 80, ev.id === S.me ? 'CROWNED!' : `${nameOf(ev.id)}!`, '#ffe66d', 28);
        sfx.jackpot();
        break;
      case 'crownDrop':
        renderer.burst(OX + ev.x, OY + ev.y - 40, ['#ffd23f', '#ffffff'], 10, 260, 'circle', 0.5);
        sfx.drop();
        break;
      case 'overheat':
        renderer.burst(OX + ev.x, OY + ev.y - 40, ['#ff7a3d', '#ffd23f', '#ff595e'], 20, 320, 'star', 0.8);
        renderer.floatText(OX + ev.x, OY + ev.y - 90, 'TOO HOT!', '#ff8a3d', 32);
        renderer.addShake(8);
        sfx.boom();
        break;
      case 'disguise':
      case 'undisguise':
      case 'swap':
        renderer.burst(OX + ev.x, OY + ev.y - 24, ['#ffffff', '#cfd8ff', '#ffe66d'], ev.k === 'swap' ? 6 : 12, 160, 'circle', 0.5);
        sfx.pass();
        break;
      case 'found':
        renderer.burst(OX + ev.x, OY + ev.y - 30, ['#ffe66d', '#ff6fb5', '#ffffff'], 18, 280, 'star', 0.9);
        renderer.floatText(OX + ev.x, OY + ev.y - 80, ev.id === S.me ? 'YOU WERE FOUND!' : `${nameOf(ev.id)} FOUND!`, '#fff27a', 28);
        renderer.addShake(ev.id === S.me ? 14 : 7);
        sfx.ko();
        if (ev.id === S.me) toast('Found! You are not out: now help find the others!');
        break;
      case 'bonk':
        renderer.floatText(OX + ev.x, OY + ev.y - 60, 'JUST A PROP!', '#ffb86b', 24);
        renderer.burst(OX + ev.x, OY + ev.y - 20, ['#ffffff', '#c9a66b'], 8, 160, 'circle', 0.4);
        sfx.deny();
        break;
      case 'seekStart':
        toast('Ready or not, here they come!');
        sfx.go();
        renderer.addShake(6);
        break;
      case 'sweep':
        toast('Every hider was found!');
        break;
      case 'newSeeker':
        toast(ev.id === S.me ? 'The seeker left. You are the seeker now!' : `${nameOf(ev.id)} is the new seeker!`);
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

// Watches how evenly snapshots arrive. Steady network -> draw other players only
// a little in the past (snappy); bumpy network -> a bit further back (smooth).
function trackSnapshotTiming(at) {
  const n = S.net;
  if (n.lastSnapAt) {
    const gap = at - n.lastSnapAt;
    if (gap < 1000) {
      n.mean += (gap - n.mean) * 0.05;
      n.jitter += (Math.abs(gap - n.mean) - n.jitter) * 0.05;
      const target = Math.min(INTERP_MAX, Math.max(INTERP_MIN, n.mean * 1.5 + n.jitter * 3));
      S.interp += (target - S.interp) * 0.03; // glide, never jump
    }
  }
  n.lastSnapAt = at;
  n.snapCount++;
}

// Measures round-trip time to the server a couple of times per second.
setInterval(() => {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.timeout(3000).emit('net:ping', (err) => {
    if (!err) S.net.ping = Math.round(performance.now() - t0);
  });
}, 2000);

// Looks after the frame rate: if the computer cannot keep up, quietly draw at a
// lower resolution (it looks almost the same but is much cheaper); if there is
// plenty of spare speed, bring the sharpness back.
function trackFrameRate(now, frameMs) {
  const p = S.perf;
  p.frames++;
  p.worst = Math.max(p.worst, frameMs);
  if (now - p.since < 1000) return;
  p.fps = Math.round((p.frames * 1000) / (now - p.since));
  const playing = S.view === 'stage' && document.visibilityState === 'visible';
  if (playing) {
    if (p.fps < 48) {
      p.lowWins++;
      p.goodWins = 0;
    } else if (p.fps >= 57) {
      p.goodWins++;
      p.lowWins = 0;
    } else {
      p.lowWins = 0;
      p.goodWins = 0;
    }
    if (p.lowWins >= 2 && renderer.setQuality(renderer.quality * 0.8)) p.lowWins = 0;
    else if (p.goodWins >= 8 && renderer.setQuality(renderer.quality / 0.8)) p.goodWins = 0;
  }
  $('perf-hud').classList.toggle('hidden', !S.showPerf);
  if (S.showPerf) {
    const n = S.net;
    $('perf-hud').textContent =
      `FPS ${p.fps}   worst frame ${Math.round(p.worst)} ms\n` +
      `ping ${n.ping == null ? '?' : n.ping} ms   snaps/s ${n.snapCount}\n` +
      `render delay ${Math.round(S.interp)} ms   jitter ${n.jitter.toFixed(1)} ms\n` +
      `resolution x${renderer.px.toFixed(2)}  (quality ${renderer.quality.toFixed(2)})\n` +
      `connection ${transportName()}${renderer.safe ? '   safe drawing ON' : ''}`;
  }
  S.net.snapCount = 0;
  p.frames = 0;
  p.worst = 0;
  p.since = now;
}

// Build the world to draw "right now" from the buffered snapshots.
function sampleFrame(now) {
  const buf = S.snaps;
  if (buf.length === 0) return null;
  const latest = buf[buf.length - 1];
  const renderT = now - S.interp;
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
      // Replay your recent key presses on top of the newest server position (see predict.js).
      const guess = NO_PREDICT ? null : predictor.predict(p, {
        now,
        recvAt: latest.r,
        rtt: S.net.ping == null ? 60 : S.net.ping,
        walkable: latest.s.gid === 'crumbleFloor' ? null : walkableFor(S.room && S.room.arena && S.room.arena.floor),
      });
      if (guess) {
        const airborne = Math.max(0, p.z + p.vz * ahead);
        return { ...p, x: guess.x, y: guess.y, fx: guess.fx, fy: guess.fy, z: airborne };
      }
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

  // Moving hazards (the Jump Rope, a gliding hill, a flying crown) are shown at the SAME moment as the other
  // players, not at the newest snapshot. Before, the players were drawn ~60 ms in the past but the rope at "now",
  // so a player could look hit before the rope reached them (or look safe when they were not).
  let world = latest.s;
  if (a !== b && a.s !== b.s) {
    const dtSec = Math.max(0, Math.min(renderT - a.r, b.r - a.r)) / 1000;
    const A = a.s;
    const B = b.s;
    if (A.rp && B.rp) world = { ...world, rp: { ...B.rp, a: A.rp.a + A.rp.w * dtSec } };
    if (A.crown && B.crown && A.crown.mv && B.crown.mv && !A.crown.hd && !B.crown.hd) {
      world = { ...world, crown: { ...B.crown, x: A.crown.x + (B.crown.x - A.crown.x) * k, y: A.crown.y + (B.crown.y - A.crown.y) * k } };
    }
    if (A.zone && B.zone && A.zone.mv && B.zone.mv) {
      world = { ...world, zone: { ...B.zone, x: A.zone.x + (B.zone.x - A.zone.x) * k, y: A.zone.y + (B.zone.y - A.zone.y) * k } };
    }
  }

  const arena = S.room && S.room.arena;
  return {
    theme: S.theme,
    time: latest.s.t + (S.room && S.room.phase === 'playing' ? Math.min(0.1, (now - latest.r) / 1000) : 0),
    tiles: latest.s.tiles,
    players,
    puddles: latest.s.pd,
    meta: S.meta,
    myId: S.me,
    emotes: S.emotes,
    arena,
    cols: arena ? arena.cols : 14,
    rows: arena ? arena.rows : 9,
    finished: latest.s.fin,
    aliveCount: latest.s.alive,
    latest: world,
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
  // (Prop Hunt sends labels that depend on your role: Disguise, Smack, Swap prop...)
  const lb = frame.latest.lb;
  $('ab-jump-label').textContent = ghost ? 'Float' : lb ? lb[0] : arenaGame ? arena.jumpLabel || 'Jump' : 'Jump';
  $('ab-shove-label').textContent = ghost ? 'Drop goo' : lb ? lb[1] : arenaGame ? arena.shoveLabel || 'Shove' : 'Shove';
  const fill = $('ab-shove-fill');
  let frac = 1;
  if (mine && mine.st === 'alive') frac = 1 - Math.min(1, mine.cd / arena.shoveCooldown);
  else if (ghost) frac = mine.am <= 0 ? 0 : 1 - Math.min(1, mine.pc / arena.gooCooldown);
  fill.style.transform = `scaleX(${frac.toFixed(2)})`;
  $('ab-shove').classList.toggle('cooling', frac < 1);

  // Stamina (jump and shove share it). Tick marks show the price of each move.
  const stam = $('stamina');
  const noStamina = !!(S.room && S.room.rage); // Rage Bait: no stamina at all
  if (mine && mine.sm > 0 && mine.st === 'alive' && !noStamina) {
    stam.classList.remove('hidden');
    $('stamina-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, mine.sp / mine.sm)).toFixed(3)})`;
    stam.classList.toggle('low', mine.sp < Math.min(arena.jumpCost || 25, arena.shoveCost || 35));
    $('stamina-mark-j').style.left = `${Math.min(100, ((arena.jumpCost || 25) / mine.sm) * 100)}%`;
    $('stamina-mark-s').style.left = `${Math.min(100, ((arena.shoveCost || 35) / mine.sm) * 100)}%`;
  } else {
    stam.classList.add('hidden');
  }

  // Scoreboard chips (rebuilt only when something changes)
  // (In the arena games the chips show this round's score: coins, booms, seconds.)
  // Hidden players (Prop Hunt) are not in the players list, so their score comes from `sc`.
  const roundScore = (p) => {
    const e = frame.latest.map.get(p.id);
    if (e && e.rs !== undefined) return e.rs;
    return (frame.latest.sc && frame.latest.sc[p.id]) || 0;
  };
  const sig = st.players.map((p) => `${p.id}:${p.score}:${(frame.latest.map.get(p.id) || {}).st}:${roundScore(p)}`).join('|');
  if (sig !== S.hudSig) {
    S.hudSig = sig;
    const box = $('hud-scores');
    box.textContent = '';
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

  if (st.phase === 'playing') music.setScene(sceneFor({ phase: 'playing', gid, t }));

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
  } else if (st.phase === 'playing' && gid === 'propHunt' && mine && t >= 0 && !frame.finished) {
    const L = frame.latest;
    let msg = '';
    if (mine.rl && L.hl > 0) msg = 'You are the SEEKER! Eyes closed while they hide...';
    else if (mine.rl && mine.hp) msg = 'You were found, so now you help hunt! E = smack a suspicious prop';
    else if (mine.rl) msg = 'You are the SEEKER! Press E to smack the prop you think is a player';
    else if (mine.dg) msg = 'You are a PROP! Stay still. SPACE swaps prop, E turns back';
    else if (L.hl > 0) msg = 'You are a HIDER! Stand near props and press E to disguise';
    else if (frame.aliveCount > 1) msg = 'Press E to disguise as a prop, then keep still!';
    banner.textContent = msg;
    banner.classList.toggle('hidden', !msg);
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
  if (st.phase === 'pitstop') $('pit-count').textContent = `${secs}s left`;
  if (st.phase === 'results') {
    $('results-foot').textContent = st.round < st.rounds ? `Next round in ${secs}…` : `Final scores in ${secs}…`;
  }
}

// ---- when something goes wrong on ONE person's computer, say so on screen instead of showing an empty map
function showPlayWarn(text) {
  const box = $('play-warn');
  if (!text) {
    box.classList.add('hidden');
    return;
  }
  if (box.textContent !== text) box.textContent = text;
  box.classList.remove('hidden');
}

// Drawing threw an error. First retry in "safe drawing" (no offscreen pictures); if that fails too, show the error.
function onDrawError(e) {
  S.drawFails = (S.drawFails || 0) + 1;
  if (!S.drawErr) {
    S.drawErr = String((e && e.message) || e).slice(0, 160);
    console.error('draw failed:', e);
  }
  if (!renderer.safe && S.drawFails >= 3) {
    renderer.useSafeMode(); // also resets the canvas state that the failed frame left half-finished
    S.drawFails = 0;
    return;
  }
  if (S.drawFails >= 3) {
    showPlayWarn(`Drawing problem on this computer: ${S.drawErr}. Try reloading (Cmd/Ctrl + Shift + R), a different browser, or turning off extensions.`);
  }
}

// Playing, but no game data is arriving (a blocked or very slow connection): explain it instead of an empty arena.
function watchGameData(now) {
  const st = S.room;
  const playing = st && st.phase === 'playing';
  const last = S.snaps.length ? S.snaps[S.snaps.length - 1].r : 0;
  const starved = playing && (!last || now - last > 1500);
  if (!starved) {
    S.waitSince = 0;
    if (S.drawFails < 3) showPlayWarn('');
    return;
  }
  if (!S.waitSince) S.waitSince = now;
  if (now - S.waitSince > 2500) {
    const t = transportName();
    showPlayWarn(
      t === 'none'
        ? 'Connection lost - reconnecting... (if this stays, check your internet or turn off a VPN)'
        : `Waiting for game data... connection type: ${t}. If this stays, a VPN, school/work network, firewall, antivirus or ad blocker may be blocking the game. Try turning it off, another network, or another browser.`
    );
  }
}

function loop(now) {
  const frameMs = now - S.lastFrame;
  const dt = Math.min(0.05, frameMs / 1000);
  S.lastFrame = now;
  trackFrameRate(now, frameMs);

  if (S.view === 'stage') {
    const frame = sampleFrame(now);
    syncStageBg((frame && frame.theme) || S.theme);
    if (frame) {
      if (DEBUG) window.__tmFrame = frame;
      try {
        renderer.draw(frame, dt);
        S.drawFails = 0;
      } catch (e) {
        onDrawError(e);
      }
      if (S.room && (S.room.phase === 'playing' || S.room.phase === 'results')) updateHud(frame);
    } else {
      try {
        renderer.idle(S.theme, dt);
      } catch (e) {
        onDrawError(e);
      }
    }
    watchGameData(now);
  } else {
    S.waitSince = 0;
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

  $('pit-done').addEventListener('click', () => {
    const me = myRoomPlayer();
    sfx.click();
    socket.emit('shop:done', !(me && me.done));
  });

  $('btn-create').addEventListener('click', createRoom);
  $('btn-join').addEventListener('click', () => joinRoom());
  $('code-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });
  $('code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  $('name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ($('code-input').value.length === 4 ? joinRoom() : createRoom());
  });

  $('shop-close').addEventListener('click', closeShop);
  $('shop-action').addEventListener('click', shopAction);
  $('final-shop').addEventListener('click', () => openShop());
  $('final-trophies').addEventListener('click', () => openTrophies());
  $('trophy-close').addEventListener('click', closeTrophies);
  $('overlay-trophies').addEventListener('pointerdown', (e) => {
    if (e.target === $('overlay-trophies')) closeTrophies();
  });
  $('overlay-shop').addEventListener('pointerdown', (e) => {
    if (e.target === $('overlay-shop')) closeShop();
  });
  $('trade-invite-yes').addEventListener('click', async () => {
    if (!TR.view) return;
    const res = await request('trade:answer', { id: TR.view.id, yes: true });
    if (!res.ok) toast(res.error || 'That trade is over.');
  });
  $('trade-invite-no').addEventListener('click', async () => {
    const id = TR.view && TR.view.id;
    $('trade-invite').classList.add('hidden');
    if (id) await request('trade:answer', { id, yes: false });
    TR.view = null;
  });
  $('trade-cancel').addEventListener('click', () => {
    if (TR.view) socket.emit('trade:cancel', { id: TR.view.id });
    closeTradeWindow();
  });
  $('trade-accept').addEventListener('click', async () => {
    if (!TR.view) return;
    const res = await request('trade:accept', { id: TR.view.id, rev: TR.view.rev });
    if (!res.ok) toast(res.error);
  });
  $('trade-add').addEventListener('click', () => {
    TR.picking = !TR.picking;
    renderTradePicker();
  });
  $('trade-my-coins').addEventListener('input', (e) => {
    clearTimeout(TR.offerTimer);
    TR.offerTimer = setTimeout(() => {
      if (!TR.view || TR.view.state !== 'open') return;
      const raw = Math.floor(Number(e.target.value));
      const n = Number.isFinite(raw) ? Math.max(0, Math.min(TRADE_MAX_COINS, raw)) : 0;
      e.target.value = String(n);
      if (n !== TR.view.mine.coins) sendOffer(n, TR.view.mine.items);
    }, 350);
  });
  $('packs-close').addEventListener('click', closePacks);
  $('overlay-packs').addEventListener('pointerdown', (e) => {
    if (e.target === $('overlay-packs')) closePacks();
  });
  $('reveal-done').addEventListener('click', closeReveal);
  $('reveal-all').addEventListener('click', flipAll);
  $('reveal-again').addEventListener('click', () => {
    const id = PK.lastPack;
    closeReveal();
    if (id) startReveal(id);
  });
  addAvatar($('shop-canvas'), () => shopLook());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && TR.open) {
      if (TR.view) socket.emit('trade:cancel', { id: TR.view.id });
      closeTradeWindow();
    } else if (e.key === 'Escape' && PK.reveal) closeReveal();
    else if (e.key === 'Escape' && PK.open) closePacks();
    if (e.key === 'Escape' && SHOP.open) closeShop();
    if (e.key === 'Escape' && TRO.open) closeTrophies();
    if (e.key === 'F3') {
      e.preventDefault();
      S.showPerf = !S.showPerf;
      $('perf-hud').classList.toggle('hidden', !S.showPerf);
    }
  });

  $('btn-leave').addEventListener('click', leaveRoom);
  $('btn-home').addEventListener('click', onHomeClick);
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
  $('public-check').addEventListener('change', async (e) => {
    const res = await request('room:public', e.target.checked);
    if (!res.ok) {
      toast(res.error);
      e.target.checked = !e.target.checked;
    } else {
      toast(res.isPublic ? 'Your room is now listed on the home page.' : 'Your room is private again.');
    }
  });
  $('public-refresh').addEventListener('click', () => {
    sfx.click();
    refreshPublicRooms();
  });
  $('rage-check').addEventListener('change', async (e) => {
    const res = await request('room:rage', e.target.checked);
    if (!res.ok) {
      e.target.checked = !e.target.checked;
      toast(res.error || 'Could not change that.');
    } else {
      toast(res.rage ? 'RAGE BAIT is on. Shoves are huge, everything is harder, and there is no stamina!' : 'Rage Bait is off. Back to normal.');
    }
  });
  setupEmotes();
  setupChat();
  setupAdmin();
  $('map-select').addEventListener('change', async (e) => {
    const res = await request('room:map', e.target.value);
    if (!res.ok) {
      toast(res.error || 'Could not change that.');
      if (S.room) e.target.value = S.room.mapPick || 'random';
    }
  });
  loadMaps();
  $('max-select').addEventListener('change', async (e) => {
    const res = await request('room:max', Number(e.target.value));
    if (!res.ok) {
      toast(res.error || 'Could not change that.');
      if (S.room) $('max-select').value = String(S.room.maxPlayers);
    }
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
  const musicBtn = $('music-btn');
  const syncMusic = () => {
    musicBtn.classList.toggle('off', !music.isEnabled());
    musicBtn.setAttribute('aria-pressed', String(music.isEnabled()));
  };
  syncMusic();
  musicBtn.addEventListener('click', () => {
    music.setEnabled(!music.isEnabled());
    syncMusic();
  });
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (e.code === 'KeyM' && tag !== 'INPUT' && tag !== 'SELECT') {
      setMuted(!isMuted());
      syncMute();
    }
    if (e.code === 'KeyN' && tag !== 'INPUT' && tag !== 'SELECT') {
      music.setEnabled(!music.isEnabled());
      syncMusic();
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
  } else {
    socket.emit('trade:pending'); // a trade may have finished while we were offline
  }
}

socket.on('connect', async () => {
  $('conn-banner').classList.add('hidden');
  if (S.room) loadChatHistory(); // catch up on anything said while we were away
  refreshPublicRooms(); // the home page list may have been asked for before we were connected
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
  window.__tmBooted = true; // tells the "game could not start" watchdog in index.html that all is well
  if (loadSession()) await tryRejoin();
}

boot().catch((e) => {
  if (window.__tmBootFail) window.__tmBootFail('The game hit a problem while starting: ' + (e && e.message));
});
