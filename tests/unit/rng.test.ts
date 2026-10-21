import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/core/rng';

describe('Rng', () => {
  it('is reproducible from a seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('differs between seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.nextU32() === b.nextU32()) same++;
    expect(same).toBeLessThan(3);
  });

  it('produces a known golden sequence (guards against accidental algorithm changes)', () => {
    const r = new Rng(42);
    const seq = [r.nextU32(), r.nextU32(), r.nextU32()];
    expect(seq).toMatchSnapshot();
  });

  it('float() is uniform in [0,1)', () => {
    const r = new Rng(7);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      bins[Math.floor(f * 10)]++;
    }
    for (const b of bins) expect(Math.abs(b - 10000)).toBeLessThan(500);
  });

  it('state round-trips', () => {
    const r = new Rng(9);
    r.nextU32();
    const s = r.getState();
    const x = r.nextU32();
    r.setState(s);
    expect(r.nextU32()).toBe(x);
  });
});
