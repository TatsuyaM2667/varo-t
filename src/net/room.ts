/**
 * One multiplayer room: lobby state, WebRTC signaling, and the fallback
 * input relay. Runs inside the relay Worker's Durable Object
 * (server/relay.ts) and in unit tests. It never simulates anything.
 */
import { NET } from '../config/net';
import {
  type ClientMsg,
  DEFAULT_ROOM_CONFIG,
  INPUT_HEADER,
  INPUT_STRIDE,
  KIND_INPUTS,
  type LobbyPlayer,
  type MatchSetup,
  type RoomConfig,
  type ServerMsg,
  computeDelay,
  sanitizeConfig,
  sanitizeName,
} from './protocol';

export interface Conn {
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

interface Player extends LobbyPlayer {
  conn: Conn;
  build: string;
}

/** A leaver whose takeover tick is being agreed on. */
interface PendingLeave {
  slot: number;
  waiting: Set<number>;
  replies: Map<number, number>;
  done: boolean;
}

/** Traffic counters (what the Worker is billed for is `msgsIn`, at 1/20 request each). */
export interface RoomTraffic {
  connects: number;
  msgsIn: number;
  bytesIn: number;
  msgsOut: number;
  bytesOut: number;
  matches: number;
}

export interface RoomSnapshot {
  code: string;
  state: 'lobby' | 'game';
  config: RoomConfig;
  players: { slot: number; name: string; team: 0 | 1; rtt: number; p2p: number[] }[];
}

/** How long to wait for `known` replies before deciding a leaver's takeover tick. */
const LEAVE_TIMEOUT_MS = 3000;

export class RoomCore {
  private readonly players: Player[] = [];
  private readonly waiting = new Set<Conn>();
  private host = -1;
  private config: RoomConfig = { ...DEFAULT_ROOM_CONFIG };
  private state: 'lobby' | 'game' = 'lobby';
  private readonly leaves: PendingLeave[] = [];
  readonly traffic: RoomTraffic = { connects: 0, msgsIn: 0, bytesIn: 0, msgsOut: 0, bytesOut: 0, matches: 0 };

  constructor(
    readonly code: string,
    private readonly rand: () => number,
    private readonly schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
  ) {}

  get playerCount(): number {
    return this.players.length;
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      state: this.state,
      config: { ...this.config },
      players: this.players.map(({ slot, name, team, rtt, p2p }) => ({ slot, name, team, rtt, p2p: [...p2p] })),
    };
  }

  open(conn: Conn): void {
    this.traffic.connects++;
    this.waiting.add(conn);
  }

