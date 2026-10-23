import { describe, expect, it } from 'vitest';
import { NET } from '../../src/config/net';
import { FixedStep } from '../../src/sim/core/fixed-step';
import { Rng } from '../../src/sim/core/rng';
import { Btn, type InputFrame } from '../../src/sim/input-frame';
import { STAGES } from '../../src/sim/map/registry';
import { InputLog, RoundReplay } from '../../src/sim/replay/input-log';
import { World } from '../../src/sim/world';
import { Lockstep, runLockstepTicks } from '../../src/net/lockstep';
import {
  type InputPacket,
  type MatchSetup,
  type ServerMsg,
  buildMatch,
  computeDelay,
  decodeInputs,
  encodeInputs,
  randomRoomCode,
  ROOM_CODE_RE,
  sanitizeConfig,
} from '../../src/net/protocol';
import { type Conn, RoomCore } from '../../src/net/room';

const FEATURES = { destructibles: true, seededMap: false, utilityAi: true };

function setup(players: MatchSetup['players'], mode: 'coop' | 'versus' = 'coop', delay = 5): MatchSetup {
  return { seed: 1234, config: { mode, stage: 0, enemies: 3, teamSize: 3 }, players, delay, features: FEATURES };
}

describe('protocol', () => {
  it('round-trips input packets', () => {
    const frames: InputFrame[] = [
      { buttons: Btn.Forward | Btn.Fire, yaw: 65535, pitch: -9000 },
      { buttons: 0, yaw: 0, pitch: 12000 },
    ];
    const p = decodeInputs(encodeInputs(4242, frames, 0xbeef))!;
    expect(p.firstTick).toBe(4242);
    expect(p.match).toBe(0xbeef);
    expect(p.slot).toBe(255);
    expect(p.frames).toEqual(frames);
    expect(decodeInputs(new ArrayBuffer(3))).toBeNull();
  });

  it('builds identical rosters for coop and versus', () => {
    const coop = buildMatch(setup([{ slot: 2, name: 'B', team: 1 }, { slot: 0, name: 'A', team: 0 }]));
    expect(coop.options.roster.map((r) => [r.team, r.isBot])).toEqual([
      [0, false],
      [0, false],
      [1, true],
      [1, true],
      [1, true],
    ]);
    expect(coop.agentOfSlot.get(0)).toBe(0);
    expect(coop.agentOfSlot.get(2)).toBe(1);
    expect(coop.humanIds).toEqual([0, 1]);
    expect(coop.options.mapId).toBe(STAGES[0].map);

    const vs = buildMatch(setup([{ slot: 0, name: 'A', team: 0 }, { slot: 1, name: 'B', team: 1 }, { slot: 3, name: 'C', team: 1 }], 'versus'));
    const teams = vs.options.roster.map((r) => `${r.team}${r.isBot ? 'b' : 'h'}`).join(' ');
    expect(teams).toBe('0h 0b 0b 1h 1h 1b');
    expect(vs.humanIds).toEqual([0, 3, 4]);
  });

  it('picks a delay that covers the round trip and stays in bounds', () => {
    expect(computeDelay([])).toBe(NET.minDelayTicks);
    expect(computeDelay([60])).toBeGreaterThanOrEqual(Math.ceil(60 / (1000 / 60)));
    expect(computeDelay([5000])).toBe(NET.maxDelayTicks);
  });

  it('validates room codes and configs', () => {
    const r = new Rng(9);
    for (let i = 0; i < 50; i++) expect(ROOM_CODE_RE.test(randomRoomCode(() => r.float()))).toBe(true);
    expect(ROOM_CODE_RE.test('AB0O')).toBe(false);
    expect(sanitizeConfig({ mode: 'versus', stage: 99, teamSize: 2 } as never)).toEqual({ mode: 'versus', stage: 0, enemies: 0, teamSize: 2 });
  });
});

// ------------------------------------------------------------------ network sim

/** A relay room with per-link latency; delivery order per link is preserved (like a WebSocket). */
class FakeNet {
  now = 0;
  private queue: { at: number; to: (d: string | ArrayBuffer) => void; data: string | ArrayBuffer }[] = [];
  private lastAt = new Map<unknown, number>();
  constructor(
    private readonly rng: Rng,
    private readonly latency: [number, number],
  ) {}
  link(key: unknown, to: (d: string | ArrayBuffer) => void, latency = this.latency): (d: string | ArrayBuffer) => void {
    return (data) => {
      const lat = latency[0] + this.rng.float() * (latency[1] - latency[0]);
      const at = Math.max(this.lastAt.get(key) ?? 0, this.now + lat);
      this.lastAt.set(key, at);
      // copy binary payloads: the room stamps the slot in place
      this.queue.push({ at, to, data: typeof data === 'string' ? data : data.slice(0) });
    };
  }

