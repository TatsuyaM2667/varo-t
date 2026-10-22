import type { FloorKind } from '../sim/map/map-def';
import type { MaterialTag } from '../sim/physics/aabb';
import { type LightingMood, PALETTE, type SurfaceStyle } from './visuals';

/**
 * Stage themes. ★ ステージごとの見た目（壁の質感・床・装飾の色・時間帯）はここ。
 * Wall/floor *colours* come from the zones in sim/map/stages.ts (tints);
 * the textures here are kept near-white so those tints read true.
 */
export interface Theme {
  surfaces: Record<MaterialTag, SurfaceStyle>;
  floors: Record<FloorKind, SurfaceStyle>;
  /** baseboard / cornice brightness relative to the wall tint */
  trimDark: number;
  trimLight: number;
  windowGlass: string;
  windowFrame: string;
  foliage: string[];
  trunk: string;
  cloth: string[];
  lamp: string;
  moods: LightingMood[];
}

const neutral = (pattern: SurfaceStyle['grid']['pattern'], divisions: number, noise: number, tile: number, line = '#e2ded8'): SurfaceStyle => ({
  grid: { base: '#f4f2ee', line, accent: '#d8d3cb', divisions, noise, pattern },
  tileMetres: tile,
  specular: '#161616',
});

const crateStyle = (base: string, line: string, accent: string): SurfaceStyle => ({
  grid: { base, line, accent, divisions: 2, noise: 0.06, pattern: 'grid' },
  tileMetres: 2,
  specular: '#2a2a2a',
});

const baseSurfaces = (wall: SurfaceStyle, crate: SurfaceStyle = PALETTE.surfaces.crate): Record<MaterialTag, SurfaceStyle> => ({
  ...PALETTE.surfaces,
  crate,
  wall,
  floor: neutral('tile', 4, 0.04, 4),
  concrete: neutral('grid', 4, 0.05, 4, '#d9d5cf'),
});

const MOOD_NOON = PALETTE;

