'use strict';

// ---------------------------------------------------------------------------
// TRADES between two players in the same room (give / sell coins and cosmetics).
//
// HOW IT WORKS (a "trade window", like in many games):
//   1. A asks B to trade.  B accepts (or says no).
//   2. Each side puts coins and/or items into the window. Whenever anybody changes their side,
//      both "Accept" buttons are switched off again, so nobody can swap something in at the last moment.
//   3. When BOTH have pressed Accept for the same version of the offer, the server asks each browser to
//      double-check it can really do it ("confirm"). Only when both say yes does the server announce
//      "done" and each browser moves its own coins/items.
//
// IMPORTANT, HONEST LIMIT: the server does NOT keep anybody's wallet (wallets live in each player's own
// browser - see public/js/shop.js). So the server cannot check that an offer is real. This is a
// trade between people who trust each other, like swapping cards with friends. What the server DOES
// guarantee: only people in the same room, one trade at a time, nothing changes without both people's
// Accept on the exact same offer, offers are range-checked, no spamming, and a finished trade is
// announced to both sides (and re-sent if somebody's connection dropped at the wrong moment).
// ---------------------------------------------------------------------------

const { randomId, safeInt } = require('./util');

const KINDS = ['hat', 'skin', 'back', 'color'];
const TRADE_PHASES = new Set(['lobby', 'final']);

function emptySide() {
  return { coins: 0, items: [], accepted: 0 }; // accepted = the offer version this person accepted (0 = not accepted)
}

class TradeBook {
  constructor(room) {
    this.room = room;
    this.trades = new Map(); // trade id -> trade
    this.byPlayer = new Map(); // player id -> trade id
    this.done = new Map(); // player id -> a finished trade that this player's browser has not confirmed yet
    this.lastRequest = new Map(); // player id -> time of their last request (anti-spam)
  }

  get cfg() {
    return this.room.cfg;
  }

  limits() {
    return {
      maxItems: this.cfg.TRADE_MAX_ITEMS ?? 6,
      maxCoins: this.cfg.TRADE_MAX_COINS ?? 99999,
      timeoutMs: this.cfg.TRADE_TIMEOUT_MS ?? 180000,
      gapMs: this.cfg.TRADE_REQUEST_GAP_MS ?? 1500,
    };
  }

  // ---------------------------------------------------------------- helpers
  _socketOf(playerId) {
    const p = this.room.players.get(playerId);
    return p && p.connected && p.socketId ? p.socketId : null;
  }

  _send(playerId, event, data) {
    const sid = this._socketOf(playerId);
    if (sid) this.room.io.to(sid).emit(event, data);
  }

  _other(trade, id) {
    return trade.a === id ? trade.b : trade.a;
  }

  _view(trade, id) {
    const other = this._other(trade, id);
    const op = this.room.players.get(other);
    const side = (s) => ({ coins: s.coins, items: s.items.map((i) => ({ ...i })), accepted: s.accepted === trade.rev && trade.rev > 0 });
    return {
      id: trade.id,
      state: trade.state, // 'invite' | 'open' | 'confirming'
      rev: trade.rev,
      initiator: trade.a === id, // true when YOU asked for the trade
      with: { id: other, name: op ? op.name : '?' },
      mine: side(trade.sides[id]),
      theirs: side(trade.sides[other]),
    };
  }

  _push(trade) {
    for (const id of [trade.a, trade.b]) this._send(id, 'trade:state', this._view(trade, id));
  }

  _end(trade, reason, notify = true) {
    this.trades.delete(trade.id);
    for (const id of [trade.a, trade.b]) {
      if (this.byPlayer.get(id) === trade.id) this.byPlayer.delete(id);
      if (notify) this._send(id, 'trade:closed', { id: trade.id, reason, done: false });
    }
  }

