/**
 * Delay-based lockstep. Every client simulates tick t only once it holds
 * every active human's input for t. Local input made while simulating tick t
 * is scheduled for tick t + delay and sent to the others right away, so
 * with delay ≥ one-way latency nobody ever waits.
 *
 * Transport-agnostic: `sendInputs` hands out encoded packets (peer-to-peer
 * or through the relay), `sendControl` goes to the relay, `receive*` takes
 * what arrived. Pure TS (Node tests drive it with a fake network).
 *
 * Leaving: inputs mostly travel peer-to-peer, so the relay cannot know how
 * far a leaver got. It announces `leaving`; everyone stops accepting that
 * player's inputs and reports how far they have them (`known`); the relay
 * picks the furthest (nobody can have simulated past their own), and that
 * client re-sends the missing frames to the others (`fill`). The bot takes
 * over at that tick on every client.
 */
import { NET } from '../config/net';
import type { InputFrame } from '../sim/input-frame';
import type { World } from '../sim/world';
import { type ClientMsg, type MatchSetup, buildMatch, encodeInputs, matchTag } from './protocol';
import { packInput, unpackInput } from '../sim/replay/input-log';

export interface LockstepOptions {
  setup: MatchSetup;
  localSlot: number;
  /** our input packets, to every other player */
  sendInputs(data: ArrayBuffer): void;
  /** control messages to the relay */
  sendControl(msg: ClientMsg): void;
  /** called when two clients disagree about the state at some tick */
  onDesync?(tick: number, slot: number): void;
}

export class Lockstep {
  readonly delay: number;
  /** ticks per input packet */
  readonly batch: number;
  readonly localAgent: number;
  /** tag of this match's input packets (see matchTag) */
  readonly tag: number;
  readonly humanIds: number[];
  private readonly slotAgent: Map<number, number>;
  /** next tick whose input is still missing, per human agent (contiguous receipt) */
  private readonly known = new Map<number, number>();
  /** tick → inputs by agent id */
  private readonly frames = new Map<number, (InputFrame | undefined)[]>();
  /** humans that left: agent id → first tick simulated as a bot */
  private readonly leftAt = new Map<number, number>();
  /** humans announced as leaving: their inputs are no longer accepted (except fills) */
  private readonly frozen = new Set<number>();
  /** every remote input seen, by agent then tick (for fills) */
  private readonly archive = new Map<number, InputFrame[]>();
  /** next local input tick to generate */
  private nextLocal: number;
  private pending: InputFrame[] = [];
  private pendingFirst = 0;
  private readonly hashes = new Map<number, number>();
  private readonly remoteHashes: { slot: number; tick: number; h: number }[] = [];
  desynced = false;

  constructor(private readonly o: LockstepOptions) {
    const built = buildMatch(o.setup);
    this.delay = o.setup.delay;
    this.batch = Math.max(1, o.setup.batch ?? NET.sendEveryTicks);
    this.tag = matchTag(o.setup);
    this.slotAgent = built.agentOfSlot;
    this.humanIds = built.humanIds;
    this.localAgent = built.agentOfSlot.get(o.localSlot) ?? -1;
    for (const id of this.humanIds) this.known.set(id, this.delay);
    this.nextLocal = this.delay;
    this.pendingFirst = this.delay;
  }

  /**
   * Make local inputs up to tick `simTick + delay` (call before stepping
   * `simTick`). `sample` is the input device; one call per generated tick.
   */
  pumpLocal(simTick: number, sample: () => InputFrame): void {
    if (this.localAgent < 0) return;
    while (this.nextLocal <= simTick + this.delay) {
      const f = sample();
      this.put(this.localAgent, this.nextLocal, f);
      this.known.set(this.localAgent, this.nextLocal + 1);
      if (!this.pending.length) this.pendingFirst = this.nextLocal;
      this.pending.push(f);
      this.nextLocal++;
      if (this.pending.length >= this.batch) this.flush();
    }
  }

  /** Send the partial batch now. Call whenever the sim stalls, or two stalled clients would wait on each other forever. */
  flush(): void {
    if (!this.pending.length) return;
    this.o.sendInputs(encodeInputs(this.pendingFirst, this.pending, this.tag));
    this.pending = [];
  }

  /** `match`: the packet's tag; packets of another match are ignored. */
  receiveInputs(slot: number, firstTick: number, frames: readonly InputFrame[], match = this.tag): void {
    if (match !== this.tag) return;
    const agent = this.slotAgent.get(slot);
    if (agent === undefined || agent === this.localAgent || this.frozen.has(agent)) return;
    this.accept(agent, firstTick, frames);
  }

  private accept(agent: number, firstTick: number, frames: readonly InputFrame[]): void {
    const left = this.leftAt.get(agent);
    let arch = this.archive.get(agent);
    if (!arch) this.archive.set(agent, (arch = []));
    let next = this.known.get(agent) ?? this.delay;
    frames.forEach((f, i) => {
      const t = firstTick + i;
      if (left !== undefined && t >= left) return;
      if (arch[t] !== undefined) return; // duplicate (peer-to-peer and relay both delivered it)
      arch[t] = f;
      this.put(agent, t, f);
      if (t === next) next++;
    });
    // packets may arrive out of order (two paths): advance over whatever is contiguous
    while (arch[next] !== undefined) next++;
    this.known.set(agent, next);
  }

  /** The relay says `slot` disconnected: stop taking its inputs and report how far we have them. */
  receiveLeaving(slot: number): void {
    const agent = this.slotAgent.get(slot);
    if (agent === undefined || agent === this.localAgent) return;
    this.frozen.add(agent);
    this.o.sendControl({ t: 'known', slot, next: this.known.get(agent) ?? this.delay });
  }

