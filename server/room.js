'use strict';

// ---------------------------------------------------------------------------
// A Room is one private lobby + the match being played in it.
//
// Match flow (the "phase"):
//
//   lobby -> intro -> playing -> results -> intro -> playing -> results -> ... -> final
//     ^                                                                              |
//     +---------------------- host: "Back to lobby" / "Play again" -----------------+
//
// The server owns ALL of this. Browsers only send their controls and draw what
// the server tells them, so a browser cannot award itself points.
// ---------------------------------------------------------------------------

const { randomId, makeRoomCode, cleanName, randomSillyName, safeInt } = require('./util');
const { encodeSnap } = require('./snapcodec');
const games = require('./games');
const { roundReward, finalReward } = require('./rewards');
const powerups = require('./powerups');
const chat = require('./chat');
const { MAP_IDS, getMap, chooseMap } = require('./maps');

class Room {
  constructor(io, code, cfg, gameOptions) {
    this.io = io;
    this.code = code;
    this.cfg = cfg;
    this.gameOptions = gameOptions || {};

    this.players = new Map(); // id -> player record (insertion order = join order)
    this.hostId = null;
    this.isPublic = false; // listed on the home page for anybody to join
    this.chat = []; // the last few chat messages (shown to people who join later)
    this.chatSeq = 0;
    this.rage = false; // Rage Bait mode (see server/rage.js): the host switches it on in the lobby
    this.maxPlayers = cfg.MAX_PLAYERS; // the host can lower this in the lobby
    this.mapPick = 'random'; // the host's map choice: 'random' or a map id (see server/maps.js)
    this.mapId = null; // the map used in the current round (null = this minigame has its own fixed arena)

    this.phase = 'lobby';
    this.phaseEndsAt = 0;
    this.round = 0;
    this.rounds = cfg.DEFAULT_ROUNDS;
    this.schedule = [];
    this.slot = null;
    this.intro = null;
    this.arena = null;
    this.game = null;
    this.participants = new Set();
    this.finishAt = 0;
    this.results = null;
    this.final = null;
    this.matchNo = 0; // counts matches in this room (the shop uses it so coins are paid once)
    this.hadCompany = false; // did any round of this match have 2+ players?

    this.createdAt = Date.now();
    this.lastConnectedAt = Date.now();
  }

  // ------------------------------------------------------------------ players
  // A label that is unique to this match, so the shop can never pay a match twice.
  matchId() {
    return `${this.createdAt.toString(36)}-${this.matchNo}`;
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  isFull() {
    return this.players.size >= this.maxPlayers;
  }

  uniqueName(wanted, exceptId) {
    let base = cleanName(wanted) || randomSillyName();
    const taken = (n) =>
      [...this.players.values()].some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase());
    if (!taken(base)) return base;
    for (let i = 2; i < 100; i++) {
      const suffix = ` ${i}`;
      const candidate = base.slice(0, 14 - suffix.length) + suffix;
      if (!taken(candidate)) return candidate;
    }
    return base;
  }

  addPlayer(info) {
    if (this.isFull()) throw new Error(`That room is full (${this.maxPlayers} players max).`);
    const player = {
      id: randomId(4),
      token: randomId(16),
      name: this.uniqueName(info.name),
      color: safeInt(info.color, 0, this.cfg.COLOR_COUNT - 1, 0),
      hat: safeInt(info.hat, 0, this.cfg.HAT_COUNT - 1, 0),
      skin: safeInt(info.skin, 0, this.cfg.SKIN_COUNT - 1, 0),
      back: safeInt(info.back, 0, this.cfg.BACK_COUNT - 1, 0),
      ready: false,
      connected: true,
      socketId: null,
      score: 0,
      purse: 0, // pit-stop coins for power-ups (reset every match)
      power: [], // power-ups carried into the next round: [{ id, paid }]
      done: false, // finished shopping
      disconnectedAt: 0,
    };
    this.players.set(player.id, player);
    this.lastConnectedAt = Date.now();
    this.ensureHost();
    return player;
  }

