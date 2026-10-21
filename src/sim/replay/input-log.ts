import type { InputFrame } from '../input-frame';
import { World, type WorldOptions } from '../world';

/**
 * Per-round log of human inputs. Bots are deterministic functions of the
 * world, so (world options, round index, human inputs) fully define a round.
 * Each tick stores one packed frame per human: [buttons | pitch<<16, yaw].
 */
export class InputLog {
  /** rounds[r][tick] = packed frames for the humans, in roster order */
  private readonly rounds = new Map<number, number[]>();

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
    for (const id of this.humanIds) {
      const f = inputs[id];
      arr.push(f ? packA(f) : 0, f ? f.yaw & 0xffff : 0);
    }
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
      out[this.humanIds[h]] = unpack(arr[o], arr[o + 1]);
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
}

function packA(f: InputFrame): number {
  return ((f.buttons & 0xffff) | (((f.pitch + 32768) & 0xffff) << 16)) >>> 0;
}

function unpack(a: number, yaw: number): InputFrame {
  return { buttons: a & 0xffff, pitch: ((a >>> 16) & 0xffff) - 32768, yaw };
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
