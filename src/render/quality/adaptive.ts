import { ADAPTIVE, type QualityPreset } from "../../config/quality";

/**
 * Dynamic quality: watches frame times and walks a degradation ladder.
 * Ladder order (as specified): resolution scale → effects → post-processing.
 * Pure logic (no Babylon) so it can be unit-tested; the renderer applies
 * the resulting `QualityPreset`.
 */
export type Step =
  | { kind: "scale"; value: number }
  | {
      kind: "effect";
      name: "particles" | "smoke" | "decals" | "dynamicShadows" | "shadows";
    }
  | {
      kind: "post";
      name: "ssao" | "volumetric" | "bloom" | "sharpen" | "fxaa";
    };

export function buildLadder(base: QualityPreset): Step[] {
  const steps: Step[] = [];
  for (const s of ADAPTIVE.scaleSteps)
    if (s < base.renderScale - 1e-6) steps.push({ kind: "scale", value: s });
  steps.push({ kind: "effect", name: "particles" });
  steps.push({ kind: "effect", name: "smoke" });
  steps.push({ kind: "effect", name: "decals" });
  if (base.dynamicShadows)
    steps.push({ kind: "effect", name: "dynamicShadows" });
  if (base.shadowMapSize > 0) steps.push({ kind: "effect", name: "shadows" });
  if (base.post.volumetric) steps.push({ kind: "post", name: "volumetric" });
  if (base.post.ssao) steps.push({ kind: "post", name: "ssao" });
  if (base.post.bloom) steps.push({ kind: "post", name: "bloom" });
  if (base.post.sharpen) steps.push({ kind: "post", name: "sharpen" });
  return steps;
}

/** Preset after applying the first `level` ladder steps. */
export function presetAtLevel(
  base: QualityPreset,
  ladder: readonly Step[],
  level: number,
): QualityPreset {
  const q: QualityPreset = {
    ...base,
    post: { ...base.post },
    features: { ...base.features },
  };
  for (let i = 0; i < level && i < ladder.length; i++) {
    const s = ladder[i];
    if (s.kind === "scale") q.renderScale = s.value;
    else if (s.kind === "effect") {
      if (s.name === "particles") q.particles *= 0.4;
      else if (s.name === "smoke")
        q.smokeParticles = Math.round(q.smokeParticles * 0.5);
      else if (s.name === "decals") q.maxDecals = Math.round(q.maxDecals * 0.3);
      else if (s.name === "dynamicShadows") q.dynamicShadows = false;
      else q.shadowMapSize = 0;
    } else q.post[s.name] = false;
  }
  return q;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export class AdaptiveQuality {
  readonly ladder: Step[];
  level = 0;
  private samples: number[] = [];
  private windowStart = 0;
  private overCount = 0;
  private underCount = 0;
  /** level → time (s) until which upgrading back to it is forbidden */
  private readonly blocked = new Map<number, number>();
  private lastChange: "up" | "down" | null = null;
  lastP95 = 0;
  enabled = true;

  constructor(
    readonly base: QualityPreset,
    private readonly onChange: (
      q: QualityPreset,
      level: number,
      reason: string,
    ) => void,
  ) {
    this.ladder = buildLadder(base);
  }

  get current(): QualityPreset {
    return presetAtLevel(this.base, this.ladder, this.level);
  }

  /** Feed one frame time. `now` is in seconds. */
  sample(frameMs: number, now: number): void {
    if (!this.enabled) return;
    // ignore hitches from tab switches / loading
    if (frameMs > 250) return;
    if (this.samples.length === 0) this.windowStart = now;
    this.samples.push(frameMs);
    if (now - this.windowStart < ADAPTIVE.windowSec) return;

    const p95 = percentile(this.samples, 0.95);
    this.lastP95 = p95;
    this.samples = [];
    const budget = ADAPTIVE.budgetMs;
    if (p95 > budget * ADAPTIVE.degradeFactor) {
      this.overCount++;
      this.underCount = 0;
    } else if (p95 < budget * ADAPTIVE.upgradeFactor) {
      this.underCount++;
      this.overCount = 0;
    } else {
      this.overCount = 0;
      this.underCount = 0;
    }

    if (
      this.overCount >= ADAPTIVE.degradeWindows &&
      this.level < this.ladder.length
    ) {
      if (this.lastChange === "up")
        this.blocked.set(this.level, now + ADAPTIVE.retryCooldownSec);
      this.level++;
      this.lastChange = "down";
      this.overCount = 0;
      this.onChange(this.current, this.level, `p95 ${p95.toFixed(1)}ms`);
    } else if (this.underCount >= ADAPTIVE.upgradeWindows && this.level > 0) {
      const target = this.level - 1;
      if ((this.blocked.get(target) ?? 0) <= now) {
        this.level = target;
        this.lastChange = "up";
        this.onChange(this.current, this.level, "headroom");
      }
      this.underCount = 0;
    }
  }
}