  message(conn: Conn, data: string | ArrayBuffer): void {
    this.traffic.msgsIn++;
    this.traffic.bytesIn += typeof data === 'string' ? data.length : data.byteLength;
    const p = this.players.find((x) => x.conn === conn);
    if (typeof data !== 'string') {
      if (p && this.state === 'game') this.relayInputs(p, data);
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data) as ClientMsg;
    } catch {
      return;
    }
    if (!p) {
      if (msg.t === 'hello' && this.waiting.has(conn)) this.hello(conn, msg.name, msg.build);
      return;
    }
    switch (msg.t) {
      case 'ping': {
        const before = p.rtt;
        p.rtt = typeof msg.rtt === 'number' && msg.rtt >= 0 && msg.rtt < 10_000 ? Math.round(msg.rtt) : p.rtt;
        this.send(p.conn, { t: 'pong', c: msg.c });
        // keep the lobby's ping column roughly current
        if (this.state === 'lobby' && (Math.abs(p.rtt - before) >= 10 || (!before && p.rtt))) this.broadcastLobby();
        break;
      }
      case 'config':
        if (p.slot === this.host && this.state === 'lobby') {
          this.config = sanitizeConfig(msg.config);
          this.broadcastLobby();
        }
        break;
      case 'team':
        if (this.state === 'lobby' && (msg.team === 0 || msg.team === 1)) {
          p.team = msg.team;
          this.broadcastLobby();
        }
        break;
      case 'start':
        if (p.slot === this.host && this.state === 'lobby') this.start(msg.features);
        break;
      case 'reset':
        if (p.slot === this.host && this.state === 'game') {
          this.state = 'lobby';
          this.broadcastLobby();
        }
        break;
      case 'hash':
        if (this.state === 'game') this.broadcast({ t: 'hash', slot: p.slot, tick: msg.tick, h: msg.h }, p);
        break;
      case 'signal': {
        const to = this.players.find((x) => x.slot === msg.to);
        if (to && to !== p) this.send(to.conn, { t: 'signal', from: p.slot, data: msg.data });
        break;
      }
      case 'links': {
        const slots = Array.isArray(msg.p2p) ? msg.p2p.filter((s) => Number.isInteger(s) && s !== p.slot).slice(0, NET.maxPlayers) : [];
        const changed = slots.join() !== p.p2p.join();
        p.p2p = slots;
        if (changed && this.state === 'lobby') this.broadcastLobby();
        break;
      }
      case 'known': {
        const leave = this.leaves.find((l) => l.slot === msg.slot && !l.done);
        if (leave && leave.waiting.has(p.slot) && Number.isInteger(msg.next)) {
          leave.waiting.delete(p.slot);
          leave.replies.set(p.slot, msg.next);
          if (!leave.waiting.size) this.finishLeave(leave);
        }
        break;
      }
      case 'fill':
        if (this.state === 'game' && Array.isArray(msg.data)) this.broadcast({ t: 'fill', slot: msg.slot, first: msg.first, data: msg.data }, p);
        break;
      default:
        break;
    }
  }

  close(conn: Conn): void {
    this.waiting.delete(conn);
    const i = this.players.findIndex((x) => x.conn === conn);
    if (i < 0) return;
    const [p] = this.players.splice(i, 1);
    for (const o of this.players) o.p2p = o.p2p.filter((s) => s !== p.slot);
    // a player we were waiting on for another leave won't answer now
    for (const l of this.leaves) {
      if (!l.done && l.waiting.delete(p.slot) && !l.waiting.size) this.finishLeave(l);
    }
    if (this.state === 'game') {
      if (this.players.length) {
        const leave: PendingLeave = { slot: p.slot, waiting: new Set(this.players.map((x) => x.slot)), replies: new Map(), done: false };
        this.leaves.push(leave);
        this.broadcast({ t: 'leaving', slot: p.slot });
        this.schedule(() => this.finishLeave(leave), LEAVE_TIMEOUT_MS);
      } else this.state = 'lobby';
    }
    if (p.slot === this.host) this.host = this.players[0]?.slot ?? -1;
    this.broadcastLobby();
  }

  /**
   * Everyone froze the leaver's input stream and told us how far they got.
   * Nobody can have simulated past their own count, so the furthest count is
   * a takeover tick everyone can reach once the furthest player fills in the rest.
   */
  private finishLeave(l: PendingLeave): void {
    if (l.done) return;
    l.done = true;
    this.leaves.splice(this.leaves.indexOf(l), 1);
    if (!l.replies.size || this.state !== 'game') return;
    let tick = -1;
    let from = Infinity;
    let source = -1;
    for (const [slot, next] of l.replies) {
      if (next > tick) {
        tick = next;
        source = slot;
      }
      from = Math.min(from, next);
    }
    this.broadcast({ t: 'left', slot: l.slot, tick, from, source });
  }

  private hello(conn: Conn, name: string, build: string): void {
    this.waiting.delete(conn);
    const reject = (code: 'full' | 'inGame' | 'version') => {
      this.send(conn, { t: 'error', code });
      conn.close(4000, code);
    };
    if (this.state === 'game') return reject('inGame');
    if (this.players.length >= NET.maxPlayers) return reject('full');
    if (this.players.length && this.players[0].build !== build) return reject('version');
    let slot = 0;
    while (this.players.some((x) => x.slot === slot)) slot++;
    const teams = [0, 1].map((t) => this.players.filter((x) => x.team === t).length);
    const p: Player = { slot, name: sanitizeName(name), team: teams[1] < teams[0] ? 1 : 0, rtt: 0, p2p: [], conn, build: String(build).slice(0, 40) };
    this.players.push(p);
    this.players.sort((a, b) => a.slot - b.slot);
    if (this.host < 0) this.host = slot;
    this.send(conn, { t: 'welcome', slot });
    this.broadcastLobby();
  }

  /** Every pair of players has a direct channel (in either direction). */
  private fullMesh(): boolean {
    return this.players.every((a) => this.players.every((b) => a === b || a.p2p.includes(b.slot) || b.p2p.includes(a.slot)));
  }

  private start(features: MatchSetup['features']): void {
    const batch = this.fullMesh() ? 1 : NET.sendEveryTicks;
    const delay = computeDelay(
      this.players.map((p) => p.rtt),
      batch,
    );
    const setup: MatchSetup = {
      seed: Math.floor(this.rand() * 0x100000000) >>> 0,
      config: { ...this.config },
      players: this.players.map((p) => ({ slot: p.slot, name: p.name, team: p.team })),
      delay,
      batch,
      features: {
        destructibles: !!features?.destructibles,
        seededMap: !!features?.seededMap,
        utilityAi: !!features?.utilityAi,
      },
    };
    this.state = 'game';
    this.traffic.matches++;
    this.broadcastLobby();
    this.broadcast({ t: 'start', setup });
  }

  /** Inputs for players without a direct channel to the sender. */
  private relayInputs(p: Player, data: ArrayBuffer): void {
    if (data.byteLength < INPUT_HEADER) return;
    const v = new DataView(data);
    if (v.getUint8(0) !== KIND_INPUTS) return;
    const count = v.getUint8(6);
    if (data.byteLength !== INPUT_HEADER + count * INPUT_STRIDE) return;
    v.setUint8(1, p.slot);
    for (const o of this.players) {
      if (o === p) continue;
      o.conn.send(data);
      this.traffic.msgsOut++;
      this.traffic.bytesOut += data.byteLength;
    }
  }

  private broadcastLobby(): void {
    this.broadcast({
      t: 'lobby',
      code: this.code,
      host: this.host,
      players: this.players.map(({ slot, name, team, rtt, p2p }) => ({ slot, name, team, rtt, p2p })),
      config: this.config,
      state: this.state,
    });
  }

  private broadcast(msg: ServerMsg, except?: Player): void {
    const s = JSON.stringify(msg);
    for (const p of this.players) if (p !== except) this.sendRaw(p.conn, s);
  }

  private send(conn: Conn, msg: ServerMsg): void {
    this.sendRaw(conn, JSON.stringify(msg));
  }

  private sendRaw(conn: Conn, s: string): void {
    this.traffic.msgsOut++;
    this.traffic.bytesOut += s.length;
    conn.send(s);
  }
}
