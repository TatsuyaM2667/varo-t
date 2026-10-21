import { describe, expect, it } from 'vitest';
import { MOVEMENT } from '../../src/config/movement';
import { horizontalSpeed } from '../../src/sim/entities/agent';
import { Btn, type InputFrame } from '../../src/sim/input-frame';
import { World } from '../../src/sim/world';

function setup() {
  const w = new World({ seed: 1 });
  const a = w.addAgent({ team: 0, isBot: false, name: 'p' });
  w.spawnAll();
  return { w, a };
}

const frame = (buttons: number, yaw = 0, pitch = 0): InputFrame => ({ buttons, yaw, pitch });

describe('agent movement', () => {
  it('reaches run speed and stays grounded on flat floor', () => {
    const { w, a } = setup();
    for (let i = 0; i < 30; i++) w.step([frame(Btn.Forward)]);
    expect(a.grounded).toBe(true);
    expect(horizontalSpeed(a)).toBeCloseTo(MOVEMENT.runSpeed, 6);
    expect(a.z).toBeGreaterThan(-42);
  });

  it('walk and crouch are slower than run', () => {
    const run = setup();
    const walk = setup();
    const crouch = setup();
    for (let i = 0; i < 40; i++) {
      run.w.step([frame(Btn.Forward)]);
      walk.w.step([frame(Btn.Forward | Btn.Walk)]);
      crouch.w.step([frame(Btn.Forward | Btn.Crouch)]);
    }
    expect(horizontalSpeed(walk.a)).toBeCloseTo(MOVEMENT.walkSpeed, 6);
    expect(horizontalSpeed(crouch.a)).toBeCloseTo(MOVEMENT.crouchSpeed, 6);
    expect(crouch.a.height).toBeCloseTo(MOVEMENT.crouchHeight, 6);
    expect(run.a.noisy).toBe(true);
    expect(walk.a.noisy).toBe(false);
  });

  it('jump apex matches config', () => {
    const { w, a } = setup();
    w.step([frame(Btn.Jump)]);
    let apex = 0;
    for (let i = 0; i < 120; i++) {
      w.step([frame(Btn.Jump)]); // holding does not re-jump mid-air
      apex = Math.max(apex, a.y);
    }
    expect(apex).toBeGreaterThan(MOVEMENT.jumpHeight * 0.95);
    expect(apex).toBeLessThan(MOVEMENT.jumpHeight * 1.02);
    expect(a.grounded).toBe(true);
  });

  it('counter-strafe stops quickly', () => {
    const { w, a } = setup();
    for (let i = 0; i < 30; i++) w.step([frame(Btn.Right)]);
    let ticks = 0;
    while (horizontalSpeed(a) > 0.01 && ticks < 60) {
      w.step([frame(0)]);
      ticks++;
    }
    expect(ticks).toBeLessThanOrEqual(10);
  });

  it('dash covers about the configured distance', async () => {
    const { startDash } = await import('../../src/sim/entities/agent');
    const { w, a } = setup();
    const z0 = a.z;
    startDash(a, frame(0));
    const n = Math.round(MOVEMENT.dash.duration * 60);
    for (let i = 0; i < n; i++) w.step([frame(0)]);
    expect(a.z - z0).toBeGreaterThan(MOVEMENT.dash.distance * 0.95);
    expect(a.z - z0).toBeLessThan(MOVEMENT.dash.distance * 1.05);
  });

  it('cannot leave the map by running into walls for a long time', () => {
    const { w, a } = setup();
    for (let yaw = 0; yaw < 65536; yaw += 8192) {
      for (let i = 0; i < 600; i++) w.step([frame(Btn.Forward | (i % 40 === 0 ? Btn.Jump : 0), yaw)]);
      const b = w.map.bounds;
      expect(a.x).toBeGreaterThan(b.minX);
      expect(a.x).toBeLessThan(b.maxX);
      expect(a.z).toBeGreaterThan(b.minZ);
      expect(a.z).toBeLessThan(b.maxZ);
      expect(a.y).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('can climb the stairs to heaven', () => {
    const { w, a } = setup();
    a.x = -2; a.z = 24; a.y = 0;
    for (let i = 0; i < 120; i++) w.step([frame(Btn.Forward)]);
    expect(a.y).toBeCloseTo(1.4, 6);
    expect(a.z).toBeGreaterThan(30);
  });
});
