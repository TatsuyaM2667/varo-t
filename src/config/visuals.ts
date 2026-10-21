import type { MaterialTag } from '../sim/physics/aabb';

/**
 * Colours and look. ★ 見た目の好みはここを触って調整してください。
 */
export interface GridStyle {
  base: string;
  line: string;
  accent: string;
  /** grid cells per texture tile */
  divisions: number;
  noise: number;
}

export interface SurfaceStyle {
  grid: GridStyle;
  /** world metres covered by one texture tile */
  tileMetres: number;
  specular: string;
}

export const PALETTE: {
  surfaces: Record<MaterialTag, SurfaceStyle>;
  sky: { top: string; horizon: string };
  sun: { color: string; intensity: number; direction: [number, number, number] };
  ambient: { sky: string; ground: string; intensity: number };
  fog: { color: string; density: number };
  teams: { attackers: string; defenders: string };
} = {
  surfaces: {
    floor: { grid: { base: '#5b6169', line: '#6c737c', accent: '#7c848d', divisions: 4, noise: 0.025 }, tileMetres: 4, specular: '#1a1a1a' },
    wall: { grid: { base: '#d6cfc3', line: '#c4bcaf', accent: '#b3aa9b', divisions: 4, noise: 0.04 }, tileMetres: 4, specular: '#151515' },
    crate: { grid: { base: '#d98a3d', line: '#c27530', accent: '#8a4f1d', divisions: 2, noise: 0.06 }, tileMetres: 2, specular: '#2a2a2a' },
    metal: { grid: { base: '#8fb3c9', line: '#7a9db3', accent: '#e8f6ff', divisions: 2, noise: 0.03 }, tileMetres: 1, specular: '#aaaaaa' },
    concrete: { grid: { base: '#a39e95', line: '#948f86', accent: '#857f75', divisions: 4, noise: 0.05 }, tileMetres: 4, specular: '#151515' },
    glass: { grid: { base: '#a8e4ff', line: '#c9f0ff', accent: '#ffffff', divisions: 1, noise: 0.0 }, tileMetres: 3, specular: '#ffffff' },
    wood: { grid: { base: '#a0703f', line: '#8a5d32', accent: '#5e3c1c', divisions: 4, noise: 0.08 }, tileMetres: 1.2, specular: '#202020' },
    site: { grid: { base: '#2f7f7a', line: '#3f9a94', accent: '#9ef0e6', divisions: 3, noise: 0.03 }, tileMetres: 6, specular: '#333333' },
  },
  sky: { top: '#5d8fc9', horizon: '#f2d7b0' },
  sun: { color: '#fff1d6', intensity: 2.2, direction: [-0.45, -1, 0.35] },
  ambient: { sky: '#cfe1ff', ground: '#6b5a48', intensity: 0.55 },
  fog: { color: '#e9dcc8', density: 0.004 },
  teams: { attackers: '#ffb648', defenders: '#4fd1ff' },
};
