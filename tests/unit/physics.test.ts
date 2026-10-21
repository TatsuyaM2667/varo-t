import { describe, expect, it } from 'vitest';
import type { Collider } from '../../src/sim/physics/aabb';
import { Bvh } from '../../src/sim/physics/bvh';
import { type Body, moveBody } from '../../src/sim/physics/body';

function box(id: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Collider {
  return { id, material: 'wall', minX, minY, minZ, maxX, maxY, maxZ };
}

const floor = box(0, -50, -1, -50, 50, 0, 50);

describe('Bvh', () => {
  it('raycast returns the nearest hit', () => {
    const bvh = new Bvh([floor, box(1, 5, 0, -1, 6, 3, 1), box(2, 10, 0, -1, 11, 3, 1)]);
    const hit = bvh.raycast(0, 1, 0, 1, 0, 0, 100);
    expect(hit?.collider.id).toBe(1);
    expect(hit?.t).toBeCloseTo(5, 9);
  });

  it('raycast respects maxT and filters', () => {
    const bvh = new Bvh([floor, box(1, 5, 0, -1, 6, 3, 1)]);
    expect(bvh.raycast(0, 1, 0, 1, 0, 0, 4)).toBeNull();
    expect(bvh.raycast(0, 1, 0, 1, 0, 0, 100, (c) => c.id !== 1)).toBeNull();
  });

  it('agrees with brute force on many random rays', () => {
    const items: Collider[] = [];
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const x = rnd() * 80 - 40, z = rnd() * 80 - 40, y = rnd() * 3;
      items.push(box(i, x, y, z, x + 0.5 + rnd() * 3, y + 0.5 + rnd() * 3, z + 0.5 + rnd() * 3));
    }
    const bvh = new Bvh(items);
    for (let k = 0; k < 300; k++) {
      const ox = rnd() * 80 - 40, oy = rnd() * 3, oz = rnd() * 80 - 40;
      const dx = rnd() - 0.5, dy = (rnd() - 0.5) * 0.2, dz = rnd() - 0.5;
      const hit = bvh.raycast(ox, oy, oz, dx, dy, dz, 1000);
      let bestT = Infinity;
      for (const it of items) {
        const t = rayBrute(ox, oy, oz, dx, dy, dz, it);
        if (t >= 0 && t < bestT) bestT = t;
      }
      if (bestT === Infinity) expect(hit).toBeNull();
      else expect(hit!.t).toBeCloseTo(bestT, 9);
    }
  });
});

function rayBrute(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Collider): number {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (d[i] === 0) { if (o[i] < mn[i] || o[i] > mx[i]) return -1; continue; }
    const t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < Math.max(tmin, 0)) return -1;
  return Math.max(tmin, 0);
}

describe('moveBody', () => {
  const thinWall = box(1, 2, 0, -5, 2.05, 3, 5);
  const bvh = new Bvh([floor, thinWall, box(2, -5, 0, 4, 5, 0.4, 6), box(3, -5, 0, 8, 5, 0.6, 10)]);
  const mk = (x: number, z: number): Body => ({ x, y: 0, z, radius: 0.3, height: 1.8 });

  it('never tunnels through a thin wall, even at absurd speed', () => {
    const b = mk(0, 0);
    moveBody(bvh, b, 1000, 0, 0, true, 0);
    expect(b.x).toBeCloseTo(2 - 0.3, 9);
  });

  it('slides along walls', () => {
    const b = mk(1.6, 0);
    const r = moveBody(bvh, b, 1, 0, 1, true, 0);
    expect(r.hitX).toBe(true);
    expect(b.z).toBeCloseTo(1, 9);
  });

  it('steps up a 0.4 m ledge but not a 0.6 m one', () => {
    const b = mk(-3, 3);
    moveBody(bvh, b, 0, -0.01, 1, true, 0.42);
    expect(b.y).toBeCloseTo(0.4, 6);
    const c = mk(-3, 7.5);
    moveBody(bvh, c, 0, -0.01, 1, true, 0.42);
    expect(c.y).toBeCloseTo(0, 9);
    expect(c.z).toBeCloseTo(8 - 0.3, 9);
  });

  it('lands on the floor', () => {
    const b: Body = { x: 0, y: 1, z: 0, radius: 0.3, height: 1.8 };
    const r = moveBody(bvh, b, 0, -5, 0, false, 0);
    expect(r.landed).toBe(true);
    expect(b.y).toBe(0);
  });
});
