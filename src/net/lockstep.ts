/**
 * Delay-based lockstep. Every client simulates tick t only once it holds
 * every active human's input for t. Local input made while simulating tick t
 * is scheduled for tick t + delay and sent to the others right away, so
 * with delay ≥ one-way latency nobody ever waits.
 *
 * Transport-agnostic: `send` hands out encoded packets, `receive*` takes
 * what the relay delivered. Pure TS (Node tests drive it with a fake relay).
 */
import { NET } from '../config/net';
import type { InputFrame } from '../sim/input-frame';
import type { World } from '../sim/world';
import { type MatchSetup, buildMatch, encodeInputs } from './protocol';

export interface LockstepOptions {
  setup: MatchSetup;
  localSlot: number;
  send(data: ArrayBuffer | string): void;
  /** called when two clients disagree about the state at some tick */
  onDesync?(tick: number, slot: number): void;
}

export class Lockstep {
  readonly delay: number;
  readonly localAgent: number;
  readonly humanIds: number[];
  private readonly slotAgent: Map<number, number>;
  /** next tick whose input is still missing, per human agent (contiguous receipt) */
  private readonly known = new Map<number, number>();
  /** tick → inputs by agent id */
  private readonly frames = new Map<number, (InputFrame | undefined)[]>();
  /** humans that left: agent id → first tick simulated as a bot */
  private readonly leftAt = new Map<number, number>();
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
      if (this.pending.length >= NET.sendEveryTicks) this.flush();
    }
  }

  /** Send the partial batch now. Call whenever the sim stalls, or two stalled clients would wait on each other forever. */
  flush(): void {
    if (!this.pending.length) return;
    this.o.send(encodeInputs(this.pendingFirst, this.pending));
    this.pending = [];
  }

  receiveInputs(slot: number, firstTick: number, frames: readonly InputFrame[]): void {
    const agent = this.slotAgent.get(slot);
    if (agent === undefined || agent === this.localAgent) return;
    const left = this.leftAt.get(agent);
    let next = this.known.get(agent) ?? this.delay;
    frames.forEach((f, i) => {
      const t = firstTick + i;
      if (left !== undefined && t >= left) return;
      this.put(agent, t, f);
      if (t === next) next++;
    });
    // packets arrive in order through the relay, but be tolerant of gaps
    while (this.frames.get(next)?.[agent] !== undefined) next++;
    this.known.set(agent, next);
  }

  /** The relay says `slot` disconnected; from `tick` on a bot plays that agent. */
  receiveLeft(slot: number, tick: number): void {
    const agent = this.slotAgent.get(slot);
    if (agent === undefined || this.leftAt.has(agent)) return;
    this.leftAt.set(agent, Math.max(this.delay, tick));
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
    this.o.send(JSON.stringify({ t: 'hash', tick, h }));
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
