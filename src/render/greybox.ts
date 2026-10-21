import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { PALETTE } from '../config/visuals';
import type { Collider, MaterialTag } from '../sim/physics/aabb';
import { createGridTexture } from './textures';

/** Axis-aligned face directions: [normal, u axis, v axis] as axis indices with sign. */
const FACES: { n: [number, number, number]; u: 0 | 1 | 2; v: 0 | 1 | 2 }[] = [
  { n: [1, 0, 0], u: 2, v: 1 },
  { n: [-1, 0, 0], u: 2, v: 1 },
  { n: [0, 1, 0], u: 0, v: 2 },
  { n: [0, -1, 0], u: 0, v: 2 },
  { n: [0, 0, 1], u: 0, v: 1 },
  { n: [0, 0, -1], u: 0, v: 1 },
];

/**
 * Build vertex data for a set of boxes with world-space UVs, so the grid
 * texture lines up seamlessly across neighbouring boxes.
 */
export function boxesToVertexData(boxes: readonly Collider[], tileMetres: number): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const b of boxes) {
    const mn = [b.minX, b.minY, b.minZ];
    const mx = [b.maxX, b.maxY, b.maxZ];
    for (const f of FACES) {
      const axis = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2;
      const sign = f.n[axis];
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
  vd.indices = indices;
  return vd;
}

export function buildGreybox(scene: Scene, colliders: readonly Collider[]): Mesh[] {
  const groups = new Map<MaterialTag, Collider[]>();
  for (const c of colliders) {
    const list = groups.get(c.material) ?? [];
    list.push(c);
    groups.set(c.material, list);
  }
  const meshes: Mesh[] = [];
  for (const [tag, boxes] of groups) {
    const style = PALETTE.surfaces[tag];
    const mesh = new Mesh(`map-${tag}`, scene);
    boxesToVertexData(boxes, style.tileMetres).applyToMesh(mesh, false);
    const mat = new StandardMaterial(`mat-${tag}`, scene);
    mat.diffuseTexture = createGridTexture(scene, `tex-${tag}`, style.grid);
    mat.diffuseColor = Color3.White();
    mat.specularColor = Color3.FromHexString(style.specular);
    mat.specularPower = 48;
    mesh.material = mat;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    meshes.push(mesh);
  }
  return meshes;
}