  /** run `fn` at now + ms (the room's timers) */
  later(fn: () => void, ms: number): void {
    this.queue.push({ at: this.now + ms, to: fn, data: '' });
  }
}

interface Client {
  slot: number;
  conn: Conn;
  inbox: (d: string | ArrayBuffer) => void;
  ls?: Lockstep;
  world?: World;
  log?: InputLog;
  step: FixedStep;
  rng: Rng;
  gone: boolean;
  frameMs: number;
  nextFrame: number;
  hashes: Map<number, number>;
}

/**
 * Plays a full online match headlessly: a RoomCore relay, N clients with
 * jittery frame rates and random latency, random human inputs. `direct`
 * lists the client pairs (by creation index) that have a peer-to-peer
 * channel (fast, 2–12 ms); the others exchange inputs through the relay.
 */
function playOnline(opts: { players: number; mode: 'coop' | 'versus'; ticks: number; leaveAt?: { slot: number; ms: number }; direct?: [number, number][] }) {
  const rng = new Rng(77);
  const net = new FakeNet(rng, [15, 70]);
  const room = new RoomCore('TEST', () => rng.float(), (fn, ms) => net.later(fn, ms));
  const clients: Client[] = [];
  for (let i = 0; i < opts.players; i++) {
    const c = { slot: -1, step: new FixedStep(1 / 60), rng: new Rng(100 + i), gone: false, frameMs: 1000 / (50 + i * 23), nextFrame: 0, hashes: new Map() } as Client;
    // client → room and room → client links
    const toRoom = net.link(`up${i}`, (d) => room.message(c.conn, d));
    c.inbox = (d) => onServer(c, d);
    c.conn = { send: net.link(`down${i}`, (d) => !c.gone && c.inbox(d)), close: () => {} };
    (c as Client & { up: typeof toRoom }).up = toRoom;
    room.open(c.conn);
    toRoom(JSON.stringify({ t: 'hello', name: `P${i}`, build: 'test' }));
    clients.push(c);
  }
  const up = (c: Client) => (c as Client & { up: (d: string | ArrayBuffer) => void }).up;
  const direct = new Map<string, (d: string | ArrayBuffer) => void>();
  for (const [a, b] of opts.direct ?? []) {
    for (const [from, to] of [[a, b], [b, a]]) {
      const dst = clients[to];
      direct.set(`${from}>${to}`, net.link(`p2p${from}>${to}`, (d) => {
        if (dst.gone || typeof d === 'string') return;
        const p = decodeInputs(d);
        if (p) deliver(dst, { ...p, slot: clients[from].slot });
      }, [2, 12]));
    }
  }
  /** what RelayClient does with input packets: hold them until the match starts */
  const early = new Map<Client, InputPacket[]>();
  const deliver = (c: Client, p: InputPacket) => {
    if (c.ls) c.ls.receiveInputs(p.slot, p.firstTick, p.frames, p.match);
    else early.set(c, [...(early.get(c) ?? []), p]);
  };
  /** what RelayClient.sendInputs does: direct where possible, the relay if anyone lacks a channel */
  const sendInputs = (c: Client) => (buf: ArrayBuffer) => {
    const i = clients.indexOf(c);
    let viaRelay = false;
    clients.forEach((o, j) => {
      if (o === c || o.gone) return;
      const d = direct.get(`${i}>${j}`);
      if (d) d(buf);
      else viaRelay = true;
    });
    if (viaRelay) up(c)(buf);
  };

  function onServer(c: Client, d: string | ArrayBuffer): void {
    if (typeof d !== 'string') {
      const p = decodeInputs(d);
      if (p) deliver(c, p);
      return;
    }
    const m = JSON.parse(d) as ServerMsg;
    if (m.t === 'welcome') c.slot = m.slot;
    else if (m.t === 'lobby' && m.state === 'lobby' && m.players.length === opts.players && m.host === c.slot && !c.ls) {
      if (opts.mode === 'versus' && m.config.mode !== 'versus') up(c)(JSON.stringify({ t: 'config', config: { ...m.config, mode: 'versus', teamSize: 2 } }));
      else up(c)(JSON.stringify({ t: 'start', features: FEATURES }));
    } else if (m.t === 'start') {
      c.ls = new Lockstep({
        setup: m.setup,
        localSlot: c.slot,
        sendInputs: sendInputs(c),
        sendControl: (msg) => up(c)(JSON.stringify(msg)),
        onDesync: (tick) => {
          throw new Error(`desync at ${tick}`);
        },
      });
      const built = buildMatch(m.setup);
      c.world = new World(built.options);
      c.world.startMatch();
      c.log = new InputLog(built.options, built.humanIds);
      for (const p of early.get(c) ?? []) deliver(c, p);
      early.delete(c);
    } else if (m.t === 'leaving') c.ls?.receiveLeaving(m.slot);
    else if (m.t === 'left') c.ls?.receiveLeft(m.slot, m.tick, m.from, m.source);
    else if (m.t === 'fill') c.ls?.receiveFill(m.slot, m.first, m.data);
    else if (m.t === 'hash') c.ls?.receiveHash(m.slot, m.tick, m.h);
  }

  // random but sticky inputs: hold a direction/fire for a while
  const held = new Map<Client, number>();
  const sample = (c: Client) => (): InputFrame => {
    if (c.rng.float() < 0.05) held.set(c, Math.floor(c.rng.float() * 0x1ff) & ~(Btn.Crouch | Btn.Walk));
    return { buttons: held.get(c) ?? 0, yaw: Math.floor(c.rng.float() * 2000) + (c.slot * 9000), pitch: 0 };
  };

  let guard = 0;
  while (clients.some((c) => !c.gone && (c.world?.tick ?? 0) < opts.ticks) && guard++ < 400_000) {
    net.now += 1;
    deliverAll(net);
    if (opts.leaveAt && net.now === opts.leaveAt.ms) {
      const c = clients.find((x) => x.slot === opts.leaveAt!.slot)!;
      c.gone = true;
      room.close(c.conn);
    }
    for (const c of clients) {
      if (c.gone || !c.ls || !c.world || net.now < c.nextFrame) continue;
      c.nextFrame = net.now + c.frameMs * (0.7 + c.rng.float() * 0.6);
      let steps = c.step.advance(c.frameMs / 1000);
      const lag = c.ls.lagBehind(c.world.tick);
      if (lag >= NET.catchUpTicks) steps += Math.min(NET.maxCatchUpPerFrame, lag - NET.catchUpTicks + 1);
      const ran = runLockstepTicks(c.ls, c.world, steps, {
        sample: sample(c),
        record: (r, f) => c.log!.record(r, f),
        converted: (a, r, t) => c.log!.recordConversion(a, r, t),
        afterTick: () => {
          if (c.world!.tick % 60 === 0) c.hashes.set(c.world!.tick, c.world!.hash());
        },
      });
      if (ran < steps) c.step.reset();
    }
  }
  return { clients, now: net.now };
}