  _cleanItems(list) {
    if (!Array.isArray(list)) return null;
    const { maxItems } = this.limits();
    if (list.length > maxItems) return null;
    const counts = { hat: this.cfg.HAT_COUNT, skin: this.cfg.SKIN_COUNT, back: this.cfg.BACK_COUNT, color: this.cfg.COLOR_COUNT };
    const out = [];
    const seen = new Set();
    for (const it of list) {
      if (!it || typeof it !== 'object' || !KINDS.includes(it.kind)) return null;
      if (!Number.isInteger(it.index) || it.index < 1 || it.index >= counts[it.kind]) return null; // 0 = the free default, never traded
      const key = `${it.kind}:${it.index}`;
      if (seen.has(key)) return null;
      seen.add(key);
      out.push({ kind: it.kind, index: it.index });
    }
    return out;
  }

  _mine(playerId, tradeId) {
    const trade = this.trades.get(tradeId);
    if (!trade || (trade.a !== playerId && trade.b !== playerId)) return null;
    return trade;
  }

  // ---------------------------------------------------------------- actions (each returns an error text or null)
  request(fromId, toId) {
    const { gapMs } = this.limits();
    if (!TRADE_PHASES.has(this.room.phase)) return 'Trading is only open in the lobby (not during a match).';
    const from = this.room.players.get(fromId);
    const to = typeof toId === 'string' ? this.room.players.get(toId) : null;
    if (!from || !to) return 'That player is not here.';
    if (fromId === toId) return 'You cannot trade with yourself.';
    if (!to.connected) return 'That player is offline right now.';
    const now = Date.now();
    if (now - (this.lastRequest.get(fromId) || 0) < gapMs) return 'Slow down a little!';
    this.lastRequest.set(fromId, now);
    if (this.byPlayer.has(fromId)) return 'Finish or cancel your current trade first.';
    if (this.byPlayer.has(toId)) return `${to.name} is busy trading with somebody else.`;
    const trade = {
      id: randomId(6),
      a: fromId,
      b: toId,
      state: 'invite',
      rev: 0,
      sides: { [fromId]: emptySide(), [toId]: emptySide() },
      commits: {},
      createdAt: now,
    };
    this.trades.set(trade.id, trade);
    this.byPlayer.set(fromId, trade.id);
    this.byPlayer.set(toId, trade.id);
    this._push(trade);
    return null;
  }

  // The invited player says yes (answer true) or no (false).
  answer(playerId, tradeId, yes) {
    const trade = this._mine(playerId, tradeId);
    if (!trade) return 'That trade is over.';
    if (trade.state !== 'invite' || trade.b !== playerId) return 'Nothing to answer.';
    if (!yes) {
      this._end(trade, `${this.room.players.get(playerId).name} said no thanks.`);
      return null;
    }
    trade.state = 'open';
    trade.rev = 1;
    this._push(trade);
    return null;
  }

  cancel(playerId, tradeId) {
    const trade = this._mine(playerId, tradeId);
    if (!trade) return null;
    const p = this.room.players.get(playerId);
    this._end(trade, `${p ? p.name : 'Somebody'} cancelled the trade.`);
    return null;
  }

  // Changes YOUR side of the offer. Everybody's Accept is cleared.
  offer(playerId, tradeId, data) {
    const trade = this._mine(playerId, tradeId);
    if (!trade) return 'That trade is over.';
    if (trade.state !== 'open') return 'You cannot change the offer right now.';
    if (!data || typeof data !== 'object') return 'Bad offer.';
    const { maxCoins } = this.limits();
    const coins = Number(data.coins);
    if (!Number.isInteger(coins) || coins < 0 || coins > maxCoins) return `Coins must be a whole number from 0 to ${maxCoins}.`;
    const items = this._cleanItems(data.items);
    if (!items) return 'That list of items is not allowed.';
    const side = trade.sides[playerId];
    side.coins = coins;
    side.items = items;
    trade.rev += 1;
    trade.commits = {};
    this._push(trade);
    return null;
  }

