import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Scene } from '@babylonjs/core/scene';
import { INPUT } from '../config/input';
import { PALETTE } from '../config/visuals';
import type { QualityPreset } from '../config/quality';
import type { MapData } from '../sim/map/map-def';
import { buildGreybox } from './greybox';

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  /** radians, sim convention (positive pitch looks up) */
  yaw: number;
  pitch: number;
}

/** Owns the Babylon scene for a match. Reads sim state, never writes it. */
export class GameRenderer {
  readonly scene: Scene;
  readonly camera: FreeCamera;
  readonly sun: DirectionalLight;
  shadows: ShadowGenerator | null = null;
  private readonly mapMeshes: Mesh[];

  constructor(
    readonly engine: AbstractEngine,
    map: MapData,
    quality: QualityPreset,
  ) {
    const scene = new Scene(engine);
    this.scene = scene;
    scene.skipPointerMovePicking = true;
    scene.autoClear = true;
    const horizon = Color3.FromHexString(PALETTE.sky.horizon);
    scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
    scene.ambientColor = new Color3(0.25, 0.25, 0.28);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = PALETTE.fog.density;
    scene.fogColor = Color3.FromHexString(PALETTE.fog.color);

    const cam = new FreeCamera('player-cam', new Vector3(0, 1.6, 0), scene);
    cam.inputs.clear();
    cam.minZ = 0.05;
    cam.maxZ = 400;
    cam.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    cam.fov = (INPUT.fovHorizontal * Math.PI) / 180;
    this.camera = cam;

    const hemi = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    hemi.diffuse = Color3.FromHexString(PALETTE.ambient.sky);
    hemi.groundColor = Color3.FromHexString(PALETTE.ambient.ground);
    hemi.intensity = PALETTE.ambient.intensity;
    hemi.specular = Color3.Black();

    const [dx, dy, dz] = PALETTE.sun.direction;
    const sun = new DirectionalLight('sun', new Vector3(dx, dy, dz).normalize(), scene);
    sun.diffuse = Color3.FromHexString(PALETTE.sun.color);
    sun.intensity = PALETTE.sun.intensity * 0.6;
    sun.position = new Vector3(-dx * 80, -dy * 80, -dz * 80);
    this.sun = sun;

    this.mapMeshes = buildGreybox(scene, map.colliders);
    this.buildSky(scene);
    this.applyQuality(quality);
  }

  private buildSky(scene: Scene): void {
    // Vertex-coloured dome: cheap, no textures, follows the camera.
    const segs = 24;
    const rings = 12;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const top = Color3.FromHexString(PALETTE.sky.top);
    const hor = Color3.FromHexString(PALETTE.sky.horizon);
    const r = 300;
    for (let i = 0; i <= rings; i++) {
      const el = (i / rings) * (Math.PI / 2) - 0.15;
      const t = Math.max(0, Math.min(1, Math.pow(Math.max(0, Math.sin(el)), 0.55)));
      for (let j = 0; j <= segs; j++) {
        const az = (j / segs) * Math.PI * 2;
        positions.push(Math.cos(el) * Math.sin(az) * r, Math.sin(el) * r, Math.cos(el) * Math.cos(az) * r);
        colors.push(hor.r + (top.r - hor.r) * t, hor.g + (top.g - hor.g) * t, hor.b + (top.b - hor.b) * t, 1);
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
    vd.colors = colors;
    vd.indices = indices;
    const dome = new Mesh('sky', scene);
    vd.applyToMesh(dome);
    const mat = new StandardMaterial('sky-mat', scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.backFaceCulling = false;
    mat.fogEnabled = false;
    dome.material = mat;
    dome.useVertexColors = true;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.applyFog = false;
  }

  applyQuality(q: QualityPreset): void {
    this.engine.setHardwareScalingLevel(1 / q.renderScale);
    if (q.shadowMapSize > 0) {
      if (!this.shadows || this.shadows.getShadowMap()?.getSize().width !== q.shadowMapSize) {
        this.shadows?.dispose();
        const sg = new ShadowGenerator(q.shadowMapSize, this.sun);
        sg.usePercentageCloserFiltering = q.shadowMapSize >= 2048;
        sg.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
        sg.bias = 0.0008;
        sg.normalBias = 0.02;
        for (const m of this.mapMeshes) sg.addShadowCaster(m);
        this.sun.shadowMinZ = 1;
        this.sun.shadowMaxZ = 200;
        this.sun.autoUpdateExtends = false;
        this.sun.orthoLeft = -60;
        this.sun.orthoRight = 60;
        this.sun.orthoTop = 60;
        this.sun.orthoBottom = -60;
        this.shadows = sg;
        const sm = sg.getShadowMap();
        if (sm) sm.refreshRate = 0; // static map: render the shadow map once
      }
    } else if (this.shadows) {
      this.shadows.dispose();
      this.shadows = null;
    }
  }

  setCamera(p: CameraPose): void {
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.rotation.set(-p.pitch, p.yaw, 0);
  }

  render(): void {
    this.scene.render();
  }

  dispose(): void {
    this.scene.dispose();
  }
}