function deliverAll(net: FakeNet): void {
  // FakeNet.deliver with a straightforward loop (kept separate for clarity)
  const q = (net as unknown as { queue: { at: number; to: (d: string | ArrayBuffer) => void; data: string | ArrayBuffer }[] }).queue;
  q.sort((a, b) => a.at - b.at);
  while (q.length && q[0].at <= net.now) {
    const m = q.shift()!;
    (m.to as (d: string | ArrayBuffer) => void)(m.data);
  }
}

function commonHashes(a: Map<number, number>, b: Map<number, number>): number {
  let n = 0;
  for (const [t, h] of a) {
    if (!b.has(t)) continue;
    expect(b.get(t), `tick ${t}`).toBe(h);
    n++;
  }
  return n;
}

describe('online lockstep', () => {
  it('stays identical when every pair is peer-to-peer', () => {
    const { clients } = playOnline({ players: 4, mode: 'coop', ticks: 1500, direct: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] });
    for (const c of clients) expect(c.world!.tick).toBeGreaterThanOrEqual(1500);
    expect(commonHashes(clients[0].hashes, clients[3].hashes)).toBeGreaterThan(20);
    expect(clients.every((c) => !c.ls!.desynced)).toBe(true);
  }, 60_000);

  it('keeps three coop clients bit-identical under jitter and latency', () => {
    const { clients } = playOnline({ players: 3, mode: 'coop', ticks: 1500 });
    for (const c of clients) expect(c.world!.tick).toBeGreaterThanOrEqual(1500);
    expect(commonHashes(clients[0].hashes, clients[1].hashes)).toBeGreaterThan(20);
    expect(commonHashes(clients[0].hashes, clients[2].hashes)).toBeGreaterThan(20);
    expect(clients.every((c) => !c.ls!.desynced)).toBe(true);
  }, 60_000);

  it('versus: a player who leaves becomes a bot at the same tick everywhere, and replays stay exact', () => {
    // mixed paths: the leaver talks to one player directly and to the other through the relay
    const { clients } = playOnline({ players: 3, mode: 'versus', ticks: 9000, leaveAt: { slot: 1, ms: 9000 }, direct: [[0, 1], [0, 2]] });
    const [a, c] = clients.filter((x) => !x.gone);
    expect(commonHashes(a.hashes, c.hashes)).toBeGreaterThan(100);
    const leaver = a.ls!.agentOfSlot(1);
    expect(a.world!.agents[leaver].isBot).toBe(true);
    expect(c.world!.agents[leaver].isBot).toBe(true);
    expect(a.log!.conversions).toEqual(c.log!.conversions);
    expect(a.log!.conversions).toHaveLength(1);

    // the round containing the conversion re-simulates bit-exactly from the log
    const conv = a.log!.conversions[0];
    expect(a.world!.match.history.length).toBeGreaterThan(conv.round);
    const replay = new RoundReplay(a.log!, conv.round);
    while (replay.step()) {
      /* run to the end of the recorded round */
    }
    expect(replay.world.agents[leaver].isBot).toBe(true);
    const [result] = replay.world.match.history;
    expect(result).toEqual(a.world!.match.history[conv.round]);
  }, 60_000);
});

