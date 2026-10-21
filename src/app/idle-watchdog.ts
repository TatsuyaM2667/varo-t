/**
 * Exhibition safety net: fires a callback after `timeoutSec` of no user
 * input. `poke()` is called on every input event. Time is injected so it can
 * be tested without timers.
 */
export class IdleWatchdog {
  private last: number;
  private fired = false;

  constructor(
    public timeoutSec: number,
    private readonly onIdle: () => void,
    now: number,
  ) {
    this.last = now;
  }

  poke(now: number): void {
    this.last = now;
    this.fired = false;
  }

  /** Seconds left before the timeout fires. */
  remaining(now: number): number {
    return Math.max(0, this.timeoutSec - (now - this.last));
  }

  update(now: number): void {
    if (!this.fired && now - this.last >= this.timeoutSec) {
      this.fired = true;
      this.onIdle();
    }
  }
}