  findByToken(token) {
    if (typeof token !== 'string' || token.length < 8) return null;
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  ensureHost() {
    const host = this.players.get(this.hostId);
    if (host && host.connected) return;
    const next = this.connectedPlayers()[0];
    this.hostId = next ? next.id : this.hostId;
  }

  markConnected(player, socketId) {
    player.connected = true;
    player.socketId = socketId;
    player.disconnectedAt = 0;
    this.lastConnectedAt = Date.now();
    this.ensureHost();
  }

  handleDisconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    p.ready = false;
    p.disconnectedAt = Date.now();
    if (this.game && this.participants.has(playerId)) this.game.removePlayer(playerId);
    this.ensureHost();
    this.broadcastState();
  }

  removePlayer(playerId) {
    if (!this.players.has(playerId)) return;
    if (this.game && this.participants.has(playerId)) this.game.removePlayer(playerId);
    this.players.delete(playerId);
    this.participants.delete(playerId);
    this.ensureHost();
    this.broadcastState();
  }

  setCustomization(playerId, data) {
    const p = this.players.get(playerId);
    if (!p || !data || typeof data !== 'object') return;
    if (this.phase !== 'lobby' && this.phase !== 'final') return;
    if (data.name !== undefined) p.name = this.uniqueName(data.name, p.id);
    if (data.color !== undefined) p.color = safeInt(data.color, 0, this.cfg.COLOR_COUNT - 1, p.color);
    if (data.hat !== undefined) p.hat = safeInt(data.hat, 0, this.cfg.HAT_COUNT - 1, p.hat);
    if (data.skin !== undefined) p.skin = safeInt(data.skin, 0, this.cfg.SKIN_COUNT - 1, p.skin);
    if (data.back !== undefined) p.back = safeInt(data.back, 0, this.cfg.BACK_COUNT - 1, p.back);
    this.broadcastState();
  }

  setReady(playerId, ready) {
    const p = this.players.get(playerId);
    if (!p || (this.phase !== 'lobby' && this.phase !== 'final')) return;
    p.ready = ready === true;
    this.broadcastState();
  }

  // The host can list the room on the home page (or hide it again).
  setPublic(playerId, on) {
    if (playerId !== this.hostId) return 'Only the host can change that.';
    this.isPublic = on === true;
    this.broadcastState();
    return null;
  }

  // Rage Bait: much stronger shoves and much harder minigames, for everybody in the room.
  setRage(playerId, on) {
    if (playerId !== this.hostId) return 'Only the host can change that.';
    if (this.phase !== 'lobby' && this.phase !== 'final') return 'You can only change that between matches.';
    this.rage = on === true;
    this.broadcastState();
    return null;
  }

  // The host picks the floor shape for the maps-capable minigames ('random' = a mix).
  setMap(playerId, pick) {
    if (playerId !== this.hostId) return 'Only the host can change that.';
    if (this.phase !== 'lobby' && this.phase !== 'final') return 'You can only change that between matches.';
    if (pick !== 'random' && !MAP_IDS.includes(pick)) return 'No such map.';
    this.mapPick = pick;
    this.broadcastState();
    return null;
  }

  // What the public list shows about this room. Never includes tokens or ids.
  listing() {
    const host = this.players.get(this.hostId);
    return {
      code: this.code,
      host: host ? host.name : '?',
      players: this.connectedPlayers().length,
      max: this.maxPlayers,
      rage: this.rage,
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
    };
  }

  // The host picks how many players the room holds (2 up to the server's limit).
  setMaxPlayers(playerId, n) {
    if (playerId !== this.hostId) return 'Only the host can change that.';
    if (this.phase !== 'lobby' && this.phase !== 'final') return 'You can only change that between matches.';
    const max = safeInt(n, 1, 999, 0);
    if (max < 2 || max > this.cfg.MAX_PLAYERS) return `Pick a number from 2 to ${this.cfg.MAX_PLAYERS}.`;
    if (max < this.players.size) return `There are already ${this.players.size} players in the room.`;
    this.maxPlayers = max;
    this.broadcastState();
    return null;
  }

