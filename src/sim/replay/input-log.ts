import type { InputFrame } from '../input-frame';
import { World, type WorldOptions } from '../world';

/**
 * Per-round log of human inputs. Bots are deterministic functions of the
 * world, so (world options, round index, human inputs) fully define a round.
 * Each tick stores one packed frame per human: [buttons | pitch<<16, yaw].
 * A human who left a multiplayer match becomes a bot; `conversions` records
 * when, so re-simulation converts them at the same tick.
 */
export class InputLog {
  /** rounds[r][tick] = packed frames for the humans, in roster order */
  private readonly rounds = new Map<number, number[]>();
  readonly conversions: { agent: number; round: number; tick: number }[] = [];

  constructor(
    readonly options: WorldOptions,
    /** agent ids of the humans, in roster order */
    readonly humanIds: number[],
  ) {}

  record(round: number, inputs: readonly (InputFrame | undefined)[]): void {
    let arr = this.rounds.get(round);
    if (!arr) {
      arr = [];
      this.rounds.set(round, arr);
    }
    for (const id of this.humanIds) arr.push(...packInput(inputs[id]));
  }

  ticks(round: number): number {
    return (this.rounds.get(round)?.length ?? 0) / (2 * Math.max(1, this.humanIds.length));
  }

  has(round: number): boolean {
    return this.rounds.has(round);
  }

  roundsRecorded(): number[] {
    return [...this.rounds.keys()].sort((a, b) => a - b);
  }

  /** Human inputs for one tick, indexed by agent id (undefined for bots). */
  frameAt(round: number, tick: number, out: (InputFrame | undefined)[]): (InputFrame | undefined)[] {
    const arr = this.rounds.get(round);
    out.length = 0;
    const n = this.humanIds.length;
    for (let h = 0; h < n; h++) {
      const o = (tick * n + h) * 2;
      if (!arr || o + 1 >= arr.length) {
        out[this.humanIds[h]] = undefined;
        continue;
      }
      out[this.humanIds[h]] = unpackInput(arr[o], arr[o + 1]);
    }
    return out;
  }

  /** Compact binary export (for saving replays). */
  export(round: number): Uint32Array {
    return Uint32Array.from(this.rounds.get(round) ?? []);
  }

  import(round: number, data: Uint32Array): void {
    this.rounds.set(round, Array.from(data));
  }

  recordConversion(agent: number, round: number, tick: number): void {
    this.conversions.push({ agent, round, tick });
  }
}

/** yaw word marking "no input this tick" (the sim then holds the agent's view) */
const NO_INPUT = 0xffffffff;

/** [buttons | (pitch + 32768) << 16, yaw] as two u32 words. */
export function packInput(f: InputFrame | undefined): [number, number] {
  if (!f) return [0, NO_INPUT];
  return [((f.buttons & 0xffff) | (((f.pitch + 32768) & 0xffff) << 16)) >>> 0, f.yaw & 0xffff];
}

export function unpackInput(a: number, yaw: number): InputFrame | undefined {
  if (yaw === NO_INPUT) return undefined;
  return { buttons: a & 0xffff, pitch: ((a >>> 16) & 0xffff) - 32768, yaw: yaw & 0xffff };
}

/**
 * Re-simulates a recorded round. Used for the killcam (seek to death − 5 s)
 * and post-match round replays.
 */
export class RoundReplay {
  readonly world: World;
  private readonly scratch: (InputFrame | undefined)[] = [];

  constructor(
    readonly log: InputLog,
    readonly round: number,
  ) {
    this.world = new World(log.options);
    for (const c of log.conversions) if (c.round < round) this.world.convertToBot(c.agent);
    this.world.startRound(round);
  }

  get tick(): number {
    return this.world.round.tick;
  }

  /** Step one tick using the recorded inputs. Returns false when the recorded round is over. */
  step(): boolean {
    if (this.world.round.index !== this.round) return false;
    const t = this.world.round.tick;
    if (t >= this.log.ticks(this.round)) return false;
    for (const c of this.log.conversions) if (c.round === this.round && c.tick === t) this.world.convertToBot(c.agent);
    this.world.step(this.log.frameAt(this.round, t, this.scratch));
    return this.world.round.index === this.round;
  }

  /** Fast-forward without rendering. */
  seek(tick: number): void {
    while (this.world.round.tick < tick && this.step()) {
      /* keep stepping */
    }
  }
}