export const THEMES: Record<string, Theme> = {
  bazaar: {
    surfaces: baseSurfaces(neutral('plaster', 2, 0.09, 4)),
    floors: {
      plain: neutral('grid', 2, 0.06, 4),
      cobble: neutral('cobble', 6, 0.08, 3, '#cfc8bd'),
      tile: neutral('tile', 4, 0.05, 3),
      metal: neutral('plate', 2, 0.04, 2),
      grass: neutral('grass', 1, 0.2, 3),
      site: { grid: { base: '#3f9a94', line: '#58b4ad', accent: '#a8f2e8', divisions: 3, noise: 0.03, pattern: 'tile' }, tileMetres: 3, specular: '#333333' },
    },
    trimDark: 0.72,
    trimLight: 1.12,
    windowGlass: '#2d4252',
    windowFrame: '#6b4a32',
    foliage: ['#5f8f45', '#78a24c', '#4d7a3c'],
    trunk: '#6b4a32',
    cloth: ['#c8473b', '#e09a3a', '#2f8f8a', '#7a4a9a'],
    lamp: '#ffd27a',
    moods: [
      { name: 'bazaar-noon', sky: { top: '#5f95d1', horizon: '#f6dcb3' }, sun: { ...MOOD_NOON.sun, color: '#fff0cf', intensity: 2.4 }, ambient: MOOD_NOON.ambient, fog: { color: '#f0dcc0', density: 0.0035 }, exposure: 1.0 },
      { name: 'bazaar-golden', sky: { top: '#4f6fa8', horizon: '#ffb37a' }, sun: { color: '#ffc98a', intensity: 2.6, direction: [0.75, -0.42, 0.5] }, ambient: { sky: '#ffd9b8', ground: '#5a4636', intensity: 0.48 }, fog: { color: '#f2c39a', density: 0.005 }, exposure: 1.05 },
    ],
  },
  terrace: {
    surfaces: baseSurfaces(neutral('plaster', 2, 0.06, 4), crateStyle('#a8805a', '#8f6a48', '#5e432c')),
    floors: {
      plain: neutral('grid', 2, 0.05, 4),
      cobble: neutral('cobble', 6, 0.07, 3, '#d3cfc8'),
      tile: neutral('tile', 3, 0.04, 2.4),
      metal: neutral('plate', 2, 0.04, 2),
      grass: neutral('grass', 1, 0.18, 3),
      site: { grid: { base: '#b8433a', line: '#d06055', accent: '#ffd9c8', divisions: 3, noise: 0.03, pattern: 'tile' }, tileMetres: 3, specular: '#333333' },
    },
    trimDark: 0.78,
    trimLight: 1.02,
    windowGlass: '#33424d',
    windowFrame: '#3a3330',
    foliage: ['#e8a3b8', '#f2c1cf', '#6d9a55'],
    trunk: '#4a3a33',
    cloth: ['#b8433a', '#f0e6d0', '#2e4f6b'],
    lamp: '#ffb36b',
    moods: [
      { name: 'terrace-golden', sky: { top: '#5a7fb8', horizon: '#ffc79a' }, sun: { color: '#ffd2a0', intensity: 2.4, direction: [0.55, -0.5, 0.65] }, ambient: { sky: '#ffe2cc', ground: '#5b5048', intensity: 0.5 }, fog: { color: '#f3d4b8', density: 0.004 }, exposure: 1.03 },
      { name: 'terrace-dusk', sky: { top: '#273463', horizon: '#ee8a8f' }, sun: { color: '#ffa98a', intensity: 1.9, direction: [-0.8, -0.32, -0.5] }, ambient: { sky: '#aab2ff', ground: '#3e3442', intensity: 0.55 }, fog: { color: '#8a6a86', density: 0.006 }, exposure: 1.15 },
    ],
  },
  foundry: {
    surfaces: baseSurfaces(neutral('brick', 8, 0.08, 3, '#cfc9c2'), crateStyle('#5f7050', '#4f5f42', '#d8b24a')),
    floors: {
      plain: neutral('grid', 2, 0.07, 4),
      cobble: neutral('cobble', 6, 0.09, 3, '#cfcac4'),
      tile: neutral('tile', 4, 0.05, 3),
      metal: neutral('plate', 2, 0.05, 2, '#d6d3cf'),
      grass: neutral('grass', 1, 0.2, 3),
      site: { grid: { base: '#c8702a', line: '#e08a3c', accent: '#ffd8a0', divisions: 2, noise: 0.04, pattern: 'plate' }, tileMetres: 3, specular: '#444444' },
    },
    trimDark: 0.55,
    trimLight: 1.0,
    windowGlass: '#ff9a3c',
    windowFrame: '#2a2d33',
    foliage: ['#56614a', '#4a5440'],
    trunk: '#3a332d',
    cloth: ['#e0742c', '#2b3a4a', '#d8c24a'],
    lamp: '#ffb04a',
    moods: [
      { name: 'foundry-dusk', sky: { top: '#2a3245', horizon: '#c9806a' }, sun: { color: '#ffb488', intensity: 1.7, direction: [-0.6, -0.45, -0.6] }, ambient: { sky: '#a4acc4', ground: '#6a625c', intensity: 0.65 }, fog: { color: '#6e6470', density: 0.008 }, exposure: 1.18 },
      { name: 'foundry-overcast', sky: { top: '#6c7686', horizon: '#b8b4ae' }, sun: { color: '#e8e4dc', intensity: 1.5, direction: [0.3, -0.9, 0.3] }, ambient: { sky: '#c8ccd4', ground: '#706b66', intensity: 0.72 }, fog: { color: '#a7a5a2', density: 0.007 }, exposure: 1.1 },
    ],
  },
};

export function themeOf(id: string | undefined): Theme | null {
  return (id && THEMES[id]) || null;
}