  // Text chat. Returns an error message, or null when the message was posted.
  postChat(playerId, text, enabled) {
    const p = this.players.get(playerId);
    if (!p) return 'Not in this room.';
    if (!enabled) return 'Chat is switched off on this server right now.';
    if (!chat.CHAT_PHASES.has(this.phase)) return 'Chat opens between rounds.';
    const now = Date.now();
    p.chatTimes = (p.chatTimes || []).filter((t) => now - t < chat.BURST_WINDOW_MS);
    const last = p.chatTimes[p.chatTimes.length - 1];
    if ((last && now - last < (this.cfg.CHAT_GAP_MS ?? chat.MIN_GAP_MS)) || p.chatTimes.length >= chat.BURST) return 'Slow down a little!';
    const clean = chat.cleanChat(text, { filter: this.cfg.CHAT_FILTER !== false });
    if (!clean) return 'Type something first.';
    p.chatTimes.push(now);
    const msg = { n: ++this.chatSeq, id: p.id, name: p.name, text: clean };
    this.chat.push(msg);
    if (this.chat.length > chat.HISTORY) this.chat.shift();
    this.io.to(this.code).emit('chat:msg', msg);
    return null;
  }

  setRounds(playerId, n) {
    if (playerId !== this.hostId) return 'Only the host can change that.';
    if (this.phase !== 'lobby' && this.phase !== 'final') return 'You can only change that between matches.';
    const rounds = safeInt(n, 1, 99, 0);
    if (!this.cfg.ALLOWED_ROUNDS.includes(rounds)) return 'That round count is not allowed.';
    this.rounds = rounds;
    this.broadcastState();
    return null;
  }

  // -------------------------------------------------------------- match flow
  startMatch(playerId) {
    if (playerId !== this.hostId) return 'Only the host can start the match.';
    if (this.phase !== 'lobby' && this.phase !== 'final') return 'A match is already running.';
    if (this.connectedPlayers().length < this.cfg.MIN_PLAYERS_TO_START) {
      return `You need at least ${this.cfg.MIN_PLAYERS_TO_START} player(s) to start.`;
    }
    for (const p of this.players.values()) {
      p.score = 0;
      p.purse = 0;
      p.power = [];
      p.done = false;
      p.ready = false;
    }
    this.round = 0;
    this.matchNo += 1;
    this.hadCompany = false;
    this.final = null;
    this.results = null;
    // (Tests can pin the schedule with cfg.SCHEDULE_OVERRIDE = [{game, variant}, ...])
    const pinned = this.cfg.SCHEDULE_OVERRIDE;
    this.schedule =
      Array.isArray(pinned) && pinned.length > 0
        ? Array.from({ length: this.rounds }, (_, i) => pinned[i % pinned.length])
        : games.buildSchedule(this.rounds);
    this.beginIntro();
    return null;
  }

  backToLobby(playerId) {
    if (playerId !== this.hostId) return 'Only the host can do that.';
    if (this.phase !== 'final') return 'The match is still running.';
    this.phase = 'lobby';
    this.game = null;
    this.participants = new Set();
    this.results = null;
    this.final = null;
    this.intro = null;
    this.arena = null;
    for (const p of this.players.values()) p.ready = false;
    this.broadcastState();
    return null;
  }

  beginIntro() {
    this.round += 1;
    this.slot = this.schedule[this.round - 1];
    this.intro = games.describeSlot(this.slot);
    if (this.rage) {
      // Rage Bait has no stamina, so drop any instruction line that talks about it.
      const rest = this.intro.instructions.filter((line) => !/stamina/i.test(line));
      this.intro = { ...this.intro, instructions: ['RAGE BAIT: shoves launch you across the arena, everything is harder, and there is no stamina. Good luck!', ...rest] };
    }
    this.arena = games.arenaFor(this.slot, { rage: this.rage });
    this.mapId = null;
    if (games.usesMaps(this.slot)) {
      const rng = this.gameOptions.rng || Math.random;
      this.mapId = chooseMap(this.mapPick, rng);
      const map = getMap(this.mapId);
      this.arena = { ...this.arena, floor: map.rows, mapId: map.id, mapName: map.name };
      if (map.id !== 'classic') this.intro = { ...this.intro, instructions: [`MAP: ${map.name} - ${map.note}`, ...this.intro.instructions] };
    }
    this.game = null;
    this.participants = new Set();
    this.results = null;
    this.phase = 'intro';
    this.phaseEndsAt = Date.now() + this.cfg.INTRO_MS;
    this.broadcastState();
  }

