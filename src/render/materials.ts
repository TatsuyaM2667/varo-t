import { Constants } from '@babylonjs/core/Engines/constants';
import type { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { PALETTE } from '../config/visuals';
import type { MaterialTag } from '../sim/physics/aabb';
import { createGridTexture } from './textures';

/** Physical-ish parameters per surface for the PBR path. */
const PBR_PARAMS: Record<MaterialTag, { metallic: number; roughness: number; alpha?: number }> = {
  floor: { metallic: 0, roughness: 0.82 },
  wall: { metallic: 0, roughness: 0.9 },
  crate: { metallic: 0.1, roughness: 0.6 },
  metal: { metallic: 0.85, roughness: 0.3 },
  concrete: { metallic: 0, roughness: 0.88 },
  site: { metallic: 0.2, roughness: 0.45 },
  glass: { metallic: 0.1, roughness: 0.05, alpha: 0.28 },
  wood: { metallic: 0, roughness: 0.75 },
};

/**
 * Shared surface materials (one per tag). Swappable between Standard
 * (Tier 0, cheapest) and PBR+IBL (Tier 1 `pbrLighting`).
 */
export class SurfaceMaterials {
  private readonly textures = new Map<MaterialTag, DynamicTexture>();
  private readonly cache = new Map<string, Material>();

  constructor(private readonly scene: Scene) {}

  texture(tag: MaterialTag): DynamicTexture {
    let t = this.textures.get(tag);
    if (!t) {
      t = createGridTexture(this.scene, `tex-${tag}`, PALETTE.surfaces[tag].grid);
      this.textures.set(tag, t);
    }
    return t;
  }

  get(tag: MaterialTag, pbr: boolean): Material {
    const key = `${tag}:${pbr ? 'pbr' : 'std'}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const style = PALETTE.surfaces[tag];
    const params = PBR_PARAMS[tag];
    let mat: Material;
    if (pbr) {
      const m = new PBRMaterial(`pbr-${tag}`, this.scene);
      m.albedoTexture = this.texture(tag);
      m.albedoColor = Color3.White();
      m.metallic = params.metallic;
      m.roughness = params.roughness;
      m.realTimeFiltering = true;
      m.realTimeFilteringQuality = Constants.TEXTURE_FILTERING_QUALITY_LOW;
      m.environmentIntensity = 0.9;
      m.directIntensity = 1.0;
      if (tag === 'site' || tag === 'metal') {
        m.emissiveColor = Color3.FromHexString(style.grid.accent).scale(tag === 'metal' ? 0.25 : 0.06);
      }
      if (params.alpha !== undefined) {
        m.alpha = params.alpha;
        m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
        m.backFaceCulling = false;
      }
      mat = m;
    } else {
      const m = new StandardMaterial(`std-${tag}`, this.scene);
      m.diffuseTexture = this.texture(tag);
      m.diffuseColor = Color3.White();
      m.specularColor = Color3.FromHexString(style.specular);
      m.specularPower = tag === 'glass' ? 128 : 48;
      if (tag === 'site' || tag === 'metal') m.emissiveColor = Color3.FromHexString(style.grid.accent).scale(tag === 'metal' ? 0.3 : 0.08);
      if (params.alpha !== undefined) {
        m.alpha = params.alpha + 0.07;
        m.backFaceCulling = false;
      }
      mat = m;
    }
    this.cache.set(key, mat);
    return mat;
  }
}
