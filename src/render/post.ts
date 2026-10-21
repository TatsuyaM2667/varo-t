import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityPreset } from '../config/quality';

/**
 * Post-processing stack. Each piece can be toggled at runtime by the
 * adaptive quality controller; pieces that fail to initialise on a given
 * backend are silently skipped (the game must keep running).
 */
export class PostStack {
  private pipeline: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private vls: VolumetricLightScatteringPostProcess | null = null;
  private readonly sunDisc: Mesh;
  private damagePulse = 0;
  exposure = 1;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    const mat = new StandardMaterial('sun-disc', scene);
    mat.emissiveColor = new Color3(1, 0.95, 0.85);
    mat.disableLighting = true;
    mat.fogEnabled = false;
    this.sunDisc = CreateDisc('sun-disc', { radius: 14, tessellation: 24 }, scene);
    this.sunDisc.material = mat;
    this.sunDisc.billboardMode = 7;
    this.sunDisc.isPickable = false;
    this.sunDisc.applyFog = false;
    this.sunDisc.infiniteDistance = true;
  }

  setSun(direction: Vector3, color: Color3): void {
    this.sunDisc.position.copyFrom(direction.normalizeToNew().scale(-260));
    (this.sunDisc.material as StandardMaterial).emissiveColor = color;
  }

  apply(q: QualityPreset): void {
    const p = q.post;
    try {
      if (!this.pipeline) {
        this.pipeline = new DefaultRenderingPipeline('post', true, this.scene, [this.camera]);
        this.pipeline.samples = 1;
      }
      const pl = this.pipeline;
      pl.fxaaEnabled = p.fxaa;
      pl.bloomEnabled = p.bloom;
      pl.bloomThreshold = 0.82;
      pl.bloomWeight = 0.32;
      pl.bloomKernel = 48;
      pl.bloomScale = 0.5;
      pl.sharpenEnabled = p.sharpen;
      if (p.sharpen) pl.sharpen.edgeAmount = 0.22;
      pl.imageProcessingEnabled = true;
      const ip = pl.imageProcessing;
      ip.toneMappingEnabled = p.toneMapping;
      ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.contrast = 1.12;
      ip.exposure = this.exposure;
      ip.vignetteEnabled = true;
      ip.vignetteWeight = 1.6;
      ip.vignetteColor = new Color4(0, 0, 0, 0);
      pl.chromaticAberrationEnabled = false;
    } catch (err) {
      console.warn('[post] default pipeline unavailable', err);
      this.pipeline = null;
    }

    if (p.ssao && !this.ssao) {
      try {
        // SSAO2's noise sampler is not bound under WebGPU in this Babylon build
        // (draw throws), so SSAO is WebGL2-only; WebGPU gets compute particles.
        if (SSAO2RenderingPipeline.IsSupported && !this.scene.getEngine().isWebGPU) {
          this.ssao = new SSAO2RenderingPipeline('ssao', this.scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.camera], true);
          this.ssao.radius = 1.6;
          this.ssao.totalStrength = 1.1;
          this.ssao.samples = 12;
          this.ssao.maxZ = 120;
          this.ssao.expensiveBlur = false;
        }
      } catch (err) {
        console.warn('[post] SSAO unavailable', err);
        this.ssao = null;
      }
    } else if (!p.ssao && this.ssao) {
      this.ssao.dispose();
      this.ssao = null;
    }

    if (p.volumetric && !this.vls) {
      try {
        this.vls = new VolumetricLightScatteringPostProcess('vls', 0.5, this.camera, this.sunDisc, 60, Texture.BILINEAR_SAMPLINGMODE, this.scene.getEngine(), false);
        this.vls.exposure = 0.18;
        this.vls.decay = 0.965;
        this.vls.weight = 0.6;
        this.vls.density = 0.9;
      } catch (err) {
        console.warn('[post] volumetric light unavailable', err);
        this.vls = null;
      }
    } else if (!p.volumetric && this.vls) {
      this.vls.dispose(this.camera);
      this.vls = null;
    }
    this.sunDisc.isVisible = true;
  }

  get hurtPulse(): number {
    return this.damagePulse;
  }

  /** Brief chromatic aberration pulse when the player takes damage. */
  hurt(amount: number): void {
    this.damagePulse = Math.min(1, this.damagePulse + amount / 60);
  }

  update(dt: number): void {
    this.damagePulse = Math.max(0, this.damagePulse - dt * 2.2);
    const pl = this.pipeline;
    if (!pl) return;
    pl.imageProcessing.exposure = this.exposure;
    // (the red screen-edge flash is a HUD overlay; the vignette stays constant)
    pl.chromaticAberrationEnabled = this.damagePulse > 0.02;
    if (pl.chromaticAberrationEnabled) pl.chromaticAberration.aberrationAmount = this.damagePulse * 25;
  }

  dispose(): void {
    this.pipeline?.dispose();
    this.ssao?.dispose();
    this.vls?.dispose(this.camera);
    this.sunDisc.dispose();
  }
}
