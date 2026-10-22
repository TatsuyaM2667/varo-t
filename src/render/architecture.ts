import { Constants } from '@babylonjs/core/Engines/constants';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { Theme } from '../config/themes';
import { PALETTE } from '../config/visuals';
import type { FloorKind, MapData } from '../sim/map/map-def';
import type { Collider } from '../sim/physics/aabb';
import { type Piece, buildPart, c3 } from './kit';
import { createGridTexture } from './textures';

/**
 * Render-only architecture generated from a stage map: per-zone floor
 * finishes, baseboards and cornices, building windows and floor bands,
 * archway frames, roof beams, trees, market stalls, barrels, lamps,
 * banners and the site marking. Nothing here affects gameplay; everything
 * is batched into a handful of meshes (one per material).
 */
export interface Architecture {
  meshes: Mesh[];
  dispose(): void;
}

/** Axis-aligned coloured boxes batched into one mesh (with world UVs for textured batches). */
class BoxBatch {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  constructor(private readonly tile = 2) {}

  box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, col: Color3, skipBottom = true): void {
    const mn = [minX, minY, minZ];
    const mx = [maxX, maxY, maxZ];
    const faces: { n: [number, number, number]; u: 0 | 1 | 2; v: 0 | 1 | 2 }[] = [
      { n: [1, 0, 0], u: 2, v: 1 },
      { n: [-1, 0, 0], u: 2, v: 1 },
      { n: [0, 1, 0], u: 0, v: 2 },
      { n: [0, -1, 0], u: 0, v: 2 },
      { n: [0, 0, 1], u: 0, v: 1 },
      { n: [0, 0, -1], u: 0, v: 1 },
    ];
    for (const f of faces) {
      const axis = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2;
      const sign = f.n[axis];
      if (skipBottom && axis === 1 && sign < 0) continue;
      const plane = sign > 0 ? mx[axis] : mn[axis];
      const base = this.positions.length / 3;
      for (const [cu, cv] of [
        [mn[f.u], mn[f.v]],
        [mx[f.u], mn[f.v]],
        [mx[f.u], mx[f.v]],
        [mn[f.u], mx[f.v]],
      ]) {
        const p = [0, 0, 0];
        p[axis] = plane;
        p[f.u] = cu;
        p[f.v] = cv;
        this.positions.push(p[0], p[1], p[2]);
        this.normals.push(f.n[0], f.n[1], f.n[2]);
        this.colors.push(col.r, col.g, col.b, 1);
        this.uvs.push(cu / this.tile, cv / this.tile);
      }
      // winding: cross(p1 - p0, p2 - p0) must oppose the normal (Babylon front faces)
      const e1 = [0, 0, 0];
      const e2 = [0, 0, 0];
      e1[f.u] = 1;
      e2[f.v] = 1;
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const facing = cr[0] * f.n[0] + cr[1] * f.n[1] + cr[2] * f.n[2];
      if (facing > 0) this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** Horizontal quad (top face only), e.g. a floor finish. */
  quad(minX: number, minZ: number, maxX: number, maxZ: number, y: number, col: Color3): void {
    const base = this.positions.length / 3;
    for (const [x, z] of [
      [minX, minZ],
      [maxX, minZ],
      [maxX, maxZ],
      [minX, maxZ],
    ]) {
      this.positions.push(x, y, z);
      this.normals.push(0, 1, 0);
      this.colors.push(col.r, col.g, col.b, 1);
      this.uvs.push(x / this.tile, z / this.tile);
    }
    // +Y normal: (x,z) order above gives cross pointing -Y for (0,1,2) → front face
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(scene: Scene, name: string): Mesh | null {
    if (!this.indices.length) return null;
    const vd = new VertexData();
    vd.positions = this.positions;
    vd.normals = this.normals;
    vd.colors = this.colors;
    vd.uvs = this.uvs;
    vd.indices = this.indices;
    const m = new Mesh(name, scene);
    vd.applyToMesh(m, false);
    m.isPickable = false;
    m.receiveShadows = true;
    m.freezeWorldMatrix();
    return m;
  }
}

type DecorMaterial = StandardMaterial | PBRMaterial;

/**
 * Decor materials follow the map's lighting model: PBR (+IBL) on High/Ultra
 * so shaded areas get the same ambient light as the walls, Standard otherwise.
 */
function mat(scene: Scene, name: string, opts: { emissive?: Color3; spec?: number; twoSided?: boolean; texture?: Texture }, pbr: boolean): DecorMaterial {
  if (pbr) {
    const m = new PBRMaterial(name, scene);
    m.albedoColor = Color3.White();
    m.metallic = (opts.spec ?? 0.08) > 0.2 ? 0.45 : 0;
    m.roughness = (opts.spec ?? 0.08) > 0.3 ? 0.3 : 0.85;
    m.realTimeFiltering = true;
    m.realTimeFilteringQuality = Constants.TEXTURE_FILTERING_QUALITY_LOW;
    if (opts.emissive) m.emissiveColor = opts.emissive;
    if (opts.twoSided) m.backFaceCulling = false;
    if (opts.texture) m.albedoTexture = opts.texture;
    return m;
  }
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.White();
  m.specularColor = new Color3(opts.spec ?? 0.08, opts.spec ?? 0.08, opts.spec ?? 0.08);
  if (opts.emissive) m.emissiveColor = opts.emissive;
  if (opts.twoSided) m.backFaceCulling = false;
  if (opts.texture) m.diffuseTexture = opts.texture;
  return m;
}

/** Floor-letter decal for the site ("A"), drawn once. */
function siteDecal(scene: Scene, color: string): DynamicTexture {
  const n = 256;
  const t = new DynamicTexture('site-decal', { width: n, height: n }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, n, n);
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(n / 2, n / 2, n * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `900 ${Math.round(n * 0.62)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('A', n / 2, n / 2 + n * 0.03);
  t.update();
  t.hasAlpha = true;
  return t;
}

export function buildArchitecture(scene: Scene, map: MapData, theme: Theme, pbr: boolean): Architecture {
  const meshes: Mesh[] = [];
  const disposables: { dispose(): void }[] = [];
  const add = (m: Mesh | null, material: DecorMaterial): void => {
    if (!m) return;
    m.material = material;
    meshes.push(m);
  };
  const visual = map.visual!;
  const inside = (x: number, y: number, z: number): boolean =>
    map.colliders.some((c) => c.material !== 'floor' && x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ);
  const inBounds = (x: number, z: number): boolean => x > map.bounds.minX && x < map.bounds.maxX && z > map.bounds.minZ && z < map.bounds.maxZ;

  // --- floor finishes per zone (ground level; raised terraces show their own tops) ---
  const floorBatches = new Map<FloorKind, BoxBatch>();
  const sorted = [...visual.floors].sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ));
  sorted.forEach((f, i) => {
    const style = theme.floors[f.kind];
    let batch = floorBatches.get(f.kind);
    if (!batch) {
      batch = new BoxBatch(style.tileMetres);
      floorBatches.set(f.kind, batch);
    }
    batch.quad(f.minX, f.minZ, f.maxX, f.maxZ, 0.006 + i * 0.002, f.kind === 'site' ? Color3.White() : c3(f.color));
  });
  for (const [kind, batch] of floorBatches) {
    const tex = createGridTexture(scene, `floor-${kind}`, theme.floors[kind].grid);
    disposables.push(tex);
    const m = mat(scene, `floor-${kind}`, { texture: tex, spec: kind === 'metal' ? 0.25 : 0.05 }, pbr);
    disposables.push(m);
    add(batch.build(scene, `floor-${kind}`), m);
  }

  // --- trims, bands, windows, arch frames, roof beams ---
  const trims = new BoxBatch();
  const glass = new BoxBatch();
  const frame = c3(theme.windowFrame);
  const glassCol = c3(theme.windowGlass);
  for (const c of map.colliders as Collider[]) {
    const tint = c3(c.tint ?? '#cccccc');
    if (c.material === 'wall' && (c.style === undefined || c.style === 'building')) {
      const e = 0.07;
      trims.box(c.minX - e, c.minY, c.minZ - e, c.maxX + e, c.minY + 0.38, c.maxZ + e, tint.scale(theme.trimDark));
      trims.box(c.minX - 0.12, c.maxY - 0.28, c.minZ - 0.12, c.maxX + 0.12, c.maxY + 0.06, c.maxZ + 0.12, tint.scale(theme.trimLight));
      if (c.style === 'building') {
        for (const y of [3.9, 6.9]) {
          if (y > c.maxY - 1) continue;
          trims.box(c.minX - 0.05, y, c.minZ - 0.05, c.maxX + 0.05, y + 0.18, c.maxZ + 0.05, tint.scale(0.86));
        }
        // windows on faces that look onto walkable space
        const faces: { axis: 'x' | 'z'; at: number; out: number; from: number; to: number }[] = [
          { axis: 'x', at: c.maxX, out: 1, from: c.minZ, to: c.maxZ },
          { axis: 'x', at: c.minX, out: -1, from: c.minZ, to: c.maxZ },
          { axis: 'z', at: c.maxZ, out: 1, from: c.minX, to: c.maxX },
          { axis: 'z', at: c.minZ, out: -1, from: c.minX, to: c.maxX },
        ];
        for (const f of faces) {
          const len = f.to - f.from;
          const count = Math.floor((len - 0.8) / 3.2);
          if (count <= 0) continue;
          const pad = (len - count * 3.2) / 2 + 1.6;
          for (let i = 0; i < count; i++) {
            const t = f.from + pad + i * 3.2;
            const ox = f.axis === 'x' ? f.at + f.out * 0.9 : t;
            const oz = f.axis === 'z' ? f.at + f.out * 0.9 : t;
            if (!inBounds(ox, oz) || inside(ox, 1.0, oz)) continue;
            for (const y0 of [4.5, 7.5]) {
              if (y0 + 1.9 > c.maxY - 0.4) continue;
              const d = f.out;
              if (f.axis === 'x') {
                trims.box(Math.min(f.at, f.at + d * 0.08), y0 - 0.12, t - 0.72, Math.max(f.at, f.at + d * 0.08), y0 + 1.82, t + 0.72, frame);
                glass.box(Math.min(f.at, f.at + d * 0.1), y0, t - 0.58, Math.max(f.at, f.at + d * 0.1), y0 + 1.7, t + 0.58, glassCol);
              } else {
                trims.box(t - 0.72, y0 - 0.12, Math.min(f.at, f.at + d * 0.08), t + 0.72, y0 + 1.82, Math.max(f.at, f.at + d * 0.08), frame);
                glass.box(t - 0.58, y0, Math.min(f.at, f.at + d * 0.1), t + 0.58, y0 + 1.7, Math.max(f.at, f.at + d * 0.1), glassCol);
              }
            }
          }
        }
      }
    } else if (c.style === 'lintel') {
      // arch frame: a darker band under the lintel and posts down its sides
      trims.box(c.minX - 0.08, c.minY - 0.22, c.minZ - 0.08, c.maxX + 0.08, c.minY + 0.05, c.maxZ + 0.08, tint.scale(theme.trimDark));
    } else if (c.style === 'roof') {
      const beam = tint.scale(0.55);
      const alongX = c.maxX - c.minX >= c.maxZ - c.minZ;
      if (alongX) for (let x = c.minX + 1; x < c.maxX; x += 2) trims.box(x - 0.1, c.minY - 0.3, c.minZ, x + 0.1, c.minY, c.maxZ, beam, false);
      else for (let z = c.minZ + 1; z < c.maxZ; z += 2) trims.box(c.minX, c.minY - 0.3, z - 0.1, c.maxX, c.minY, z + 0.1, beam, false);
      trims.box(c.minX - 0.15, c.maxY - 0.05, c.minZ - 0.15, c.maxX + 0.15, c.maxY + 0.12, c.maxZ + 0.15, tint.scale(0.7));
    } else if (c.style === 'pillar') {
      const cx = (c.minX + c.maxX) / 2;
      const cz = (c.minZ + c.maxZ) / 2;
      const h = (c.maxX - c.minX) / 2 + 0.12;
      trims.box(cx - h, c.minY, cz - h, cx + h, c.minY + 0.4, cz + h, tint.scale(theme.trimDark));
      if (c.maxY > 3) trims.box(cx - h, c.maxY - 0.35, cz - h, cx + h, c.maxY, cz + h, tint.scale(theme.trimLight));
    }
  }
  const trimMat = mat(scene, 'arch-trim', { spec: 0.06 }, pbr);
  const glassMat = mat(scene, 'arch-glass', { spec: 0.6, emissive: theme.windowGlass.startsWith('#ff') ? c3(theme.windowGlass).scale(0.55) : c3(theme.windowGlass).scale(0.15) }, pbr);
  disposables.push(trimMat, glassMat);
  add(trims.build(scene, 'arch-trims'), trimMat);
  add(glass.build(scene, 'arch-glass'), glassMat);

  // --- props: trees, stalls, barrels, lamps ---
  const solid: Piece[] = [];
  const foliage: Piece[] = [];
  const cloth: Piece[] = [];
  const glow: Piece[] = [];
  const pick = <T,>(list: T[], k: number): T => list[((k % list.length) + list.length) % list.length];
  visual.props.forEach((p, i) => {
    switch (p.kind) {
      case 'tree': {
        solid.push({ shape: 'cyl', size: [0.22, 2.4, 0.3], pos: [p.x, p.y + 1.2, p.z], rot: [Math.PI / 2, 0, 0], color: c3(theme.trunk) });
        const leaf = c3(pick(theme.foliage, i));
        foliage.push({ shape: 'sphere', size: [2.4, 1.7, 2.4], pos: [p.x, p.y + 2.9, p.z], color: leaf });
        foliage.push({ shape: 'sphere', size: [1.6, 1.3, 1.6], pos: [p.x + 0.6, p.y + 3.5, p.z - 0.3], color: leaf.scale(1.08) });
        foliage.push({ shape: 'sphere', size: [1.5, 1.2, 1.5], pos: [p.x - 0.55, p.y + 3.3, p.z + 0.45], color: leaf.scale(0.92) });
        break;
      }
      case 'stall': {
        const wood = c3('#6b4a32');
        for (const [dx, dz] of [[-0.85, -0.45], [0.85, -0.45], [-0.85, 0.45], [0.85, 0.45]]) solid.push({ shape: 'box', size: [0.08, 2.5, 0.08], pos: [p.x + dx, p.y + 1.25, p.z + dz], color: wood });
        cloth.push({ shape: 'box', size: [2.3, 0.05, 1.6], pos: [p.x, p.y + 2.55, p.z + 0.1], rot: [0.22, 0, 0], color: c3(pick(theme.cloth, i)) });
        solid.push({ shape: 'box', size: [0.5, 0.3, 0.4], pos: [p.x - 0.4, p.y + 1.25, p.z], color: c3(pick(theme.cloth, i + 1)) });
        solid.push({ shape: 'box', size: [0.4, 0.25, 0.4], pos: [p.x + 0.45, p.y + 1.22, p.z + 0.1], color: c3(pick(theme.foliage, i)) });
        break;
      }
      case 'barrels': {
        const colA = c3(pick(['#8c3b2e', '#2e5a8c', '#5a6b3a'], i));
        solid.push({ shape: 'cyl', size: [0.66, 1.15, 0.66], pos: [p.x - 0.33, p.y + 0.58, p.z - 0.2], rot: [Math.PI / 2, 0, 0], color: colA });
        solid.push({ shape: 'cyl', size: [0.66, 1.15, 0.66], pos: [p.x + 0.33, p.y + 0.58, p.z + 0.22], rot: [Math.PI / 2, 0, 0], color: colA.scale(0.85) });
        break;
      }
      case 'lamp': {
        solid.push({ shape: 'box', size: [0.12, 0.12, 0.8], pos: [p.x, p.y, p.z + 0.45], color: c3('#2a2a2a') });
        glow.push({ shape: 'sphere', size: [0.32, 0.32, 0.32], pos: [p.x, p.y - 0.2, p.z + 0.85], color: c3(theme.lamp) });
        break;
      }
      case 'banner':
        break;
    }
  });

  // banners on building walls facing the site
  const relay = map.relay;
  let banners = 0;
  for (const c of map.colliders) {
    if (c.style !== 'building' || banners >= 6) continue;
    const cz = c.minZ;
    const cx = (c.minX + c.maxX) / 2;
    if (Math.abs(cz - relay.z) > 24 || Math.abs(cx - relay.x) > 24 || c.maxX - c.minX < 3) continue;
    if (!inBounds(cx, cz - 0.6) || inside(cx, 1, cz - 0.6)) continue;
    cloth.push({ shape: 'box', size: [1.1, 2.8, 0.04], pos: [cx, 4.6, cz - 0.08], color: c3(PALETTE.teams.defenders).scale(0.85) });
    cloth.push({ shape: 'box', size: [1.25, 0.12, 0.08], pos: [cx, 6.05, cz - 0.1], color: c3('#2a2a2a') });
    banners++;
  }

  const solidMat = mat(scene, 'prop-solid', { spec: 0.1 }, pbr);
  const foliageMat = mat(scene, 'prop-foliage', { spec: 0.02 }, pbr);
  const clothMat = mat(scene, 'prop-cloth', { spec: 0.02, twoSided: true }, pbr);
  const glowMat = mat(scene, 'prop-glow', { emissive: c3(theme.lamp).scale(1.4) }, pbr);
  if (glowMat instanceof StandardMaterial) glowMat.disableLighting = true;
  else glowMat.unlit = true;
  disposables.push(solidMat, foliageMat, clothMat, glowMat);
  if (solid.length) add(buildPart(scene, 'props-solid', solid, solidMat), solidMat);
  if (foliage.length) add(buildPart(scene, 'props-foliage', foliage, foliageMat), foliageMat);
  if (cloth.length) add(buildPart(scene, 'props-cloth', cloth, clothMat), clothMat);
  if (glow.length) add(buildPart(scene, 'props-glow', glow, glowMat), glowMat);

  // site marking around the relay
  const decalTex = siteDecal(scene, PALETTE.teams.attackers);
  const decalMat = mat(scene, 'site-decal', { emissive: c3(PALETTE.teams.attackers).scale(0.35) }, pbr);
  if (decalMat instanceof StandardMaterial) {
    decalMat.diffuseTexture = decalTex;
    decalMat.useAlphaFromDiffuseTexture = true;
  } else {
    decalMat.albedoTexture = decalTex;
    decalMat.useAlphaFromAlbedoTexture = true;
    decalMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  }
  decalMat.zOffset = -2;
  disposables.push(decalTex, decalMat);
  const decal = new BoxBatch(1);
  const s = 3.6;
  decal.quad(relay.x - s, relay.z - s - 5.7, relay.x + s, relay.z + s - 5.7, map.relay.y - 0.29 + 0.02, Color3.White());
  const dm = decal.build(scene, 'site-decal');
  if (dm) {
    // UVs for the decal span the whole quad
    dm.setVerticesData('uv', [0, 0, 1, 0, 1, 1, 0, 1]);
    add(dm, decalMat);
  }

  return {
    meshes,
    dispose() {
      for (const m of meshes) m.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
