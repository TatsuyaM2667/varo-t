/**
 * Feature flags for Tier 1 / Tier 2 systems. Every flag defaults to off;
 * quality presets (config/quality.ts) and URL params (?f=name,-name) turn
 * them on. With all flags off the game must behave exactly like Tier 0.
 */
export interface Features {
  // Tier 1
  pbrLighting: boolean;
  ssao: boolean;
  volumetricLight: boolean;
  bloom: boolean;
  gpuParticles: boolean;
  timeOfDay: boolean;
  volumetricSmoke: boolean;
  botUtilityAi: boolean;
  proceduralAudio: boolean;
  spatialReverb: boolean;
  proceduralAnimation: boolean;
  killcam: boolean;
  roundReplay: boolean;
  attractMode: boolean;
  // Tier 2
  destructibles: boolean;
  decals: boolean;
  seededMap: boolean;
  minimap: boolean;
  killSlowmo: boolean;
}

export const ALL_FEATURES_OFF: Features = {
  pbrLighting: false,
  ssao: false,
  volumetricLight: false,
  bloom: false,
  gpuParticles: false,
  timeOfDay: false,
  volumetricSmoke: false,
  botUtilityAi: false,
  proceduralAudio: false,
  spatialReverb: false,
  proceduralAnimation: false,
  killcam: false,
  roundReplay: false,
  attractMode: false,
  destructibles: false,
  decals: false,
  seededMap: false,
  minimap: false,
  killSlowmo: false,
};

/** Apply `?f=ssao,bloom,-killcam` style overrides. */
export function applyFeatureOverrides(base: Features, spec: string | null): Features {
  const out = { ...base };
  if (!spec) return out;
  for (const raw of spec.split(',')) {
    const name = raw.trim();
    if (!name) continue;
    const off = name.startsWith('-');
    const key = (off ? name.slice(1) : name) as keyof Features;
    if (key in out) out[key] = !off;
  }
  return out;
}
