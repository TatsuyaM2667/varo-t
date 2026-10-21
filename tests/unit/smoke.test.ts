import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../../src/config/abilities';
import { Rng } from '../../src/sim/core/rng';
import { deploySmoke, smokeBlocks, stepSmoke } from '../../src/sim/entities/smoke';
import { Btn } from '../../src/sim/input-frame';
import { buildMeridianYard } from '../../src/sim/map/map-def';
import { Bvh } from '../../src/sim/physics/bvh';
import { liveWorld } from './helpers';

describe('smoke', () => {
  const map = buildMeridianYard();
  const bvh = new Bvh(map.colliders);

  it('blocks sight through its centre once expanded, not beside it', () => {
    const s = deploySmoke(1, 0, 0, 0, -15, new Rng(1), bvh);
    for (let i = 0; i < 60; i++) stepSmoke(s);
    expect(smokeBlocks([s], 0, 1.6, -25, 0, 1.6, -5)).toBe(true);
    expect(smokeBlocks([s], 5.8, 1.6, -25, 5.8, 1.6, -5)).toBe(false);
  });

  it('does not block before it expands and after it expires', () => {
    const s = deploySmoke(1, 0, 0, 0, -15, new Rng(1), bvh);
    stepSmoke(s);
    expect(smokeBlocks([s], 0, 1.6, -25, 0, 1.6, -5)).toBe(false);
    let alive = true;
    for (let i = 0; i < ABILITIES.smoke.duration * 60 + 5 && alive; i++) alive = stepSmoke(s);
    expect(alive).toBe(false);
  });

  it('thrown smoke deploys and world LOS respects it', () => {
    const w = liveWorld();
    const a = w.agents[0];
    a.x = 0; a.z = -28;
    w.step([{ buttons: Btn.Ability1, yaw: 0, pitch: 0 }]);
    let deployed = false;
    for (let i = 0; i < 200 && !deployed; i++) {
      w.step([{ buttons: 0, yaw: 0, pitch: 0 }]);
      deployed = w.events.some((e) => e.type === 'smokeDeploy');
    }
    expect(deployed).toBe(true);
    for (let i = 0; i < 60; i++) w.step([{ buttons: 0, yaw: 0, pitch: 0 }]);
    const s = w.smokes[0];
    expect(w.canSee(s.x, 1.5, s.z - 8, s.x, 1.5, s.z + 8)).toBe(false);
    expect(a.smokeCharges).toBe(ABILITIES.smoke.charges - 1);
  });

  it('dash moves the agent and consumes a charge', () => {
    const w = liveWorld();
    const a = w.agents[0];
    const z0 = a.z;
    w.step([{ buttons: Btn.Ability2, yaw: 0, pitch: 0 }]);
    for (let i = 0; i < 15; i++) w.step([{ buttons: 0, yaw: 0, pitch: 0 }]);
    expect(a.z - z0).toBeGreaterThan(3.5);
    expect(a.dashCharges).toBe(0);
  });
});