  // Presses Accept for offer version `rev` (the version the player was looking at).
  accept(playerId, tradeId, rev) {
    const trade = this._mine(playerId, tradeId);
    if (!trade) return 'That trade is over.';
    if (trade.state !== 'open') return 'Not open for accepting.';
    if (rev !== trade.rev) return 'The offer just changed - look at it again.';
    const [sa, sb] = [trade.sides[trade.a], trade.sides[trade.b]];
    if (sa.coins === 0 && sb.coins === 0 && sa.items.length === 0 && sb.items.length === 0) return 'Put something in the trade first.';
    trade.sides[playerId].accepted = trade.rev;
    if (sa.accepted === trade.rev && sb.accepted === trade.rev) {
      trade.state = 'confirming';
      trade.commits = {};
      this._push(trade);
      for (const id of [trade.a, trade.b]) this._send(id, 'trade:confirm', { id: trade.id, rev: trade.rev });
    } else {
      this._push(trade);
    }
    return null;
  }

  // Each browser answers the "confirm" question: can I really do this trade? (ok = true / false)
  commit(playerId, tradeId, rev, ok) {
    const trade = this._mine(playerId, tradeId);
    if (!trade || trade.state !== 'confirming' || rev !== trade.rev) return null;
    if (ok !== true) {
      const p = this.room.players.get(playerId);
      this._end(trade, `${p ? p.name : 'Somebody'} cannot do this trade right now (not enough coins, or already owns an item).`);
      return null;
    }
    trade.commits[playerId] = true;
    if (trade.commits[trade.a] && trade.commits[trade.b]) this._finish(trade);
    return null;
  }

  _finish(trade) {
    this.trades.delete(trade.id);
    for (const id of [trade.a, trade.b]) {
      if (this.byPlayer.get(id) === trade.id) this.byPlayer.delete(id);
      const other = this._other(trade, id);
      const give = trade.sides[id];
      const get = trade.sides[other];
      const payload = {
        id: trade.id,
        done: true,
        with: { id: other, name: (this.room.players.get(other) || { name: '?' }).name },
        give: { coins: give.coins, items: give.items.map((i) => ({ ...i })) },
        get: { coins: get.coins, items: get.items.map((i) => ({ ...i })) },
      };
      this.done.set(id, payload);
      this._send(id, 'trade:done', payload);
    }
  }

  // The browser says it has moved its coins/items.
  ack(playerId, tradeId) {
    const d = this.done.get(playerId);
    if (d && d.id === tradeId) this.done.delete(playerId);
  }

  // A browser that reconnects asks for anything it may have missed.
  resend(playerId) {
    const d = this.done.get(playerId);
    if (d) this._send(playerId, 'trade:done', d);
    const id = this.byPlayer.get(playerId);
    const trade = id ? this.trades.get(id) : null;
    if (trade) this._send(playerId, 'trade:state', this._view(trade, playerId));
  }

  // ---------------------------------------------------------------- clean-up
  playerGone(playerId, reason = 'The other player left.') {
    const id = this.byPlayer.get(playerId);
    const trade = id ? this.trades.get(id) : null;
    if (trade) this._end(trade, reason);
    this.lastRequest.delete(playerId);
  }

  // A player who dropped out of the connection mid-way: only an open window is cancelled.
  playerOffline(playerId) {
    const id = this.byPlayer.get(playerId);
    const trade = id ? this.trades.get(id) : null;
    if (trade) this._end(trade, 'The other player lost their connection.');
  }

  cancelAll(reason) {
    for (const trade of [...this.trades.values()]) this._end(trade, reason);
  }

  tick(now) {
    if (this.trades.size && !TRADE_PHASES.has(this.room.phase)) {
      this.cancelAll('The match is starting, so the trade was cancelled.');
      return;
    }
    const { timeoutMs } = this.limits();
    for (const trade of [...this.trades.values()]) {
      if (now - trade.createdAt > timeoutMs) this._end(trade, 'The trade took too long and was cancelled.');
    }
  }
}

module.exports = { TradeBook, KINDS, TRADE_PHASES, safeInt };
