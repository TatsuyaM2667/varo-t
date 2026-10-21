import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { Scene } from '@babylonjs/core/scene';
import type { Features } from '../config/features';
import { INPUT } from '../config/input';
import type { QualityPreset } from '../config/quality';
import { LIGHTING_MOODS, type LightingMood } from '../config/visuals';
import type { MapData } from '../sim/map/map-def';
import type { Bvh } from '../sim/physics/bvh';
import { type AgentPose, CharacterSet } from './characters';
import { Fx } from './fx';
import { type Greybox, buildGreybox } from './greybox';
import { SurfaceMaterials } from './materials';
import { Physics } from './physics';
import { PostStack } from './post';
import { SmokeViz } from './smoke-viz';

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  /** radians, sim convention (positive pitch looks up) */
  yaw: number;
  pitch: number;
  roll?: number;
  /** zoom factor (ADS) */
  zoom?: number;
  fovKickDeg?: number;
}

/**
 * Owns the Babylon scene for one world (a match, the attract demo or a
 * replay). Reads sim state, never writes it.
 */
export class GameRenderer {
  readonly scene: Scene;
  readonly camera: FreeCamera;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphericLight;
  readonly characters: CharacterSet;
  readonly fx: Fx;
  readonly smoke: SmokeViz;
  readonly post: PostStack;
  physics: Physics | null = null;
  shadows: ShadowGenerator | null = null;
  private greybox: Greybox | null = null;
  private currentMap: MapData | null = null;
  private readonly mats: SurfaceMaterials;
  private skyDome!: Mesh;
  private probe: ReflectionProbe | null = null;
  private quality: QualityPreset;
  private mood: LightingMood = LIGHTING_MOODS[0];

  constructor(
    readonly engine: AbstractEngine,
    map: MapData,
    roster: readonly { id: number; team: 0 | 1 }[],
    quality: QualityPreset,
    private features: Features,
  ) {
    const scene = new Scene(engine);
    this.scene = scene;
    scene.skipPointerMovePicking = true;
    scene.fogMode = Scene.FOGMODE_EXP2;
    // viewmodel group: clear depth so the gun never clips into walls
    scene.setRenderingAutoClearDepthStencil(1, true, true, true);

    const cam = new FreeCamera('cam', new Vector3(0, 1.6, 0), scene);
    cam.inputs.clear();
    cam.minZ = 0.03;
    cam.maxZ = 500;
    cam.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    cam.fov = (INPUT.fovHorizontal * Math.PI) / 180;
    this.camera = cam;

    this.hemi = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    this.hemi.specular = Color3.Black();
    this.sun = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);