describe('relay room', () => {
  const conn = () => {
    const got: ServerMsg[] = [];
    let closed = false;
    const c: Conn = { send: (d) => typeof d === 'string' && got.push(JSON.parse(d)), close: () => (closed = true) };
    return { c, got, closed: () => closed };
  };
  const hello = (room: RoomCore, c: Conn, build = 'b1') => {
    room.open(c);
    room.message(c, JSON.stringify({ t: 'hello', name: '<Bob>', build }));
  };

  it('admits up to four players, balances sides, and refuses the rest', () => {
    const room = new RoomCore('ABCD', () => 0.5);
    const cs = Array.from({ length: 5 }, conn);
    cs.slice(0, 4).forEach((x) => hello(room, x.c));
    const lobby = cs[0].got.filter((m) => m.t === 'lobby').at(-1)!;
    expect(lobby.t === 'lobby' && lobby.players.map((p) => p.team)).toEqual([0, 1, 0, 1]);
    expect(lobby.t === 'lobby' && lobby.players[0].name).toBe('Bob');
    hello(room, cs[4].c);
    expect(cs[4].got).toContainEqual({ t: 'error', code: 'full' });
    expect(cs[4].closed()).toBe(true);
  });

  it('refuses other builds and joins during a match; hands the host on', () => {
    const room = new RoomCore('ABCD', () => 0.25);
    const [h, g, late, old] = Array.from({ length: 4 }, conn);
    hello(room, h.c);
    hello(room, old.c, 'b0');
    expect(old.got).toContainEqual({ t: 'error', code: 'version' });
    hello(room, g.c);
    room.message(g.c, JSON.stringify({ t: 'start', features: FEATURES })); // not the host: ignored
    expect(g.got.some((m) => m.t === 'start')).toBe(false);
    room.message(h.c, JSON.stringify({ t: 'start', features: FEATURES }));
    const start = g.got.find((m) => m.t === 'start');
    expect(start && start.t === 'start' && start.setup.players).toHaveLength(2);
    hello(room, late.c);
    expect(late.got).toContainEqual({ t: 'error', code: 'inGame' });
    room.close(h.c);
    expect(g.got).toContainEqual({ t: 'leaving', slot: 0 });
    room.message(g.c, JSON.stringify({ t: 'known', slot: 0, next: 321 }));
    expect(g.got).toContainEqual({ t: 'left', slot: 0, tick: 321, from: 321, source: 1 });
    const lobby = g.got.filter((m) => m.t === 'lobby').at(-1)!;
    expect(lobby.t === 'lobby' && lobby.host).toBe(1);
  });
});
