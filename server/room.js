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
const games = require('./games');
const { roundReward, finalReward } = require('./rewards');

class Room {
  constructor(io, code, cfg, gameOptions) {
    this.io = io;
    this.code = code;
    this.cfg = cfg;
    this.gameOptions = gameOptions || {};

    this.players = new Map(); // id -> player record (insertion order = join order)
    this.hostId = null;

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
    return this.players.size >= this.cfg.MAX_PLAYERS;
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
    if (this.isFull()) throw new Error('That room is full (8 players max).');
    const player = {
      id: randomId(4),
      token: randomId(16),
      name: this.uniqueName(info.name),
      color: safeInt(info.color, 0, this.cfg.COLOR_COUNT - 1, 0),
      hat: safeInt(info.hat, 0, this.cfg.HAT_COUNT - 1, 0),
      skin: safeInt(info.skin, 0, this.cfg.SKIN_COUNT - 1, 0),
      ready: false,
      connected: true,
      socketId: null,
      score: 0,
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
    this.broadcastState();
  }

  setReady(playerId, ready) {
    const p = this.players.get(playerId);
    if (!p || (this.phase !== 'lobby' && this.phase !== 'final')) return;
    p.ready = ready === true;
    this.broadcastState();
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
    this.arena = games.arenaFor(this.slot);
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
    this.game = games.createGame(this.slot, participants, this.gameOptions);
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
      return {
        ...r,
        coins: reward.coins,
        coinParts: reward.parts,
        name: p ? p.name : 'Player',
        color: p ? p.color : 0,
        hat: p ? p.hat : 0,
        skin: p ? p.skin : 0,
        total: p ? p.score : 0,
      };
    });
    this.results = { matchId: this.matchId(), round: this.round, rounds: this.rounds, rows: outRows };
    this.phase = 'results';
    this.phaseEndsAt = Date.now() + this.cfg.RESULTS_MS;
    this.broadcastState();
  }

  beginFinal() {
    const list = [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, color: p.color, hat: p.hat, skin: p.skin, score: p.score, connected: p.connected }))
      .sort((a, b) => b.score - a.score);
    let place = 1;
    list.forEach((e, i) => {
      if (i > 0 && e.score !== list[i - 1].score) place = i + 1;
      e.place = place;
    });
    for (const e of list) e.bonus = finalReward(e, this.hadCompany);
    this.final = { matchId: this.matchId(), standings: list, winners: list.filter((e) => e.place === 1).map((e) => e.id) };
    this.phase = 'final';
    this.phaseEndsAt = 0;
    this.game = null;
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
      if (this.round < this.rounds) this.beginIntro();
      else this.beginFinal();
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
        if (p.socketId) this.io.to(p.socketId).emit('game:snap', views.get(p.id) || views.get('*'));
      }
      return;
    }
    this.io.to(this.code).emit('game:snap', this.game.snapshot());
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
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      allowedRounds: this.cfg.ALLOWED_ROUNDS,
      minPlayers: this.cfg.MIN_PLAYERS_TO_START,
      maxPlayers: this.cfg.MAX_PLAYERS,
      endsInMs: this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - now) : 0,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        hat: p.hat,
        skin: p.skin,
        ready: p.ready,
        connected: p.connected,
        score: p.score,
        inRound: this.participants.has(p.id),
      })),
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
