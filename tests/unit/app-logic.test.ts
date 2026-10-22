import { describe, expect, it } from 'vitest';
import { computeScore, insertHighScore, loadHighScores, rankFor, sanitizeName } from '../../src/app/highscore';
import { IdleWatchdog } from '../../src/app/idle-watchdog';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/app/settings';
import { memoryKV } from '../../src/app/storage';
import { applyFeatureOverrides, ALL_FEATURES_OFF } from '../../src/config/features';
import { emptyStats } from '../../src/sim/entities/agent';

describe('high scores', () => {
  const entry = (score: number, name = 'ABC') => ({ name, score, kills: 1, won: true, difficulty: 'easy', date: '2026-10-22' });

  it('keeps the top 10 sorted', () => {
    const kv = memoryKV();
    for (let i = 1; i <= 15; i++) insertHighScore(kv, entry(i * 100));
    const list = loadHighScores(kv);
    expect(list).toHaveLength(10);
    expect(list[0].score).toBe(1500);
    expect(list[9].score).toBe(600);
    expect(rankFor(list, 50)).toBe(-1);
    expect(rankFor(list, 1250)).toBe(3);
    expect(rankFor(list, 1200)).toBe(4); // ties rank after existing entries
  });

  it('survives corrupted storage', () => {
    const kv = memoryKV();
    kv.set('halcyon.highscores.v1', '{not json');
    expect(loadHighScores(kv)).toEqual([]);
    kv.set('halcyon.highscores.v1', JSON.stringify([{ bogus: 1 }, entry(10)]));
    expect(loadHighScores(kv)).toHaveLength(1);
  });

  it('sanitises names to 3 alphanumerics', () => {
    expect(sanitizeName('a!b c d')).toBe('ABC');
    expect(sanitizeName('')).toBe('???');
  });

  it('scores reward kills, rounds, wins and difficulty', () => {
    const stats = { ...emptyStats(), kills: 5, headshots: 2, damage: 600 };
    const easy = computeScore({ stats, roundsWon: 3, roundsLost: 1, won: true, timeLeftOnWins: 40, difficulty: 'easy' });
    const hard = computeScore({ stats, roundsWon: 3, roundsLost: 1, won: true, timeLeftOnWins: 40, difficulty: 'hard' });
    expect(easy.total).toBeGreaterThan(0);
    expect(hard.total).toBeGreaterThan(easy.total);
  });
});

describe('settings', () => {
  it('round-trips and clamps garbage', () => {
    const kv = memoryKV();
    saveSettings(kv, { ...DEFAULT_SETTINGS, sensitivity: 1.2 });
    expect(loadSettings(kv).sensitivity).toBe(1.2);
    kv.set('halcyon.settings.v1', JSON.stringify({ sensitivity: 999, quality: 'nope', volume: 'x' }));
    const s = loadSettings(kv);
    expect(s.sensitivity).toBeLessThanOrEqual(3);
    expect(s.quality).toBe('auto');
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(s.bindings.fire).toEqual(['Mouse0']);
  });

  it('persists custom key bindings', () => {
    const kv = memoryKV();
    const s = loadSettings(kv);
    s.bindings.jump = ['KeyJ'];
    saveSettings(kv, s);
    expect(loadSettings(kv).bindings.jump).toEqual(['KeyJ']);
  });
});

describe('idle watchdog', () => {
  it('fires once after the timeout and re-arms on input', () => {
    let fired = 0;
    const w = new IdleWatchdog(60, () => fired++, 0);
    w.update(59);
    expect(fired).toBe(0);
    w.update(60);
    w.update(70);
    expect(fired).toBe(1);
    w.poke(80);
    w.update(139);
    expect(fired).toBe(1);
    w.update(141);
    expect(fired).toBe(2);
  });
});

describe('feature flags', () => {
  it('parses ?f= overrides', () => {
    const f = applyFeatureOverrides({ ...ALL_FEATURES_OFF, bloom: true }, 'ssao,-bloom,unknown');
    expect(f.ssao).toBe(true);
    expect(f.bloom).toBe(false);
  });
});
