import { describe, expect, it } from 'vitest';
import { generateCoverLayout, checkLayout } from '../../src/sim/map/generator';
import { COVER_SLOTS, buildMeridianYard } from '../../src/sim/map/map-def';
import { NavGrid } from '../../src/sim/bots/nav';
import { Rng } from '../../src/sim/core/rng';
import { Bvh } from '../../src/sim/physics/bvh';
import { World } from '../../src/sim/world';

function botMatch(seed: number, utilityAi: boolean, maxTicks = 60 * 60 * 12) {
  const w = new World({
    seed,
    roster: [
      { team: 0, isBot: true, name: 'a0', difficulty: 'normal' },
      { team: 0, isBot: true, name: 'a1', difficulty: 'normal' },
      { team: 0, isBot: true, name: 'a2', difficulty: 'normal' },
      { team: 1, isBot: true, name: 'd0', difficulty: 'normal' },
      { team: 1, isBot: true, name: 'd1', difficulty: 'normal' },
      { team: 1, isBot: true, name: 'd2', difficulty: 'normal' },
    ],
    features: { utilityAi },
  });
  w.startMatch();
  const hashes: number[] = [];
  for (let t = 0; t < maxTicks && !w.match.over; t++) {
    w.step([]);
    if (t % 600 === 0) hashes.push(w.hash());
  }
  return { w, hashes };
}

describe('navigation', () => {
  const map = buildMeridianYard();
  const nav = new NavGrid(map, new Bvh(map.colliders));

  it('finds paths from both spawns to the relay and up to heaven', () => {
    for (const sp of [map.spawns.attackers[0], map.spawns.defenders[0]]) {
      const p = nav.findPath(sp, { x: 11.5, y: 0, z: 25 });
      expect(p).not.toBeNull();
      const end = p![p!.length - 1];
      expect(Math.abs(end.x - 11.5)).toBeLessThan(1.5);
    }
    const h = nav.findPath(map.spawns.attackers[0], { x: -6, y: 1.4, z: 34 });
    expect(h![h!.length - 1].y).toBeCloseTo(1.4, 5);
  });
});

describe('seeded layouts', () => {
  it('generates layouts that pass validation', () => {
    for (let s = 1; s <= 5; s++) {
      const cover = generateCoverLayout(new Rng(s));
      const rep = checkLayout(buildMeridianYard(cover), cover);
      expect(rep.problems).toEqual([]);
    }
  });

  it('the authored layout passes validation', () => {
    const rep = checkLayout(buildMeridianYard(), COVER_SLOTS);
    expect(rep.problems).toEqual([]);
  });
});

describe('bots', () => {
  for (const utility of [false, true]) {
    it(`bot-only match finishes with a winner (utilityAi=${utility})`, () => {
      const { w } = botMatch(11, utility);
      expect(w.match.over).toBe(true);
      const kills = w.agents.reduce((n, a) => n + a.stats.kills, 0);
      expect(kills).toBeGreaterThan(3);
    }, 60_000);
  }

  it('bot matches are deterministic', () => {
    const a = botMatch(5, true, 60 * 60 * 2).hashes;
    const b = botMatch(5, true, 60 * 60 * 2).hashes;
    expect(a).toEqual(b);
  }, 60_000);
});