    this.mats = new SurfaceMaterials(scene);
    this.buildSkyDome();
    this.quality = quality;
    this.post = new PostStack(scene, cam);
    this.characters = new CharacterSet(scene, roster);
    this.fx = new Fx(scene, this.fxOptions(quality), null, map.bounds);
    this.smoke = new SmokeViz(scene, quality.smokeParticles, features.volumetricSmoke);
    this.syncMap(map);
    this.setMood(LIGHTING_MOODS[0]);
    this.applyQuality(quality, features);
    if (features.destructibles) {
      void Physics.create(scene, map.colliders).then((p) => {
        this.physics = p;
        this.fx.setPhysics(p);
      });
    }
  }

  private fxOptions(q: QualityPreset) {
    return { gpu: this.features.gpuParticles, particleScale: q.particles, decals: this.features.decals, maxDecals: q.maxDecals };
  }

  /** Rebuild map meshes if the world switched to a different map (seeded layouts). */
  syncMap(map: MapData): void {
    if (this.currentMap?.key === map.key) return;
    this.currentMap = map;
    this.greybox?.dispose();
    this.greybox = buildGreybox(this.scene, map.colliders, this.mats, this.features.pbrLighting);
    this.fx.clearDecals();
    this.rebuildShadows();
  }

  /** Show/hide destructible pieces according to a world's state. */
  syncBreakables(bvh: Bvh): void {
    if (!this.greybox) return;
    for (const [id, m] of this.greybox.breakables) m.isVisible = !bvh.disabled[id];
  }

  breakableMesh(id: number): Mesh | undefined {
    return this.greybox?.breakables.get(id);
  }

  private buildSkyDome(): void {
    const segs = 32;
    const rings = 16;
    const positions: number[] = [];
    const indices: number[] = [];
    const r = 400;
    for (let i = 0; i <= rings; i++) {
      const el = (i / rings) * (Math.PI / 2 + 0.25) - 0.25;
      for (let j = 0; j <= segs; j++) {
        const az = (j / segs) * Math.PI * 2;
        positions.push(Math.cos(el) * Math.sin(az) * r, Math.sin(el) * r, Math.cos(el) * Math.cos(az) * r);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j;
        const b = a + segs + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = new Array((positions.length / 3) * 4).fill(1);
    const dome = new Mesh('sky', this.scene);
    vd.applyToMesh(dome, true);
    const mat = new StandardMaterial('sky-mat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.backFaceCulling = false;
    mat.fogEnabled = false;
    dome.material = mat;
    dome.useVertexColors = true;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.applyFog = false;
    this.skyDome = dome;
  }

  private paintSky(m: LightingMood): void {
    const pos = this.skyDome.getVerticesData('position')!;
    const top = Color3.FromHexString(m.sky.top);
    const hor = Color3.FromHexString(m.sky.horizon);
    const sunCol = Color3.FromHexString(m.sun.color);
    const sd = new Vector3(...m.sun.direction).normalize().scale(-1);
    const colors: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const v = new Vector3(pos[i], pos[i + 1], pos[i + 2]).normalize();
      const t = Math.pow(Math.max(0, v.y), 0.5);
      const c = Color3.Lerp(hor, top, t);
      // warm glow around the sun
      const glow = Math.pow(Math.max(0, Vector3.Dot(v, sd)), 12) * 0.6;
      colors.push(Math.min(1, c.r + sunCol.r * glow), Math.min(1, c.g + sunCol.g * glow), Math.min(1, c.b + sunCol.b * glow), 1);
    }
    this.skyDome.updateVerticesData('color', colors);
  }

  setMood(m: LightingMood): void {
    this.mood = m;
    const s = this.scene;
    const hor = Color3.FromHexString(m.sky.horizon);
    s.clearColor = new Color4(hor.r, hor.g, hor.b, 1);
    s.fogDensity = m.fog.density;
    s.fogColor = Color3.FromHexString(m.fog.color);
    this.hemi.diffuse = Color3.FromHexString(m.ambient.sky);
    this.hemi.groundColor = Color3.FromHexString(m.ambient.ground);
    this.hemi.intensity = m.ambient.intensity;
    const dir = new Vector3(...m.sun.direction).normalize();
    this.sun.direction = dir;
    this.sun.position = dir.scale(-90);
    this.sun.diffuse = Color3.FromHexString(m.sun.color);
    this.sun.intensity = m.sun.intensity * (this.features.pbrLighting ? 1.4 : 0.6);
    this.post.exposure = m.exposure;
    this.post.setSun(dir, Color3.FromHexString(m.sun.color));
    this.paintSky(m);
    this.refreshEnvironment();
    const sm = this.shadows?.getShadowMap();
    if (sm) sm.resetRefreshCounter();
  }

  get currentMood(): LightingMood {
    return this.mood;
  }

  private refreshEnvironment(): void {
    if (!this.features.pbrLighting) return;
    if (!this.probe) {
      this.probe = new ReflectionProbe('env', 128, this.scene, true, true);
      this.probe.renderList!.push(this.skyDome);
      this.probe.position = new Vector3(0, 30, 0);
      this.probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      this.scene.environmentTexture = this.probe.cubeTexture;
    } else {
      this.probe.cubeTexture.resetRefreshCounter();
    }
  }

  private rebuildShadows(): void {
    const q = this.quality;
    this.shadows?.dispose();
    this.shadows = null;
    if (q.shadowMapSize <= 0 || !this.greybox) {
      this.characters.setShadows(null, false);
      return;
    }
    const sg = new ShadowGenerator(q.shadowMapSize, this.sun);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = q.shadowMapSize >= 2048 ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    sg.bias = 0.0006;
    sg.normalBias = 0.015;
    for (const m of this.greybox.statics) sg.addShadowCaster(m, false);
    for (const m of this.greybox.breakables.values()) sg.addShadowCaster(m, false);
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 220;
    this.sun.autoUpdateExtends = false;
    this.sun.orthoLeft = -62;
    this.sun.orthoRight = 62;
    this.sun.orthoTop = 62;
    this.sun.orthoBottom = -62;
    this.shadows = sg;
    // the static map only needs one render; agents need every frame
    const sm = sg.getShadowMap()!;
    sm.refreshRate = q.dynamicShadows ? 1 : RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    this.characters.setShadows(null, false);
    this.characters.setShadows(sg, q.dynamicShadows);
  }

  applyQuality(q: QualityPreset, features: Features): void {
    const shadowChanged = q.shadowMapSize !== this.quality.shadowMapSize || q.dynamicShadows !== this.quality.dynamicShadows;
    this.quality = q;
    this.features = features;
    this.engine.setHardwareScalingLevel(1 / Math.max(0.3, q.renderScale));
    if (shadowChanged || (!this.shadows && q.shadowMapSize > 0)) this.rebuildShadows();
    this.fx.setOptions(this.fxOptions(q));
    this.smoke.setQuality(q.smokeParticles, features.volumetricSmoke);
    this.post.apply(q);
  }

  setCamera(p: CameraPose): void {
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.rotation.set(-p.pitch, p.yaw, p.roll ?? 0);
    const base = ((INPUT.fovHorizontal + (p.fovKickDeg ?? 0)) * Math.PI) / 180;
    const zoom = p.zoom ?? 1;
    this.camera.fov = zoom === 1 ? base : 2 * Math.atan(Math.tan(base / 2) / zoom);
  }

  updateAgents(poses: readonly AgentPose[], dt: number, hideId: number, bvh: Bvh): void {
    this.characters.update(poses, dt, hideId, bvh);
  }

  render(dt: number): void {
    this.fx.update(dt);
    this.smoke.update(dt);
    this.post.update(dt);
    this.scene.render();
  }

  dispose(): void {
    this.fx.dispose();
    this.smoke.dispose();
    this.characters.dispose();
    this.post.dispose();
    this.greybox?.dispose();
    this.scene.dispose();
  }
}