  /**
   * From `tick` on a bot plays `slot`'s agent. Players are missing frames
   * from `from`; if we are the `source`, we send them.
   */
  receiveLeft(slot: number, tick: number, from = tick, source = -1): void {
    const agent = this.slotAgent.get(slot);
    if (agent === undefined || this.leftAt.has(agent)) return;
    this.frozen.add(agent);
    this.leftAt.set(agent, Math.max(this.delay, tick));
    if (source !== this.o.localSlot || from >= tick) return;
    const arch = this.archive.get(agent) ?? [];
    const data: number[] = [];
    for (let t = Math.max(this.delay, from); t < tick; t++) data.push(...packInput(arch[t]));
    this.o.sendControl({ t: 'fill', slot, first: Math.max(this.delay, from), data });
  }

  /** Frames of a leaver re-sent by the player who had the most of them. */
  receiveFill(slot: number, first: number, data: readonly number[]): void {
    const agent = this.slotAgent.get(slot);
    if (agent === undefined || agent === this.localAgent) return;
    const frames: InputFrame[] = [];
    for (let i = 0; i + 1 < data.length; i += 2) {
      const f = unpackInput(data[i] >>> 0, data[i + 1] >>> 0);
      if (!f) break;
      frames.push(f);
    }
    this.accept(agent, first, frames);
  }

  private put(agent: number, tick: number, f: InputFrame): void {
    let row = this.frames.get(tick);
    if (!row) {
      row = [];
      this.frames.set(tick, row);
    }
    row[agent] = f;
  }

  private active(agent: number, tick: number): boolean {
    const left = this.leftAt.get(agent);
    return left === undefined || tick < left;
  }

  /** All inputs for `tick` are here (ticks before `delay` are implicitly empty). */
  ready(tick: number): boolean {
    if (tick < this.delay) return true;
    for (const id of this.humanIds) if (this.active(id, tick) && (this.known.get(id) ?? 0) <= tick) return false;
    return true;
  }

  /**
   * How many ticks we trail the other players: in step, their inputs reach
   * about `tick + delay`; anything beyond that means they are ahead of us.
   */
  lagBehind(tick: number): number {
    let lag = Infinity;
    for (const id of this.humanIds) {
      if (id === this.localAgent || !this.active(id, tick)) continue;
      lag = Math.min(lag, (this.known.get(id) ?? 0) - tick - this.delay);
    }
    return lag === Infinity ? 0 : Math.max(0, lag);
  }

  agentOfSlot(slot: number): number {
    return this.slotAgent.get(slot) ?? -1;
  }

  /** Agents that turn into bots right before `tick` is simulated. */
  conversionsAt(tick: number): number[] {
    const out: number[] = [];
    for (const [agent, t] of this.leftAt) if (t === tick) out.push(agent);
    return out;
  }

  /** Inputs for `tick` by agent id (undefined = hold still); frees them. */
  take(tick: number): (InputFrame | undefined)[] {
    const row = this.frames.get(tick) ?? [];
    this.frames.delete(tick);
    for (const id of this.humanIds) if (!this.active(id, tick)) row[id] = undefined;
    return row;
  }

  /** Record our state hash after simulating `tick` (shared every NET.hashEveryTicks). */
  noteHash(tick: number, h: number): void {
    if (tick % NET.hashEveryTicks !== 0) return;
    this.hashes.set(tick, h);
    this.o.sendControl({ t: 'hash', tick, h });
    this.checkHashes();
  }

  receiveHash(slot: number, tick: number, h: number): void {
    this.remoteHashes.push({ slot, tick, h });
    this.checkHashes();
  }

  private checkHashes(): void {
    for (let i = this.remoteHashes.length - 1; i >= 0; i--) {
      const r = this.remoteHashes[i];
      const mine = this.hashes.get(r.tick);
      if (mine === undefined) continue;
      this.remoteHashes.splice(i, 1);
      if (mine !== r.h && !this.desynced) {
        this.desynced = true;
        this.o.onDesync?.(r.tick, r.slot);
      }
    }
    // keep the table small
    if (this.hashes.size > 32) {
      const oldest = [...this.hashes.keys()].sort((a, b) => a - b).slice(0, this.hashes.size - 32);
      for (const k of oldest) this.hashes.delete(k);
    }
  }
}

export interface TickHooks {
  /** local input device, sampled once per generated tick */
  sample(): InputFrame;
  /** before each tick: record the inputs (replay log) */
  record?(round: number, frames: readonly (InputFrame | undefined)[]): void;
  /** a leaver's agent becomes a bot right before this tick */
  converted?(agent: number, round: number, roundTick: number): void;
  afterTick?(): void;
}

/**
 * Run up to `steps` lockstep ticks of `w`. Returns how many ran; fewer
 * means we are waiting for someone's input (the partial batch is flushed).
 */
export function runLockstepTicks(ls: Lockstep, w: World, steps: number, h: TickHooks): number {
  for (let i = 0; i < steps; i++) {
    ls.pumpLocal(w.tick, h.sample);
    if (!ls.ready(w.tick)) {
      ls.flush();
      return i;
    }
    for (const agent of ls.conversionsAt(w.tick)) {
      h.converted?.(agent, w.round.index, w.round.tick);
      w.convertToBot(agent);
    }
    const frames = ls.take(w.tick);
    h.record?.(w.round.index, frames);
    w.step(frames);
    if (w.tick % NET.hashEveryTicks === 0) ls.noteHash(w.tick, w.hash());
    h.afterTick?.();
  }
  return steps;
}
