import type { Features } from './features';

/**
 * Quality presets. ★ 内蔵GPUで重い場合はここを調整。
 * Each preset also decides which Tier 1/2 visual features are on.
 * The adaptive controller lowers, in order: resolution → effects → post.
 */
export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  name: QualityName;
  /** fraction of native resolution */
  renderScale: number;
  /** 0 disables shadows */
  shadowMapSize: number;
  /** agents cast real-time shadows (otherwise blob shadows) */
  dynamicShadows: boolean;
  /** particle count multiplier for sparks/dust */
  particles: number;
  /** particles per smoke cloud */
  smokeParticles: number;
  maxDecals: number;
  post: {
    fxaa: boolean;
    bloom: boolean;
    ssao: boolean;
    volumetric: boolean;
    toneMapping: boolean;
    sharpen: boolean;
  };
  /** visual feature flags switched on by this preset */
  features: Partial<Features>;
}

const VISUAL_ALL: Partial<Features> = {
  pbrLighting: true,
  gpuParticles: true,
  timeOfDay: true,
  volumetricSmoke: true,
  proceduralAnimation: true,
  decals: true,
};

export const QUALITY_PRESETS: Record<QualityName, QualityPreset> = {
  low: {
    name: 'low',
    renderScale: 0.7,
    shadowMapSize: 0,
    dynamicShadows: false,
    particles: 0.35,
    smokeParticles: 90,
    maxDecals: 40,
    post: { fxaa: true, bloom: false, ssao: false, volumetric: false, toneMapping: true, sharpen: false },
    features: { proceduralAnimation: true, timeOfDay: true, decals: true },
  },
  medium: {
    name: 'medium',
    renderScale: 0.85,
    shadowMapSize: 1024,
    dynamicShadows: false,
    particles: 0.6,
    smokeParticles: 160,
    maxDecals: 80,
    post: { fxaa: true, bloom: true, ssao: false, volumetric: false, toneMapping: true, sharpen: true },
    features: { ...VISUAL_ALL, pbrLighting: false, bloom: true },
  },
  high: {
    name: 'high',
    renderScale: 1.0,
    shadowMapSize: 2048,
    dynamicShadows: true,
    particles: 1,
    smokeParticles: 260,
    maxDecals: 150,
    post: { fxaa: true, bloom: true, ssao: true, volumetric: false, toneMapping: true, sharpen: true },
    features: { ...VISUAL_ALL, bloom: true, ssao: true },
  },
  ultra: {
    name: 'ultra',
    renderScale: 1.0,
    shadowMapSize: 4096,
    dynamicShadows: true,
    particles: 1.6,
    smokeParticles: 400,
    maxDecals: 250,
    post: { fxaa: true, bloom: true, ssao: true, volumetric: true, toneMapping: true, sharpen: true },
    features: { ...VISUAL_ALL, bloom: true, ssao: true, volumetricLight: true },
  },
};

export const QUALITY_ORDER: QualityName[] = ['low', 'medium', 'high', 'ultra'];

export const ADAPTIVE = {
  /** frame budget in ms (60 fps) */
  budgetMs: 16.7,
  /** window length for the percentile, seconds */
  windowSec: 2,
  /** degrade when p95 exceeds budget × this for `degradeWindows` windows in a row */
  degradeFactor: 1.15,
  degradeWindows: 2,
  /** upgrade when p95 stays under budget × this for `upgradeWindows` windows */
  upgradeFactor: 1.05,
  upgradeWindows: 6,
  /** after a failed upgrade, don't retry that step for this long (s) */
  retryCooldownSec: 60,
  /** resolution ladder tried before touching effects */
  scaleSteps: [1.0, 0.85, 0.75, 0.65, 0.55],
};
