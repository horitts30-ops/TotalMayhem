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
import { music, sceneFor } from './music.js';
import { STAGE_W, STAGE_H, OX, OY, COLORS, HATS, SKINS, THEMES } from './constants.js';
import {
  KINDS, KIND_LABEL, loadWallet, saveWallet, owns, credit, buy, nextOwned, sanitizeLook,
  catalogue, nameOf as itemName, priceOf, isUnlockOnly,
} from './shop.js';
import {
  ACHIEVEMENTS, loadTrophies, saveTrophies, emptyTrophies, recordRound, recordFinal, recordPowerRound, recordCoins,
  recordOwned, applyRewards, achievementFor, progressOf, unlockedCount,
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
  meta: new Map(), // player id -> { name, color, hat, skin }
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
  interp: 90, // current interpolation delay in ms (adapts)
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
  if (v === 'title') music.setScene(sceneFor({ phase: 'title' }));
  $('screen-title').classList.toggle('hidden', v !== 'title');
  $('screen-lobby').classList.toggle('hidden', v !== 'lobby');
  $('stage-wrap').classList.toggle('hidden', v !== 'stage');
  document.body.classList.toggle('in-arena', v === 'stage');
  if (v === 'stage') fitStage();
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
  const shopBtn = $(`${prefix}-shop`);
  if (shopBtn) shopBtn.addEventListener('click', () => openShop());
  const troBtn = $(`${prefix}-trophies`);
  if (troBtn) troBtn.addEventListener('click', () => openTrophies());
  pickers.push({ swatchesEl, hatEl: $(`${prefix}-hat-name`), skinEl: $(`${prefix}-skin-name`) });
}

function refreshPickers() {
  for (const p of pickers) {
    [...p.swatchesEl.children].forEach((b, i) => {
      b.classList.toggle('on', i === S.look.color);
      b.classList.toggle('locked', !owns(S.wallet, 'color', i));
    });
    p.hatEl.textContent = HATS[S.look.hat];
    p.skinEl.textContent = SKINS[S.look.skin];
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
  $('overlay-trophies').classList.remove('hidden');
  renderTrophies();
  sfx.click();
}

function closeTrophies() {
  TRO.open = false;
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

const SHOP = { kind: 'hat', sel: { hat: 0, skin: 0, color: 0 }, open: false };

function shopLook() {
  return { ...S.look, [SHOP.kind]: SHOP.sel[SHOP.kind] };
}

function openShop(kind, index) {
  SHOP.open = true;
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
    const tag = el('div', 'tag' + (lockedByAch ? ' ach' : ''), owned ? (wearing(item.kind, item.index) ? 'Wearing' : 'Owned') : lockedByAch ? (S.trophies.unlocked[(achievementFor(item.kind, item.index) || {}).id] ? 'Claim!' : 'Trophy') : String(item.price));
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
      showView('lobby');
      break;
    case 'intro':
      renderer.reset();
      S.snaps = [];
      S.theme = (st.intro && st.intro.theme) || 'sunny';
      showView('stage');
      sfx.click();
      break;
    case 'pitstop':
      renderer.reset();
      S.snaps = [];
      pitMsg('');
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
      `resolution x${renderer.px.toFixed(2)}  (quality ${renderer.quality.toFixed(2)})`;
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

function loop(now) {
  const frameMs = now - S.lastFrame;
  const dt = Math.min(0.05, frameMs / 1000);
  S.lastFrame = now;
  trackFrameRate(now, frameMs);

  if (S.view === 'stage') {
    const frame = sampleFrame(now);
    syncStageBg((frame && frame.theme) || S.theme);
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

  $('pit-done').addEventListener('click', () => {
    const me = myRoomPlayer();
    sfx.click();
    socket.emit('shop:done', !(me && me.done));
  });

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
  addAvatar($('shop-canvas'), () => shopLook());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && SHOP.open) closeShop();
    if (e.key === 'Escape' && TRO.open) closeTrophies();
    if (e.key === 'F3') {
      e.preventDefault();
      S.showPerf = !S.showPerf;
    }
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
