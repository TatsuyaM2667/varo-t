import { RULES } from '../config/rules';
import type { AgentStats } from '../sim/entities/agent';
import { type KV, readJson } from './storage';

export interface MatchSummary {
  stats: AgentStats;
  roundsWon: number;
  roundsLost: number;
  won: boolean;
  /** seconds left on the clock summed over rounds the attackers won */
  timeLeftOnWins: number;
  difficulty: string;
  /** number of enemy bots (more enemies → higher multiplier) */
  enemies?: number;
  /** map id of the stage */
  stage?: string;
}

export interface ScoreBreakdown {
  kills: number;
  headshots: number;
  damage: number;
  rounds: number;
  match: number;
  time: number;
  difficultyMul: number;
  total: number;
}

const DIFF_MUL: Record<string, number> = { easy: 1, normal: 1.4, hard: 2 };

export function computeScore(m: MatchSummary): ScoreBreakdown {
  const s = RULES.score;
  const kills = m.stats.kills * s.kill;
  const headshots = m.stats.headshots * s.headshotKill;
  const damage = Math.round(m.stats.damage * s.damagePoint);
  const rounds = m.roundsWon * s.roundWin;
  const match = m.won ? s.matchWin : 0;
  const time = Math.round(m.timeLeftOnWins * s.timeBonusPerSecond);
  // 4 enemies = ×1.0, each extra enemy +12.5 %
  const difficultyMul = +((DIFF_MUL[m.difficulty] ?? 1) * (0.5 + 0.125 * (m.enemies ?? 4))).toFixed(2);
  const total = Math.round((kills + headshots + damage + rounds + match + time) * difficultyMul);
  return { kills, headshots, damage, rounds, match, time, difficultyMul, total };
}

export interface HighScore {
  name: string;
  /** map id of the stage, if recorded */
  stage?: string;
  score: number;
  kills: number;
  won: boolean;
  difficulty: string;
  date: string;
}

const KEY = 'halcyon.highscores.v1';
export const MAX_ENTRIES = 10;

export function loadHighScores(kv: KV): HighScore[] {
  const list = readJson<HighScore[]>(kv, KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.score === 'number' && typeof e.name === 'string')
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ENTRIES);
}

/** Rank (0-based) the score would take, or -1 if it doesn't make the board. */
export function rankFor(list: readonly HighScore[], score: number): number {
  if (score <= 0) return -1;
  let i = 0;
  while (i < list.length && list[i].score >= score) i++;
  return i < MAX_ENTRIES ? i : -1;
}

export function insertHighScore(kv: KV, entry: HighScore): HighScore[] {
  const list = loadHighScores(kv);
  const r = rankFor(list, entry.score);
  if (r < 0) return list;
  const name = sanitizeName(entry.name);
  list.splice(r, 0, { ...entry, name });
  const out = list.slice(0, MAX_ENTRIES);
  kv.set(KEY, JSON.stringify(out));
  return out;
}

export function sanitizeName(n: string): string {
  const s = n
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3);
  return s.length ? s : '???';
}