  beginPlaying() {
    const participants = this.connectedPlayers().map((p) => ({ id: p.id, name: p.name }));
    if (participants.length === 0) {
      this.resetToLobby();
      return;
    }
    this.participants = new Set(participants.map((p) => p.id));
    // Power-ups bought in the pit stop become per-player multipliers for this round.
    const mods = {};
    for (const p of participants) {
      const pl = this.players.get(p.id);
      if (pl && pl.power.length) mods[p.id] = powerups.combine(pl.power.map((x) => x.id));
    }
    this.game = games.createGame(this.slot, participants, { ...this.gameOptions, mods, rage: this.rage, mapId: this.mapId });
    this.phase = 'playing';
    this.finishAt = 0;
    this.phaseEndsAt = 0;
    this.broadcastState();
  }

  beginResults() {
    const rows = this.game.results();
    const players = this.players;
    const company = rows.filter((r) => !r.abandoned).length >= 2;
    if (company) this.hadCompany = true;
    const outRows = rows.map((r) => {
      const p = players.get(r.id);
      if (p) p.score += r.points;
      const reward = roundReward(r, company ? 2 : 1);
      if (p) {
        p.purse += reward.coins; // the same amount also fills the pit-stop purse
        p.power = []; // this round's power-ups are used up
      }
      return {
        ...r,
        coins: reward.coins,
        coinParts: reward.parts,
        name: p ? p.name : 'Player',
        color: p ? p.color : 0,
        hat: p ? p.hat : 0,
        skin: p ? p.skin : 0,
        back: p ? p.back : 0,
        total: p ? p.score : 0,
      };
    });
    this.results = {
      matchId: this.matchId(),
      round: this.round,
      rounds: this.rounds,
      game: this.slot ? this.slot.game : '', // lets the browser's trophy case know which minigame this was
      variant: this.slot ? this.slot.variant : '',
      map: this.mapId || '',
      rage: this.rage,
      players: rows.filter((r) => !r.abandoned).length,
      rows: outRows,
    };
    this.phase = 'results';
    this.phaseEndsAt = Date.now() + this.cfg.RESULTS_MS;
    this.broadcastState();
  }

