import type { Difficulty } from '../config/bots';
import { DEFAULT_DIFFICULTY } from '../config/bots';
import { INPUT } from '../config/input';
import type { QualityName } from '../config/quality';
import { type Bindings, defaultBindings, resolveBindings } from '../input/bindings';
import { type KV, readJson } from './storage';

export type Lang = 'ja' | 'en';

export interface Settings {
  sensitivity: number;
  volume: number;
  quality: QualityName | 'auto';
  difficulty: Difficulty;
  lang: Lang;
  bindings: Bindings;
  /** selected stage (index into STAGES) */
  stage: number;
  /** enemy count; 0 = the stage's default */
  enemies: number;
  /** name shown to other players online */
  name: string;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: INPUT.defaultSensitivity,
  volume: 0.8,
  quality: 'auto',
  difficulty: DEFAULT_DIFFICULTY,
  lang: 'ja',
  bindings: defaultBindings(),
  stage: 0,
  enemies: 0,
  name: '',
};

/** upper limit of the enemy-count setting (defender spawns per map: 10) */
export const MAX_ENEMIES = 8;

const KEY = 'halcyon.settings.v1';

export function loadSettings(kv: KV): Settings {
  const s = { ...DEFAULT_SETTINGS, bindings: defaultBindings(), ...readJson<Partial<Settings>>(kv, KEY, {}) };
  s.sensitivity = clampNum(s.sensitivity, INPUT.minSensitivity, INPUT.maxSensitivity, DEFAULT_SETTINGS.sensitivity);
  s.volume = clampNum(s.volume, 0, 1, DEFAULT_SETTINGS.volume);
  if (!['auto', 'low', 'medium', 'high', 'ultra'].includes(s.quality)) s.quality = 'auto';
  if (!['easy', 'normal', 'hard'].includes(s.difficulty)) s.difficulty = DEFAULT_DIFFICULTY;
  if (s.lang !== 'en') s.lang = 'ja';
  s.bindings = resolveBindings(s.bindings);
  s.stage = Number.isInteger(s.stage) && s.stage >= 0 && s.stage < 3 ? s.stage : 0;
  s.name = typeof s.name === 'string' ? s.name.slice(0, 12) : '';
  s.enemies = Number.isInteger(s.enemies) && s.enemies >= 0 && s.enemies <= MAX_ENEMIES ? s.enemies : 0;
  return s;
}

export function saveSettings(kv: KV, s: Settings): void {
  kv.set(KEY, JSON.stringify(s));
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}
