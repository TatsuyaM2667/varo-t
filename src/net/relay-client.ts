/**
 * Browser side of the relay connection: lobby state, pings, and routing of
 * in-match traffic to the Lockstep.
 */
import { NET } from '../config/net';
import {
  type ClientMsg,
  type ErrorCode,
  type LobbyPlayer,
  type MatchSetup,
  type RoomConfig,
  type ServerMsg,
  type InputPacket,
  decodeInputs,
} from './protocol';

export interface LobbyState {
  code: string;
  host: number;
  players: LobbyPlayer[];
  config: RoomConfig;
  state: 'lobby' | 'game';
}

export function relayUrl(params: URLSearchParams, loc: Location = location): string {
  const override = params.get('relay');
  if (override) return override.replace(/\/+$/, '');
  return /^(localhost|127\.|\[::1\])/.test(loc.hostname) && !params.has('liveRelay') ? NET.devRelayUrl : NET.relayUrl;
}

export class RelayClient {
  slot = -1;
  lobby: LobbyState | null = null;
  /** conservative round trip (smoothed + 2 × mean deviation, as TCP does): sizes the input delay */
  rtt = 0;
  private srtt = 0;
  private rttVar = 0;
  onLobby: (l: LobbyState) => void = () => {};
  onStart: (s: MatchSetup) => void = () => {};
  /** connection lost or refused (code is set when the room refused us) */
  onClose: (code: ErrorCode | null) => void = () => {};
  onInputs: (p: InputPacket) => void = () => {};
  onLeft: (slot: number, tick: number) => void = () => {};
  onHash: (slot: number, tick: number, h: number) => void = () => {};
  private readonly ws: WebSocket;
  private ping = 0;
  private closed = false;
  private error: ErrorCode | null = null;

  constructor(
    base: string,
    readonly code: string,
    name: string,
    build: string,
  ) {
    this.ws = new WebSocket(`${base}/room/${code}`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.addEventListener('open', () => {
      this.send({ t: 'hello', name, build });
      this.sendPing();
      this.ping = window.setInterval(() => this.sendPing(), NET.pingIntervalMs);
    });
    this.ws.addEventListener('message', (ev) => this.receive(ev.data as string | ArrayBuffer));
    this.ws.addEventListener('close', () => this.shutdown());
    this.ws.addEventListener('error', () => this.shutdown());
  }

  /** Resolves once the room accepted us; rejects with the refusal code (or null for network errors). */
  joined(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.slot >= 0) return resolve();
      const prevLobby = this.onLobby;
      const prevClose = this.onClose;
      this.onLobby = (l) => {
        this.onLobby = prevLobby;
        this.onClose = prevClose;
        resolve();
        prevLobby(l);
      };
      this.onClose = (c) => {
        this.onLobby = prevLobby;
        this.onClose = prevClose;
        reject(c);
      };
    });
  }

  get isHost(): boolean {
    return !!this.lobby && this.lobby.host === this.slot;
  }

  send(msg: ClientMsg): void {
    this.raw(JSON.stringify(msg));
  }

  raw(data: string | ArrayBuffer): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.ping);
    try {
      this.ws.close(1000);
    } catch {
      /* ignore */
    }
  }

  private sendPing(): void {
    this.send({ t: 'ping', c: performance.now(), rtt: this.rtt });
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      const p = decodeInputs(data);
      if (p) this.onInputs(p);
      return;
    }
    let m: ServerMsg;
    try {
      m = JSON.parse(data) as ServerMsg;
    } catch {
      return;
    }
    switch (m.t) {
      case 'welcome':
        this.slot = m.slot;
        break;
      case 'lobby':
        this.lobby = { code: m.code, host: m.host, players: m.players, config: m.config, state: m.state };
        this.onLobby(this.lobby);
        break;
      case 'start':
        this.onStart(m.setup);
        break;
      case 'left':
        this.onLeft(m.slot, m.tick);
        break;
      case 'hash':
        this.onHash(m.slot, m.tick, m.h);
        break;
      case 'pong': {
        const r = performance.now() - m.c;
        if (!this.srtt) {
          this.srtt = r;
          this.rttVar = r / 2;
        } else {
          this.rttVar = this.rttVar * 0.75 + Math.abs(this.srtt - r) * 0.25;
          this.srtt = this.srtt * 0.875 + r * 0.125;
        }
        this.rtt = this.srtt + 2 * this.rttVar;
        break;
      }
      case 'error':
        this.error = m.code;
        break;
    }
  }

  private shutdown(): void {
    window.clearInterval(this.ping);
    if (this.closed) return;
    this.closed = true;
    this.onClose(this.error);
  }
}
