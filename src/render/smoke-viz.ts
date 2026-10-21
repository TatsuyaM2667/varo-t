import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Particle } from '@babylonjs/core/Particles/particle';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import type { Scene } from '@babylonjs/core/scene';
import { FX_STYLE } from '../config/visuals';
import { type Smoke, smokeStrength } from '../sim/entities/smoke';

interface PState {
  puff: number;
  ox: number;
  oy: number;
  oz: number;
  shade: number;
  phase: number;
  spin: number;
}

/** Cloudy sprite: several overlapping soft blobs, generated once. */
function cloudTexture(scene: Scene): DynamicTexture {
  const s = 128;
  const t = new DynamicTexture('smoke-tex', { width: s, height: s }, scene, true);
  const ctx = t.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, s, s);
  let seed = 7;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 18; i++) {
    const r = s * (0.12 + rnd() * 0.2);
    const ang = rnd() * Math.PI * 2;
    const d = rnd() * s * 0.22;
    const x = s / 2 + Math.cos(ang) * d;
    const y = s / 2 + Math.sin(ang) * d;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  t.update();
  t.hasAlpha = true;
  return t;
}

/**
 * Renders sim smoke clouds as long-lived billboards attached to the density
 * puffs. Each particle swirls around its puff with a cheap curl-like motion,
 * and is shaded brighter on top (fake single scattering from the sun).
 */
export class SmokeViz {
  private readonly systems = new Map<number, { ps: ParticleSystem; smoke: Smoke; state: Map<number, PState> }>();
  private readonly tex: DynamicTexture;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    private particlesPerSmoke: number,
    private volumetric: boolean,
  ) {
    this.tex = cloudTexture(scene);
    // compile the smoke particle shader up front so the first smoke doesn't hitch
    const warm = new ParticleSystem('smoke-warmup', 1, scene);
    warm.particleTexture = this.tex;
    warm.emitter = new Vector3(0, -50, 0);
    warm.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    warm.manualEmitCount = 1;
    warm.minLifeTime = warm.maxLifeTime = 0.5;
    warm.start();
    setTimeout(() => warm.dispose(), 3000);
  }

  setQuality(particles: number, volumetric: boolean): void {
    this.particlesPerSmoke = particles;
    this.volumetric = volumetric;
  }

  /** Sync with the sim's smoke list (create/remove systems). */
  sync(smokes: readonly Smoke[]): void {
    const live = new Set<number>();
    for (const s of smokes) {
      live.add(s.id);
      const e = this.systems.get(s.id);
      if (e) e.smoke = s;
      else this.create(s);
    }
    for (const [id, e] of this.systems) {
      if (!live.has(id)) {
        e.ps.dispose();
        this.systems.delete(id);
      }
    }
  }

  clear(): void {
    for (const e of this.systems.values()) e.ps.dispose();
    this.systems.clear();
  }

  private create(smoke: Smoke): void {
    const n = Math.max(30, Math.round(this.particlesPerSmoke * (this.volumetric ? 1 : 0.6)));
    const ps = new ParticleSystem(`smoke-${smoke.id}`, n, this.scene);
    ps.particleTexture = this.tex;
    ps.emitter = new Vector3(smoke.x, smoke.y, smoke.z);
    ps.minLifeTime = ps.maxLifeTime = 1e6;
    ps.emitRate = 0;
    ps.manualEmitCount = n;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.minSize = 1;
    ps.maxSize = 1;
    ps.minAngularSpeed = -0.2;
    ps.maxAngularSpeed = 0.2;
    ps.updateSpeed = 1 / 60;
    const state = new Map<number, PState>();
    const entry = { ps, smoke, state };
    const base = Color3.FromHexString(FX_STYLE.smoke);
    const shadow = Color3.FromHexString(FX_STYLE.smokeShadow);
    ps.updateFunction = (particles: Particle[]): void => {
      const s = entry.smoke;
      const k = smokeStrength(s);
      const t = this.time;
      for (const p of particles) {
        let st = state.get(p.id);
        if (!st) {
          // uniform-ish point inside a unit sphere, biased outward for a fuller silhouette
          const u = Math.random();
          const r = Math.cbrt(0.25 + 0.75 * u);
          const th = Math.random() * Math.PI * 2;
          const ph = Math.acos(2 * Math.random() - 1);
          st = {
            puff: p.id % s.puffs.length,
            ox: r * Math.sin(ph) * Math.cos(th),
            oy: r * Math.cos(ph) * 0.8,
            oz: r * Math.sin(ph) * Math.sin(th),
            shade: 0.75 + Math.random() * 0.25,
            phase: Math.random() * 100,
            spin: (Math.random() - 0.5) * 0.4,
          };
          state.set(p.id, st);
          p.angle = Math.random() * Math.PI * 2;
        }
        const puff = s.puffs[st.puff];
        // slow swirl: rotate the offset around Y and bob it, like a lazy curl field
        const w = t * 0.18 + st.phase;
        const cs = Math.cos(w * 0.3);
        const sn = Math.sin(w * 0.3);
        const ox = st.ox * cs - st.oz * sn + Math.sin(w * 0.7) * 0.06;
        const oz = st.ox * sn + st.oz * cs + Math.cos(w * 0.5) * 0.06;
        const oy = st.oy + Math.sin(w * 0.9) * 0.05;
        const R = puff.r * 0.78;
        p.position.set(puff.x + ox * R, Math.max(0.15, puff.y + oy * R), puff.z + oz * R);
        p.size = puff.r * (this.volumetric ? 1.05 : 1.25) * (0.75 + st.shade * 0.4);
        p.angle += st.spin * (1 / 60);
        // fake lighting: lighter toward the top of the cloud
        const up = Math.max(0, Math.min(1, 0.5 + oy * 0.6));
        const c = Color3.Lerp(shadow, base, up).scale(st.shade);
        const edge = 1 - Math.min(1, Math.sqrt(st.ox * st.ox + st.oy * st.oy + st.oz * st.oz)) * 0.35;
        const a = k * (this.volumetric ? 0.78 : 0.9) * edge;
        p.color.set(c.r, c.g, c.b, a);
      }
    };
    ps.color1 = new Color4(1, 1, 1, 0);
    ps.start();
    this.systems.set(smoke.id, entry);
  }

  update(dt: number): void {
    this.time += dt;
  }

  dispose(): void {
    this.clear();
    this.tex.dispose();
  }
}
