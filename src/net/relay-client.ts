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
import { PeerMesh } from './peers';

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
  /** where input packets go during a match (see setInputSink) */
  private inputSink: ((p: InputPacket) => void) | null = null;
  /** packets that arrived before our match started (a peer's direct channel can beat the relay's start message) */
  private early: InputPacket[] = [];
  onLeaving: (slot: number) => void = () => {};
  onLeft: (slot: number, tick: number, from: number, source: number) => void = () => {};
  onFill: (slot: number, first: number, data: number[]) => void = () => {};
  /** direct channels to the other players (created once the room admits us) */
  mesh: PeerMesh | null = null;
  onHash: (slot: number, tick: number, h: number) => void = () => {};
  private readonly ws: WebSocket;
  private ping = 0;
  private pings = 0;
  private inMatch = false;
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
      this.ping = window.setInterval(() => {
        // fewer relay messages during a match (they count against the free plan)
        if (!this.inMatch || ++this.pings % Math.round(NET.matchPingIntervalMs / NET.pingIntervalMs) === 0) this.sendPing();
      }, NET.pingIntervalMs);
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

  /**
   * Route input packets to the running match (null between matches). Packets
   * that came in early are handed over; the match drops other matches' ones.
   */
  setInputSink(sink: ((p: InputPacket) => void) | null): void {
    this.inputSink = sink;
    if (!sink) return;
    const early = this.early;
    this.early = [];
    for (const p of early) sink(p);
  }

  private deliverInputs(p: InputPacket): void {
    if (this.inputSink) this.inputSink(p);
    else if (this.early.length < 4096) this.early.push(p);
  }

  /** Relay pings are thinned out while a match runs. */
  setInMatch(on: boolean): void {
    this.inMatch = on;
  }

  /**
   * Send an input packet to the other players: directly where a channel is
   * open, through the relay if any of them has none.
   */
  sendInputs(buf: ArrayBuffer): void {
    const targets = (this.lobby?.players ?? []).map((p) => p.slot).filter((s) => s !== this.slot);
    if (!this.mesh || !this.mesh.sendInputs(buf, targets)) this.raw(buf);
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
    this.mesh?.close();
    try {
      this.ws.close(1000);
    } catch {
      /* ignore */
    }
  }

  /** Report the slowest input path: direct channel where open, else the relay. */
  private sendPing(): void {
    let worst = this.rtt;
    const others = (this.lobby?.players ?? []).filter((p) => p.slot !== this.slot);
    if (others.length) {
      worst = 0;
      for (const o of others) worst = Math.max(worst, this.mesh?.rttTo(o.slot) ?? this.rtt);
    }
    this.send({ t: 'ping', c: performance.now(), rtt: Math.round(worst) });
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      const p = decodeInputs(data);
      if (p) this.deliverInputs(p);
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
        if (typeof RTCPeerConnection !== 'undefined') {
          this.mesh = new PeerMesh(m.slot, (to, data) => this.send({ t: 'signal', to, data }));
          this.mesh.onInputs = (p) => this.deliverInputs(p);
          this.mesh.onLinks = (open) => this.send({ t: 'links', p2p: open });
        }
        break;
      case 'lobby':
        this.lobby = { code: m.code, host: m.host, players: m.players, config: m.config, state: m.state };
        this.mesh?.sync(m.players.map((p) => p.slot));
        this.onLobby(this.lobby);
        break;
      case 'signal':
        void this.mesh?.handleSignal(m.from, m.data as Parameters<PeerMesh['handleSignal']>[1]);
        break;
      case 'leaving':
        this.onLeaving(m.slot);
        break;
      case 'fill':
        this.onFill(m.slot, m.first, m.data);
        break;
      case 'start':
        this.onStart(m.setup);
        break;
      case 'left':
        this.onLeft(m.slot, m.tick, m.from, m.source);
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
    this.mesh?.close();
    if (this.closed) return;
    this.closed = true;
    this.onClose(this.error);
  }
}
