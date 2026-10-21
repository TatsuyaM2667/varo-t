/**
 * Fixed-timestep accumulator. The host calls `advance(realDt)` each frame;
 * it returns how many sim ticks to run and exposes `alpha` for render
 * interpolation between the previous and current tick.
 */
export class FixedStep {
  private acc = 0;
  alpha = 0;

  constructor(
    readonly dt: number,
    /** Cap to avoid a spiral of death after a stall (tab switch, GC). */
    readonly maxStepsPerFrame = 5,
  ) {}

  advance(realDt: number): number {
    this.acc += Math.min(realDt, this.dt * this.maxStepsPerFrame);
    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxStepsPerFrame) {
      this.acc -= this.dt;
      steps++;
    }
    if (steps === this.maxStepsPerFrame) this.acc = Math.min(this.acc, this.dt);
    this.alpha = this.acc / this.dt;
    return steps;
  }

  reset(): void {
    this.acc = 0;
    this.alpha = 0;
  }
}