  beginFinal() {
    const list = [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, color: p.color, hat: p.hat, skin: p.skin, back: p.back, score: p.score, connected: p.connected }))
      .sort((a, b) => b.score - a.score);
    let place = 1;
    list.forEach((e, i) => {
      if (i > 0 && e.score !== list[i - 1].score) place = i + 1;
      e.place = place;
    });
    for (const e of list) e.bonus = finalReward(e, this.hadCompany);
    this.final = { matchId: this.matchId(), players: list.length, rounds: this.rounds, standings: list, winners: list.filter((e) => e.place === 1).map((e) => e.id) };
    this.phase = 'final';
    this.phaseEndsAt = 0;
    this.game = null;
    this.broadcastState();
  }

  // ------------------------------------------------------------ pit stop
  // Skip the shop when nobody could afford even the cheapest power-up.
  pitstopWorthIt() {
    if (!(this.cfg.PITSTOP_MS > 0)) return false;
    const cheapest = powerups.cheapestPrice();
    return this.connectedPlayers().some((p) => p.purse >= cheapest);
  }

  beginPitstop() {
    for (const p of this.players.values()) p.done = false;
    this.phase = 'pitstop';
    this.phaseEndsAt = Date.now() + this.cfg.PITSTOP_MS;
    this.broadcastState();
  }

  // Last place (when there are 3+ players) pays less. Ties for last all count.
  isUnderdog(player) {
    const list = [...this.players.values()];
    if (list.length < 3) return false;
    const lowest = Math.min(...list.map((p) => p.score));
    const highest = Math.max(...list.map((p) => p.score));
    return lowest < highest && player.score === lowest;
  }

  buyPowerup(playerId, id) {
    const p = this.players.get(playerId);
    if (!p) return 'You are not in this room.';
    if (this.phase !== 'pitstop') return 'The pit stop is only open between rounds.';
    const def = powerups.getPowerup(id);
    if (!def) return 'No such power-up.';
    if (p.power.some((x) => x.id === def.id)) return 'You already have that one.';
    if (p.power.length >= powerups.MAX_SLOTS) return `You can carry ${powerups.MAX_SLOTS} power-ups at most.`;
    const price = powerups.priceFor(def, this.isUnderdog(p));
    if (p.purse < price) return `You need ${price - p.purse} more coins for that.`;
    p.purse -= price;
    p.power.push({ id: def.id, paid: price });
    p.done = false;
    this.broadcastState();
    return null;
  }

  // Changed your mind? Until the pit stop closes you get every coin back.
  refundPowerup(playerId, id) {
    const p = this.players.get(playerId);
    if (!p) return 'You are not in this room.';
    if (this.phase !== 'pitstop') return 'The pit stop is only open between rounds.';
    const i = p.power.findIndex((x) => x.id === id);
    if (i < 0) return 'You do not have that power-up.';
    p.purse += p.power[i].paid;
    p.power.splice(i, 1);
    this.broadcastState();
    return null;
  }

  setShopDone(playerId, done) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== 'pitstop') return;
    p.done = done !== false;
    this.broadcastState();
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.game = null;
    this.participants = new Set();
    this.results = null;
    this.final = null;
    for (const p of this.players.values()) p.ready = false;
    this.broadcastState();
  }

  // ------------------------------------------------------------------ input
  setInput(playerId, input) {
    if (this.phase !== 'playing' || !this.game || !this.participants.has(playerId)) return;
    this.game.setInput(playerId, input);
  }

  // ------------------------------------------------------------------ loop
  // Called every server tick (before step) to move between phases.
  updatePhases(now) {
    // Players who stayed disconnected too long lose their seat.
    for (const p of [...this.players.values()]) {
      if (!p.connected && now - p.disconnectedAt > this.cfg.RECONNECT_GRACE_MS) this.removePlayer(p.id);
    }

    if (this.phase === 'intro' && now >= this.phaseEndsAt) {
      this.beginPlaying();
    } else if (this.phase === 'playing' && this.game) {
      if (this.game.isFinished()) {
        if (!this.finishAt) this.finishAt = now + this.cfg.ROUND_END_DELAY_MS;
        if (now >= this.finishAt) this.beginResults();
      }
    } else if (this.phase === 'results' && now >= this.phaseEndsAt) {
      if (this.round >= this.rounds) this.beginFinal();
      else if (this.pitstopWorthIt()) this.beginPitstop();
      else this.beginIntro();
    } else if (this.phase === 'pitstop') {
      const live = this.connectedPlayers();
      const everyoneDone = live.length > 0 && live.every((p) => p.done);
      if (now >= this.phaseEndsAt || everyoneDone) this.beginIntro();
    }
  }

  // Advance the simulation by one fixed step.
  step(dt) {
    if (this.phase === 'playing' && this.game) this.game.tick(dt);
  }

  // Send the current world to everybody in the room.
  flushSnapshot() {
    if (this.phase !== 'playing' || !this.game) return;
    // Games with secrets (Prop Hunt) send each player their own view.
    if (this.game.perViewer) {
      const people = this.connectedPlayers();
      const views = this.game.snapshotsByViewer(people.map((p) => p.id));
      for (const p of people) {
        // volatile = if this player's connection is clogged, DROP the picture instead of queueing it
        // (the next one comes in 33 ms anyway). Queued old pictures are what makes lag grow and grow.
        if (p.socketId) this.io.to(p.socketId).volatile.emit('game:snap', encodeSnap(views.get(p.id) || views.get('*')));
      }
      return;
    }
    this.io.to(this.code).volatile.emit('game:snap', encodeSnap(this.game.snapshot()));
  }

  shouldClose(now) {
    if (this.players.size === 0) return true;
    const anyone = this.connectedPlayers().length > 0;
    return !anyone && now - this.lastConnectedAt > this.cfg.EMPTY_ROOM_TTL_MS;
  }

  // ------------------------------------------------------------------ state
  publicState() {
    const now = Date.now();
    return {
      code: this.code,
      matchId: this.matchId(),
      hostId: this.hostId,
      isPublic: this.isPublic,
      rage: this.rage,
      mapPick: this.mapPick,
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      allowedRounds: this.cfg.ALLOWED_ROUNDS,
      minPlayers: this.cfg.MIN_PLAYERS_TO_START,
      maxPlayers: this.maxPlayers,
      playerCap: this.cfg.MAX_PLAYERS,
      minRoomSize: 2,
      endsInMs: this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - now) : 0,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        hat: p.hat,
        skin: p.skin,
        back: p.back,
        ready: p.ready,
        connected: p.connected,
        score: p.score,
        inRound: this.participants.has(p.id),
        purse: p.purse,
        power: p.power.map((x) => x.id),
        done: p.done,
        underdog: this.isUnderdog(p),
      })),
      powerups: this.cfg.PITSTOP_MS > 0 ? powerups.catalogue() : [],
      maxPowerSlots: powerups.MAX_SLOTS,
      intro: this.phase === 'lobby' || this.phase === 'final' ? null : this.intro,
      arena: this.phase === 'lobby' || this.phase === 'final' ? null : this.arena,
      results: this.phase === 'results' ? this.results : null,
      final: this.phase === 'final' ? this.final : null,
    };
  }

  broadcastState() {
    this.io.to(this.code).emit('room:state', this.publicState());
  }
}

