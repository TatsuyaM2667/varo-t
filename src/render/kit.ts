import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';

/**
 * One primitive of a rigid body part. Sizes are metres:
 *  box [w, h, d] · sphere [dx, dy, dz] · capsule [radius, length] along Z ·
 *  cyl [diameterTop, length, diameterBottom] along Z
 */
export interface Piece {
  shape: 'box' | 'sphere' | 'capsule' | 'cyl';
  size: number[];
  pos?: [number, number, number];
  rot?: [number, number, number];
  color: Color3;
}

export const c3 = (hex: string): Color3 => Color3.FromHexString(hex);

/**
 * Bakes primitives into one mesh with per-vertex colours, so a whole body
 * part (e.g. a torso with plates, pouches and backpack) is one draw call.
 */
export function buildPart(scene: Scene, name: string, pieces: readonly Piece[], material: Material): Mesh {
  const parts: Mesh[] = [];
  for (const p of pieces) {
    let m: Mesh;
    const s = p.size;
    switch (p.shape) {
      case 'box':
        m = CreateBox(name, { width: s[0], height: s[1], depth: s[2] }, scene);
        break;
      case 'sphere':
        m = CreateSphere(name, { diameterX: s[0], diameterY: s[1], diameterZ: s[2], segments: 8 }, scene);
        break;
      case 'capsule':
        m = CreateCapsule(name, { radius: s[0], height: s[1], tessellation: 10, subdivisions: 1, capSubdivisions: 3, orientation: Vector3.Forward() }, scene);
        break;
      case 'cyl':
        m = CreateCylinder(name, { diameterTop: s[0], height: s[1], diameterBottom: s[2] ?? s[0], tessellation: 12 }, scene);
        m.rotation.x = Math.PI / 2;
        m.bakeCurrentTransformIntoVertices();
        break;
    }
    if (p.rot) m.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    if (p.pos) m.position.set(p.pos[0], p.pos[1], p.pos[2]);
    m.bakeCurrentTransformIntoVertices();
    const n = m.getTotalVertices();
    const colors = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      colors[i * 4] = p.color.r;
      colors[i * 4 + 1] = p.color.g;
      colors[i * 4 + 2] = p.color.b;
      colors[i * 4 + 3] = 1;
    }
    m.setVerticesData(VertexBuffer.ColorKind, colors);
    parts.push(m);
  }
  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
  merged.name = name;
  merged.material = material;
  merged.isPickable = false;
  return merged;
}

const detailCache = new WeakMap<Scene, DynamicTexture>();

/**
 * Shared detail map multiplied over vertex colours: subtle fabric noise and
 * panel seams along each primitive's UV border (reads as armour plating).
 */
export function detailTexture(scene: Scene): DynamicTexture {
  const hit = detailCache.get(scene);
  if (hit) return hit;
  const n = 128;
  const t = new DynamicTexture('kit-detail', { width: n, height: n }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#ececec';
  ctx.fillRect(0, 0, n, n);
  let seed = 99;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 900; i++) {
    const v = 200 + Math.floor(rnd() * 55);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.floor(rnd() * n), Math.floor(rnd() * n), 2, 2);
  }
  ctx.strokeStyle = 'rgba(40,40,40,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, n - 2, n - 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(5, 5, n - 10, n - 10);
  t.update();
  detailCache.set(scene, t);
  return t;
}
