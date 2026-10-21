/**
 * Quality presets. ★ 内蔵GPUで重い場合はここを調整。
 * The adaptive controller (P4) lowers renderScale first, then effects,
 * then post-processing.
 */
export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  name: QualityName;
  /** fraction of native resolution */
  renderScale: number;
  /** 0 disables shadows */
  shadowMapSize: number;
}

export const QUALITY_PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', renderScale: 0.7, shadowMapSize: 0 },
  medium: { name: 'medium', renderScale: 0.85, shadowMapSize: 1024 },
  high: { name: 'high', renderScale: 1.0, shadowMapSize: 2048 },
  ultra: { name: 'ultra', renderScale: 1.0, shadowMapSize: 4096 },
};

export const QUALITY_ORDER: QualityName[] = ['low', 'medium', 'high', 'ultra'];
