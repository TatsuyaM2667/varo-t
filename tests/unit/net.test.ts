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
    const p = decodeInputs(encodeInputs(4242, frames))!;
    expect(p.firstTick).toBe(4242);
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
  link(key: unknown, to: (d: string | ArrayBuffer) => void): (d: string | ArrayBuffer) => void {
    return (data) => {
      const lat = this.latency[0] + this.rng.float() * (this.latency[1] - this.latency[0]);
      const at = Math.max(this.lastAt.get(key) ?? 0, this.now + lat);
      this.lastAt.set(key, at);
      // copy binary payloads: the room stamps the slot in place
      this.queue.push({ at, to, data: typeof data === 'string' ? data : data.slice(0) });
    };
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
 * jittery frame rates and random latency, random human inputs. Returns the
 * clients so tests can compare their worlds.
 */
function playOnline(opts: { players: number; mode: 'coop' | 'versus'; ticks: number; leaveAt?: { slot: number; ms: number } }) {
  const rng = new Rng(77);
  const net = new FakeNet(rng, [15, 70]);
  const room = new RoomCore('TEST', () => rng.float());
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

  function onServer(c: Client, d: string | ArrayBuffer): void {
    if (typeof d !== 'string') {
      const p = decodeInputs(d);
      if (p) c.ls?.receiveInputs(p.slot, p.firstTick, p.frames);
      return;
    }
    const m = JSON.parse(d) as ServerMsg;
    if (m.t === 'welcome') c.slot = m.slot;
    else if (m.t === 'lobby' && m.state === 'lobby' && m.players.length === opts.players && m.host === c.slot && !c.ls) {
      if (opts.mode === 'versus' && m.config.mode !== 'versus') up(c)(JSON.stringify({ t: 'config', config: { ...m.config, mode: 'versus', teamSize: 2 } }));
      else up(c)(JSON.stringify({ t: 'start', features: FEATURES }));
    } else if (m.t === 'start') {
      c.ls = new Lockstep({ setup: m.setup, localSlot: c.slot, send: up(c), onDesync: (tick) => { throw new Error(`desync at ${tick}`); } });
      const built = buildMatch(m.setup);
      c.world = new World(built.options);
      c.world.startMatch();
      c.log = new InputLog(built.options, built.humanIds);
    } else if (m.t === 'left') c.ls?.receiveLeft(m.slot, m.tick);
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
    m.to(m.data);
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
  it('keeps three coop clients bit-identical under jitter and latency', () => {
    const { clients } = playOnline({ players: 3, mode: 'coop', ticks: 1500 });
    for (const c of clients) expect(c.world!.tick).toBeGreaterThanOrEqual(1500);
    expect(commonHashes(clients[0].hashes, clients[1].hashes)).toBeGreaterThan(20);
    expect(commonHashes(clients[0].hashes, clients[2].hashes)).toBeGreaterThan(20);
    expect(clients.every((c) => !c.ls!.desynced)).toBe(true);
  }, 60_000);

  it('versus: a player who leaves becomes a bot at the same tick everywhere, and replays stay exact', () => {
    const { clients } = playOnline({ players: 3, mode: 'versus', ticks: 9000, leaveAt: { slot: 1, ms: 9000 } });
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
    const left = g.got.find((m) => m.t === 'left');
    expect(left && left.t === 'left' && left.slot).toBe(0);
    const lobby = g.got.filter((m) => m.t === 'lobby').at(-1)!;
    expect(lobby.t === 'lobby' && lobby.host).toBe(1);
  });
});
