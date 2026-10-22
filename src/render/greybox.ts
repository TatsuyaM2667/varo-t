import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Collider, MaterialTag } from '../sim/physics/aabb';
import type { SurfaceMaterials } from './materials';

/** Axis-aligned face directions: [normal, u axis, v axis] as axis indices. */
const FACES: { n: [number, number, number]; u: 0 | 1 | 2; v: 0 | 1 | 2 }[] = [
  { n: [1, 0, 0], u: 2, v: 1 },
  { n: [-1, 0, 0], u: 2, v: 1 },
  { n: [0, 1, 0], u: 0, v: 2 },
  { n: [0, -1, 0], u: 0, v: 2 },
  { n: [0, 0, 1], u: 0, v: 1 },
  { n: [0, 0, -1], u: 0, v: 1 },
];

/**
 * Vertex data for a set of boxes with world-space UVs, so the grid texture
 * lines up seamlessly across neighbouring boxes. Bottom faces at y <= 0 are
 * skipped (never visible).
 */
export function boxesToVertexData(boxes: readonly Collider[], tileMetres: number): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const b of boxes) {
    const tint = b.tint ? Color3.FromHexString(b.tint) : null;
    const mn = [b.minX, b.minY, b.minZ];
    const mx = [b.maxX, b.maxY, b.maxZ];
    for (const f of FACES) {
      const axis = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2;
      const sign = f.n[axis];
      if (axis === 1 && sign < 0 && b.minY <= 0) continue;
      const plane = sign > 0 ? mx[axis] : mn[axis];
      const base = positions.length / 3;
      const corners: [number, number][] = [
        [mn[f.u], mn[f.v]],
        [mx[f.u], mn[f.v]],
        [mx[f.u], mx[f.v]],
        [mn[f.u], mx[f.v]],
      ];
      for (const [cu, cv] of corners) {
        const p = [0, 0, 0];
        p[axis] = plane;
        p[f.u] = cu;
        p[f.v] = cv;
        positions.push(p[0], p[1], p[2]);
        normals.push(f.n[0], f.n[1], f.n[2]);
        // per-collider tint (zone colours); tops slightly brighter than sides
        const shade = axis === 1 ? 1.04 : 1;
        if (tint) colors.push(Math.min(1, tint.r * shade), Math.min(1, tint.g * shade), Math.min(1, tint.b * shade), 1);
        else colors.push(1, 1, 1, 1);
        uvs.push(cu / tileMetres, cv / tileMetres);
      }
      // Babylon's front faces wind so that cross(p1 - p0, p2 - p0) opposes the normal.
      const e1 = [0, 0, 0];
      const e2 = [0, 0, 0];
      e1[f.u] = 1;
      e2[f.v] = 1;
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const facing = cross[0] * f.n[0] + cross[1] * f.n[1] + cross[2] * f.n[2];
      if (facing > 0) indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.colors = colors;
  vd.indices = indices;
  return vd;
}

export interface Greybox {
  /** merged static meshes per material */
  statics: Mesh[];
  /** destructible pieces, by collider id */
  breakables: Map<number, Mesh>;
  dispose(): void;
}

export function buildGreybox(scene: Scene, colliders: readonly Collider[], mats: SurfaceMaterials, pbr: boolean): Greybox {
  const surfaces = mats.surfaces;
  const groups = new Map<MaterialTag, Collider[]>();
  const breakables = new Map<number, Mesh>();
  for (const c of colliders) {
    if (c.breakHp !== undefined) {
      const m = new Mesh(`break-${c.id}`, scene);
      boxesToVertexData([c], surfaces[c.material].tileMetres).applyToMesh(m, false);
      m.material = mats.get(c.material, pbr);
      m.receiveShadows = true;
      m.isPickable = false;
      breakables.set(c.id, m);
      continue;
    }
    const list = groups.get(c.material) ?? [];
    list.push(c);
    groups.set(c.material, list);
  }
  const statics: Mesh[] = [];
  for (const [tag, boxes] of groups) {
    const mesh = new Mesh(`map-${tag}`, scene);
    boxesToVertexData(boxes, surfaces[tag].tileMetres).applyToMesh(mesh, false);
    mesh.material = mats.get(tag, pbr);
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    statics.push(mesh);
  }
  return {
    statics,
    breakables,
    dispose() {
      for (const m of statics) m.dispose();
      for (const m of breakables.values()) m.dispose();
    },
  };
}