// ===========================================================================
class RoomManager {
  constructor(io, cfg, gameOptions) {
    this.io = io;
    this.cfg = cfg;
    this.gameOptions = gameOptions;
    this.rooms = new Map();
    this.chatOn = cfg.CHAT_ENABLED !== false; // the server admin can switch chat off for everybody
  }

  create() {
    if (this.rooms.size >= this.cfg.MAX_ROOMS) return null;
    const code = makeRoomCode((c) => this.rooms.has(c));
    if (!code) return null;
    const room = new Room(this.io, code, this.cfg, this.gameOptions);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(code) || null;
  }

  // Rooms whose host chose "public": joinable ones first (waiting in the lobby),
  // then rooms already playing (late joiners are welcome). Full or empty rooms
  // are left out, and the list is capped so it can never become huge.
  listPublic(limit = 30) {
    const out = [];
    for (const room of this.rooms.values()) {
      if (!room.isPublic || room.isFull() || room.connectedPlayers().length === 0) continue;
      out.push(room.listing());
    }
    const waiting = (r) => (r.phase === 'lobby' || r.phase === 'final' ? 0 : 1);
    out.sort((a, b) => waiting(a) - waiting(b) || b.players - a.players || a.code.localeCompare(b.code));
    return out.slice(0, limit);
  }

  // Admin tools -----------------------------------------------------------------
  // Removes one player from a room and tells their browser (so it goes back to the title screen).
  kickPlayer(code, playerId, reason = 'The host of this server removed you from the room.') {
    const room = this.rooms.get(code);
    const player = room && room.players.get(playerId);
    if (!room || !player) return false;
    const sid = player.socketId;
    room.removePlayer(playerId);
    this._detach(sid, reason);
    return true;
  }

  // Throws everybody out of a room and deletes it.
  closeRoom(code, reason = 'This room was closed by the server admin.') {
    const room = this.rooms.get(code);
    if (!room) return false;
    const sockets = [...room.players.values()].map((p) => p.socketId);
    this.rooms.delete(code);
    for (const sid of sockets) this._detach(sid, reason);
    return true;
  }

  _detach(socketId, reason) {
    if (!socketId) return;
    this.io.to(socketId).emit('room:kicked', { reason });
    const s = this.io.sockets && this.io.sockets.sockets && this.io.sockets.sockets.get(socketId);
    if (s) {
      if (s.data.roomCode) s.leave(s.data.roomCode);
      s.data.roomCode = null;
      s.data.playerId = null;
    }
  }

  // Everything the admin panel shows. Never includes reconnect tokens or socket ids.
  overview() {
    const rooms = [];
    for (const room of this.rooms.values()) {
      const host = room.players.get(room.hostId);
      rooms.push({
        code: room.code,
        host: host ? host.name : '?',
        phase: room.phase,
        round: room.round,
        rounds: room.rounds,
        isPublic: room.isPublic,
        rage: room.rage,
        chatCount: room.chat.length,
        max: room.maxPlayers,
        players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
      });
    }
    rooms.sort((a, b) => b.players.length - a.players.length || a.code.localeCompare(b.code));
    return rooms.slice(0, 200);
  }

  // Called each server tick.
  update(now) {
    for (const [code, room] of this.rooms) {
      if (room.shouldClose(now)) {
        this.rooms.delete(code);
        continue;
      }
      room.updatePhases(now);
    }
  }
}

module.exports = { Room, RoomManager };
