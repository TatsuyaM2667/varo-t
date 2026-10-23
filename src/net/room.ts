/**
 * One multiplayer room: lobby state and the input relay. Runs inside the
 * relay Worker's Durable Object (server/relay.ts) and in unit tests.
 * It never simulates anything: it forwards inputs in arrival order, which is
 * all lockstep needs, and decides the tick at which a leaver becomes a bot.
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
  /** one past the last input tick relayed for this player */
  nextTick: number;
}

export class RoomCore {
  private readonly players: Player[] = [];
  private readonly waiting = new Set<Conn>();
  private host = -1;
  private config: RoomConfig = { ...DEFAULT_ROOM_CONFIG };
  private state: 'lobby' | 'game' = 'lobby';

  constructor(
    readonly code: string,
    private readonly rand: () => number,
  ) {}

  get playerCount(): number {
    return this.players.length;
  }

  open(conn: Conn): void {
    this.waiting.add(conn);
  }

  message(conn: Conn, data: string | ArrayBuffer): void {
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
        send(conn, { t: 'pong', c: msg.c });
        // keep the lobby's ping column roughly current
        if (this.state === 'lobby' && Math.abs(p.rtt - before) >= 10) this.broadcastLobby();
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
      default:
        break;
    }
  }

  close(conn: Conn): void {
    this.waiting.delete(conn);
    const i = this.players.findIndex((x) => x.conn === conn);
    if (i < 0) return;
    const [p] = this.players.splice(i, 1);
    if (this.state === 'game') {
      // everyone has received this player's inputs up to nextTick − 1 (in order), so the bot takes over there
      this.broadcast({ t: 'left', slot: p.slot, tick: p.nextTick });
      if (!this.players.length) this.state = 'lobby';
    }
    if (p.slot === this.host) this.host = this.players[0]?.slot ?? -1;
    this.broadcastLobby();
  }

  private hello(conn: Conn, name: string, build: string): void {
    this.waiting.delete(conn);
    const reject = (code: 'full' | 'inGame' | 'version') => {
      send(conn, { t: 'error', code });
      conn.close(4000, code);
    };
    if (this.state === 'game') return reject('inGame');
    if (this.players.length >= NET.maxPlayers) return reject('full');
    if (this.players.length && this.players[0].build !== build) return reject('version');
    let slot = 0;
    while (this.players.some((x) => x.slot === slot)) slot++;
    const teams = [0, 1].map((t) => this.players.filter((x) => x.team === t).length);
    const p: Player = { slot, name: sanitizeName(name), team: teams[1] < teams[0] ? 1 : 0, rtt: 0, conn, build: String(build).slice(0, 40), nextTick: 0 };
    this.players.push(p);
    this.players.sort((a, b) => a.slot - b.slot);
    if (this.host < 0) this.host = slot;
    send(conn, { t: 'welcome', slot });
    this.broadcastLobby();
  }

  private start(features: MatchSetup['features']): void {
    const delay = computeDelay(this.players.map((p) => p.rtt));
    const setup: MatchSetup = {
      seed: Math.floor(this.rand() * 0x100000000) >>> 0,
      config: { ...this.config },
      players: this.players.map((p) => ({ slot: p.slot, name: p.name, team: p.team })),
      delay,
      features: {
        destructibles: !!features?.destructibles,
        seededMap: !!features?.seededMap,
        utilityAi: !!features?.utilityAi,
      },
    };
    for (const p of this.players) p.nextTick = delay;
    this.state = 'game';
    this.broadcastLobby();
    this.broadcast({ t: 'start', setup });
  }

  private relayInputs(p: Player, data: ArrayBuffer): void {
    if (data.byteLength < INPUT_HEADER) return;
    const v = new DataView(data);
    if (v.getUint8(0) !== KIND_INPUTS) return;
    const count = v.getUint8(6);
    if (data.byteLength !== INPUT_HEADER + count * INPUT_STRIDE) return;
    v.setUint8(1, p.slot);
    p.nextTick = Math.max(p.nextTick, v.getUint32(2) + count);
    for (const o of this.players) if (o !== p) o.conn.send(data);
  }

  private broadcastLobby(): void {
    this.broadcast({
      t: 'lobby',
      code: this.code,
      host: this.host,
      players: this.players.map(({ slot, name, team, rtt }) => ({ slot, name, team, rtt })),
      config: this.config,
      state: this.state,
    });
  }

  private broadcast(msg: ServerMsg, except?: Player): void {
    const s = JSON.stringify(msg);
    for (const p of this.players) if (p !== except) p.conn.send(s);
  }
}

function send(conn: Conn, msg: ServerMsg): void {
  conn.send(JSON.stringify(msg));
}
