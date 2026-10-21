import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Particles/webgl2ParticleSystem';
import '@babylonjs/core/Particles/computeShaderParticleSystem';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { GPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem';
import type { IParticleSystem } from '@babylonjs/core/Particles/IParticleSystem';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { BoxParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/boxParticleEmitter';
import type { Scene } from '@babylonjs/core/scene';
import { FX_STYLE } from '../config/visuals';
import type { MaterialTag } from '../sim/physics/aabb';
import type { Physics } from './physics';

/** Soft round sprite generated at runtime (no texture files). */
export function softSprite(scene: Scene, name: string, hardness = 0.35, size = 64): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hardness, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  t.update();
  t.hasAlpha = true;
  return t;
}

function bulletHoleTexture(scene: Scene): DynamicTexture {
  const s = 64;
  const t = new DynamicTexture('decal-tex', { width: s, height: s }, scene, false);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(10,10,12,1)');
  g.addColorStop(0.22, 'rgba(20,20,24,0.95)');
  g.addColorStop(0.3, 'rgba(60,60,60,0.5)');
  g.addColorStop(0.55, 'rgba(40,40,40,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  t.update();
  t.hasAlpha = true;
  return t;
}

interface Tracer {
  mesh: Mesh;
  from: Vector3;
  to: Vector3;
  t: number;
  len: number;
}

interface Chunk {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  life: number;
  body: { dispose(): void } | null;
}

export interface FxOptions {
  gpu: boolean;
  particleScale: number;
  decals: boolean;
  maxDecals: number;
}

/**
 * Pooled combat effects: tracers, impact sparks, agent hit flashes, bullet
 * decals, ambient dust (GPU particles / WebGPU compute when available) and
 * debris from destroyed cover (Havok bodies when the physics plugin loaded).
 */
export class Fx {
  private readonly tracers: Tracer[] = [];
  private tracerIdx = 0;
  private readonly sparkPools: IParticleSystem[] = [];
  private sparkIdx = 0;
  private readonly decals: Mesh[] = [];
  private decalIdx = 0;
  private readonly decalMat: StandardMaterial;
  private dust: IParticleSystem | null = null;
  private readonly chunks: Chunk[] = [];
  private readonly chunkMats: Record<string, StandardMaterial> = {};
  private readonly sprite: DynamicTexture;

  constructor(
    private readonly scene: Scene,
    private opts: FxOptions,
    private physics: Physics | null,
    mapBounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  ) {
    this.sprite = softSprite(scene, 'fx-sprite', 0.2);
    const tracerMat = new StandardMaterial('tracer-mat', scene);
    tracerMat.emissiveColor = Color3.FromHexString(FX_STYLE.tracer).scale(1.6);
    tracerMat.disableLighting = true;
    tracerMat.alpha = 0.55;
    for (let i = 0; i < 24; i++) {
      const m = CreateBox('tracer', { width: 0.01, height: 0.01, depth: 1 }, scene);
      m.material = tracerMat;
      m.isPickable = false;
      m.isVisible = false;
      this.tracers.push({ mesh: m, from: new Vector3(), to: new Vector3(), t: 1, len: 0 });
    }
    const gpuOk = opts.gpu && GPUParticleSystem.IsSupported;
    for (let i = 0; i < 6; i++) this.sparkPools.push(this.makeSparks(i, gpuOk));
    this.decalMat = new StandardMaterial('decal-mat', scene);
    this.decalMat.diffuseTexture = bulletHoleTexture(scene);
    this.decalMat.useAlphaFromDiffuseTexture = true;
    this.decalMat.specularColor = Color3.Black();
    this.decalMat.zOffset = -2;
    this.decalMat.backFaceCulling = true;
    this.buildDust(mapBounds, gpuOk);
    // compile spark shaders now (under the floor) instead of on the first shot
    for (const ps of this.sparkPools) {
      ps.emitter = new Vector3(0, -50, 0);
      ps.manualEmitCount = 1;
    }
    for (const [k, hex] of Object.entries({ wood: '#9a6a3a', glass: FX_STYLE.glass, crate: '#d98a3d', concrete: '#a39e95' })) {
      const m = new StandardMaterial(`chunk-${k}`, scene);
      m.diffuseColor = Color3.FromHexString(hex);
      if (k === 'glass') {
        m.alpha = 0.45;
        m.emissiveColor = Color3.FromHexString(hex).scale(0.3);
        m.backFaceCulling = false;
      }
      this.chunkMats[k] = m;
    }
  }

  setPhysics(p: Physics | null): void {
    this.physics = p;
  }

  setOptions(o: FxOptions): void {
    this.opts = o;
    if (this.dust) (this.dust as ParticleSystem).emitRate = 60 * o.particleScale;
    if (!o.decals) for (const d of this.decals) d.isVisible = false;
  }

  private makeSparks(i: number, gpu: boolean): IParticleSystem {
    const cap = 120;
    const ps: IParticleSystem = gpu ? new GPUParticleSystem(`sparks-${i}`, { capacity: cap }, this.scene) : new ParticleSystem(`sparks-${i}`, cap, this.scene);
    ps.particleTexture = this.sprite;
    ps.emitter = new Vector3(0, -100, 0);
    ps.minSize = 0.025;
    ps.maxSize = 0.07;
    ps.minLifeTime = 0.12;
    ps.maxLifeTime = 0.38;
    ps.minEmitPower = 2;
    ps.maxEmitPower = 7;
    ps.emitRate = 0;
    ps.gravity = new Vector3(0, -12, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.updateSpeed = 1 / 60;
    const em = new BoxParticleEmitter();
    em.minEmitBox = new Vector3(-0.02, -0.02, -0.02);
    em.maxEmitBox = new Vector3(0.02, 0.02, 0.02);
    ps.particleEmitterType = em;
    ps.start();
    return ps;
  }

  private buildDust(b: { minX: number; minZ: number; maxX: number; maxZ: number }, gpu: boolean): void {
    const cap = gpu ? 6000 : 600;
    const ps: IParticleSystem = gpu ? new GPUParticleSystem('dust', { capacity: cap }, this.scene) : new ParticleSystem('dust', cap, this.scene);
    ps.particleTexture = this.sprite;
    const em = new BoxParticleEmitter();
    em.minEmitBox = new Vector3(b.minX, 0.2, b.minZ);
    em.maxEmitBox = new Vector3(b.maxX, 5, b.maxZ);
    em.direction1 = new Vector3(-0.15, -0.05, -0.15);
    em.direction2 = new Vector3(0.15, 0.08, 0.15);
    ps.particleEmitterType = em;
    ps.emitter = Vector3.Zero();
    ps.color1 = new Color4(1, 0.95, 0.85, 0.35);
    ps.color2 = new Color4(1, 0.9, 0.8, 0.18);
    ps.colorDead = new Color4(1, 0.9, 0.8, 0);
    ps.minSize = 0.02;
    ps.maxSize = 0.05;
    ps.minLifeTime = 6;
    ps.maxLifeTime = 12;
    ps.emitRate = (gpu ? 500 : 50) * this.opts.particleScale;
    ps.minEmitPower = 0.1;
    ps.maxEmitPower = 0.3;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.preWarmCycles = 60;
    ps.preWarmStepOffset = 10;
    ps.start();
    this.dust = ps;
  }

  tracer(from: Vector3, to: Vector3): void {
    const tr = this.tracers[this.tracerIdx++ % this.tracers.length];
    tr.from.copyFrom(from);
    tr.to.copyFrom(to);
    tr.len = Vector3.Distance(from, to);
    tr.t = 0;
  }

  /** Burst of sparks at a surface or agent hit. */
  impact(pos: Vector3, normal: Vector3, kind: 'world' | 'agent', team: 0 | 1, surface: MaterialTag | null): void {
    const ps = this.sparkPools[this.sparkIdx++ % this.sparkPools.length];
    ps.emitter = pos.clone();
    const n = normal.lengthSquared() > 0 ? normal : new Vector3(0, 1, 0);
    const em = ps.particleEmitterType as BoxParticleEmitter;
    em.direction1 = n.add(new Vector3(-0.7, -0.2, -0.7));
    em.direction2 = n.add(new Vector3(0.7, 0.9, 0.7));
    let col = Color3.FromHexString(FX_STYLE.hitSpark);
    if (kind === 'agent') col = Color3.FromHexString(team === 0 ? FX_STYLE.agentHit.attackers : FX_STYLE.agentHit.defenders);
    else if (surface === 'wood' || surface === 'crate') col = new Color3(0.85, 0.65, 0.4);
    else if (surface === 'glass') col = Color3.FromHexString(FX_STYLE.glass);
    ps.color1 = new Color4(col.r, col.g, col.b, 1);
    ps.color2 = new Color4(col.r, col.g * 0.8, col.b * 0.6, 1);
    ps.colorDead = new Color4(col.r * 0.3, col.g * 0.2, col.b * 0.1, 0);
    ps.manualEmitCount = Math.max(3, Math.round((kind === 'agent' ? 22 : 14) * this.opts.particleScale + 2));
  }

  decal(pos: Vector3, normal: Vector3): void {
    if (!this.opts.decals || this.opts.maxDecals <= 0) return;
    let d: Mesh;
    if (this.decals.length < this.opts.maxDecals) {
      d = CreatePlane('decal', { size: 0.13 }, this.scene);
      d.material = this.decalMat;
      d.isPickable = false;
      this.decals.push(d);
    } else {
      d = this.decals[this.decalIdx++ % this.decals.length];
    }
    d.isVisible = true;
    d.position.copyFrom(pos.add(normal.scale(0.004)));
    // CreatePlane faces -Z; point its back toward the surface
    d.lookAt(pos.subtract(normal));
    d.rotation.z = Math.random() * Math.PI * 2;
  }

  clearDecals(): void {
    for (const d of this.decals) d.isVisible = false;
  }

  /** Destroyed cover: spawn chunks (Havok if available, else simple ballistic). */
  debris(center: Vector3, size: Vector3, material: MaterialTag): void {
    const mat = this.chunkMats[material] ?? this.chunkMats.concrete;
    const n = material === 'glass' ? 14 : 10;
    for (let i = 0; i < n; i++) {
      const s = material === 'glass' ? 0.25 + Math.random() * 0.3 : 0.2 + Math.random() * 0.35;
      const m = CreateBox('chunk', { width: s, height: material === 'glass' ? 0.02 : s * 0.6, depth: s * 0.8 }, this.scene);
      m.material = mat;
      m.isPickable = false;
      m.position.set(
        center.x + (Math.random() - 0.5) * size.x,
        center.y + (Math.random() - 0.5) * size.y,
        center.z + (Math.random() - 0.5) * size.z,
      );
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const vel = new Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5);
      const body = this.physics ? this.physics.addDebris(m, vel) : null;
      this.chunks.push({ mesh: m, vel, spin: new Vector3(Math.random() * 8, Math.random() * 8, 0), life: 4 + Math.random(), body });
    }
  }

  update(dt: number): void {
    for (const tr of this.tracers) {
      if (tr.t >= 1) {
        tr.mesh.isVisible = false;
        continue;
      }
      const speed = 380;
      const head = Math.min(tr.len, tr.t * tr.len + speed * dt);
      tr.t = tr.len > 0 ? head / tr.len : 1;
      if (tr.t >= 0.999) tr.t = 1;
      const segLen = Math.min(2.5, head);
      const dir = tr.to.subtract(tr.from).normalize();
      const h = tr.from.add(dir.scale(head));
      const tail = h.subtract(dir.scale(segLen));
      tr.mesh.isVisible = segLen > 0.05;
      tr.mesh.position.copyFrom(h.add(tail).scale(0.5));
      tr.mesh.scaling.z = segLen;
      tr.mesh.lookAt(h);
    }
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      if (!c.body) {
        c.vel.y -= 14 * dt;
        c.mesh.position.addInPlace(c.vel.scale(dt));
        if (c.mesh.position.y < 0.05) {
          c.mesh.position.y = 0.05;
          c.vel.scaleInPlace(0.4);
          c.vel.y = Math.abs(c.vel.y) * 0.3;
        }
        c.mesh.rotation.addInPlace(c.spin.scale(dt));
      }
      if (c.life < 0.6) c.mesh.visibility = Math.max(0, c.life / 0.6);
      if (c.life <= 0) {
        c.body?.dispose();
        c.mesh.dispose();
        this.chunks.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const t of this.tracers) t.mesh.dispose();
    for (const p of this.sparkPools) p.dispose();
    this.dust?.dispose();
    for (const d of this.decals) d.dispose();
    for (const c of this.chunks) {
      c.body?.dispose();
      c.mesh.dispose();
    }
  }
}
