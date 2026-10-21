import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';
import { Btn, type InputFrame } from '../../src/sim/input-frame';
import { World } from '../../src/sim/world';

function randomLog(seed: number, ticks: number, agents: number): InputFrame[][] {
  const r = new Rng(seed);
  const yaw = new Array(agents).fill(0);
  const log: InputFrame[][] = [];
  let held = new Array(agents).fill(0);
  for (let t = 0; t < ticks; t++) {
    const row: InputFrame[] = [];
    for (let i = 0; i < agents; i++) {
      if (r.int(20) === 0) held[i] = r.nextU32() & (Btn.Forward | Btn.Back | Btn.Left | Btn.Right | Btn.Walk | Btn.Jump | Btn.Crouch);
      yaw[i] = (yaw[i] + r.int(400) - 200) & 0xffff;
      row.push({ buttons: held[i], yaw: yaw[i], pitch: r.int(2000) - 1000 });
    }
    log.push(row);
  }
  return log;
}

function run(log: InputFrame[][]): number[] {
  const roster = log[0].map((_, i) => ({ team: (i % 2) as 0 | 1, isBot: false, name: `a${i}` }));
  const w = new World({ seed: 99, roster });
  w.startMatch();
  const hashes: number[] = [];
  for (const row of log) {
    w.step(row);
    hashes.push(w.hash());
  }
  return hashes;
}

describe('determinism', () => {
  it('same input log -> identical state hash every tick', () => {
    const log = randomLog(5, 3600, 4);
    expect(run(log)).toEqual(run(log));
  });

  it('different input -> different hashes', () => {
    const a = run(randomLog(5, 600, 2));
    const b = run(randomLog(6, 600, 2));
    expect(a[a.length - 1]).not.toBe(b[b.length - 1]);
  });
});
