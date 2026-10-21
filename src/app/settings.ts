import type { Difficulty } from '../config/bots';
import { DEFAULT_DIFFICULTY } from '../config/bots';
import { INPUT } from '../config/input';
import type { QualityName } from '../config/quality';
import { type KV, readJson } from './storage';

export type Lang = 'ja' | 'en';

export interface Settings {
  sensitivity: number;
  volume: number;
  quality: QualityName | 'auto';
  difficulty: Difficulty;
  lang: Lang;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: INPUT.defaultSensitivity,
  volume: 0.8,
  quality: 'auto',
  difficulty: DEFAULT_DIFFICULTY,
  lang: 'ja',
};

const KEY = 'halcyon.settings.v1';

export function loadSettings(kv: KV): Settings {
  const s = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(kv, KEY, {}) };
  s.sensitivity = clampNum(s.sensitivity, INPUT.minSensitivity, INPUT.maxSensitivity, DEFAULT_SETTINGS.sensitivity);
  s.volume = clampNum(s.volume, 0, 1, DEFAULT_SETTINGS.volume);
  if (!['auto', 'low', 'medium', 'high', 'ultra'].includes(s.quality)) s.quality = 'auto';
  if (!['easy', 'normal', 'hard'].includes(s.difficulty)) s.difficulty = DEFAULT_DIFFICULTY;
  if (s.lang !== 'en') s.lang = 'ja';
  return s;
}

export function saveSettings(kv: KV, s: Settings): void {
  kv.set(KEY, JSON.stringify(s));
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}
