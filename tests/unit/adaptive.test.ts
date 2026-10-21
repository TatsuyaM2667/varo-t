import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../../src/config/quality';
import { AdaptiveQuality, buildLadder, percentile, presetAtLevel } from '../../src/render/quality/adaptive';

function feed(aq: AdaptiveQuality, ms: number, seconds: number, t0: number): number {
  let t = t0;
  while (t < t0 + seconds) {
    aq.sample(ms, t);
    t += ms / 1000;
  }
  return t;
}

describe('adaptive quality', () => {
  it('ladder goes resolution → effects → post', () => {
    const l = buildLadder(QUALITY_PRESETS.ultra);
    const kinds = l.map((s) => s.kind);
    const lastScale = kinds.lastIndexOf('scale');
    const firstEffect = kinds.indexOf('effect');
    const firstPost = kinds.indexOf('post');
    expect(lastScale).toBeLessThan(firstEffect);
    expect(kinds.lastIndexOf('effect')).toBeLessThan(firstPost);
  });

  it('degrades under sustained load and recovers with headroom', () => {
    const changes: number[] = [];
    const aq = new AdaptiveQuality(QUALITY_PRESETS.high, (_q, level) => changes.push(level));
    let t = feed(aq, 30, 10, 0);
    expect(aq.level).toBeGreaterThan(0);
    const degraded = aq.level;
    expect(aq.current.renderScale).toBeLessThan(1);
    t = feed(aq, 10, 40, t);
    expect(aq.level).toBeLessThan(degraded);
    expect(changes.length).toBeGreaterThan(1);
  });

  it('does not flap: a failed upgrade is not retried immediately', () => {
    const aq = new AdaptiveQuality(QUALITY_PRESETS.high, () => {});
    let t = feed(aq, 30, 5, 0); // down to 1
    const lvl = aq.level;
    t = feed(aq, 10, 17, t); // up (one mixed window, then 6 calm ones)
    expect(aq.level).toBe(lvl - 1);
    t = feed(aq, 30, 5, t); // down again -> block
    const blockedAt = aq.level;
    t = feed(aq, 10, 20, t);
    expect(aq.level).toBe(blockedAt);
  });

  it('presetAtLevel applies steps cumulatively', () => {
    const base = QUALITY_PRESETS.ultra;
    const l = buildLadder(base);
    const q = presetAtLevel(base, l, l.length);
    expect(q.post.ssao).toBe(false);
    expect(q.shadowMapSize).toBe(0);
    expect(q.renderScale).toBeLessThan(0.6);
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
  });
});
