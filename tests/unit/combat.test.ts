import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../../src/config/weapons';
import { RAD_PER_UNIT, atan2, radToUnits } from '../../src/sim/core/fmath';
import { eyeHeight } from '../../src/sim/entities/agent';
import { Btn, type InputFrame } from '../../src/sim/input-frame';
import { World } from '../../src/sim/world';
import { forceLive } from './helpers';

/** Shooter (id 0, attackers) and a dummy (id 1, defenders) in open Mid, facing each other. */
function duel(seed = 1, dist = 15) {
  const w = new World({ seed, roster: [{ team: 0, isBot: false, name: 's' }, { team: 1, isBot: false, name: 'd' }] });
  w.startMatch();
  forceLive(w);
  const [s, d] = w.agents;
  s.x = 0; s.z = -25; s.y = 0;
  d.x = 0; d.z = -25 + dist; d.y = 0;
  return { w, s, d };
}

function aimAt(w: World, from: { x: number; y: number; z: number }, to: { x: number; z: number }, ty: number): InputFrame {
  const ey = from.y + eyeHeight(w.agents[0]);
  const dx = to.x - from.x, dz = to.z - from.z;
  return { buttons: 0, yaw: radToUnits(atan2(dx, dz)) & 0xffff, pitch: radToUnits(atan2(ty - ey, Math.sqrt(dx * dx + dz * dz))) };
}

describe('weapons', () => {
  it('rifle one-taps the head', () => {
    const { w, s, d } = duel();
    const f = aimAt(w, s, d, d.y + d.height - 0.12);
    w.step([{ ...f, buttons: Btn.Fire }, undefined]);
    expect(d.alive).toBe(false);
    expect(s.stats.headshots).toBe(1);
    expect(w.events.some((e) => e.type === 'kill')).toBe(true);
  });

  it('rifle body shots deal configured damage', () => {
    const { w, s, d } = duel();
    const f = aimAt(w, s, d, d.y + 1.1);
    w.step([{ ...f, buttons: Btn.Fire }, undefined]);
    expect(d.hp).toBe(100 - WEAPONS.rifle.damage.body);
  });

  it('automatic fire rate matches config over one second', () => {
    const { w, s } = duel();
    s.z = -40; // shoot at nothing in particular
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      w.step([{ buttons: Btn.Fire, yaw: 32768, pitch: 0 }, undefined]);
      shots += w.events.filter((e) => e.type === 'shot').length;
    }
    expect(shots).toBe(Math.round(1 / WEAPONS.rifle.fireInterval));
  });

  it('semi-auto fires once per click', () => {
    const { w } = duel();
    let shots = 0;
    w.step([{ buttons: Btn.Weapon2, yaw: 32768, pitch: 0 }, undefined]);
    for (let i = 0; i < 40; i++) w.step([{ buttons: 0, yaw: 32768, pitch: 0 }, undefined]);
    for (let i = 0; i < 60; i++) {
      w.step([{ buttons: Btn.Fire, yaw: 32768, pitch: 0 }, undefined]);
      shots += w.events.filter((e) => e.type === 'shot').length;
    }
    expect(shots).toBe(1);
  });

  it('recoil follows the pattern while spraying', () => {
    const { w, s } = duel();
    const kicks: number[] = [];
    for (let i = 0; i < 60; i++) {
      w.step([{ buttons: Btn.Fire, yaw: 32768, pitch: 0 }, undefined]);
      if (w.events.some((e) => e.type === 'shot')) kicks.push(s.weapon.recoilPitch);
    }
    const pat = WEAPONS.rifle.recoil.pattern;
    let expected = 0;
    for (let i = 0; i < 5; i++) expected += pat[i][0];
    expect(kicks[4] / (Math.PI / 180)).toBeGreaterThan(expected * 0.9);
    // recovers after release
    for (let i = 0; i < 120; i++) w.step([{ buttons: 0, yaw: 32768, pitch: 0 }, undefined]);
    expect(s.weapon.recoilPitch).toBe(0);
  });

  it('first shot is accurate standing, inaccurate while running', () => {
    let still = 0, running = 0;
    for (let seed = 1; seed <= 60; seed++) {
      {
        const { w, s, d } = duel(seed, 25);
        const f = aimAt(w, s, d, d.y + d.height - 0.15);
        w.step([{ ...f, buttons: Btn.Fire }, undefined]);
        if (!d.alive) still++;
      }
      {
        const { w, s, d } = duel(seed, 25);
        s.x = -3;
        for (let i = 0; i < 20; i++) w.step([{ buttons: Btn.Right, yaw: 0, pitch: 0 }, undefined]);
        const f = aimAt(w, s, d, d.y + d.height - 0.15);
        w.step([{ ...f, buttons: Btn.Fire | Btn.Right }, undefined]);
        if (!d.alive) running++;
      }
    }
    expect(still).toBeGreaterThan(55);
    expect(running).toBeLessThan(still / 2);
  });

  it('reload refills the magazine from reserve', () => {
    const { w, s } = duel();
    for (let i = 0; i < 30; i++) w.step([{ buttons: Btn.Fire, yaw: 32768, pitch: 0 }, undefined]);
    const before = s.weapon.ammo.rifle.mag;
    w.step([{ buttons: Btn.Reload, yaw: 32768, pitch: 0 }, undefined]);
    for (let i = 0; i < 60 * 3; i++) w.step([{ buttons: 0, yaw: 32768, pitch: 0 }, undefined]);
    expect(before).toBeLessThan(WEAPONS.rifle.magSize);
    expect(s.weapon.ammo.rifle.mag).toBe(WEAPONS.rifle.magSize);
    expect(s.weapon.ammo.rifle.reserve).toBe(WEAPONS.rifle.reserve - (WEAPONS.rifle.magSize - before));
  });

  it('cannot fire during the prep phase', () => {
    const w = new World({ seed: 1, roster: [{ team: 0, isBot: false, name: 's' }] });
    w.startMatch();
    w.step([{ buttons: Btn.Fire | Btn.Forward, yaw: 0, pitch: 0 }]);
    expect(w.events.some((e) => e.type === 'shot')).toBe(false);
    expect(w.agents[0].z).toBe(w.map.spawns.attackers[0].z);
  });

  void RAD_PER_UNIT;
});
