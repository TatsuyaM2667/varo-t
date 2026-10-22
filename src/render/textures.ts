import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { GridStyle } from "../config/visuals";

/**
 * Procedural "prototype grid" texture: base colour, fine grid, bolder border,
 * plus a little value noise so large surfaces don't look flat. One tile
 * covers `tileMetres` in world space (see greybox UVs).
 */
export function createGridTexture(
  scene: Scene,
  name: string,
  style: GridStyle,
  size = 512,
): DynamicTexture {
  const tex = new DynamicTexture(
    name,
    { width: size, height: size },
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = style.base;
  ctx.fillRect(0, 0, size, size);

  // Soft value noise: a tiny random canvas upscaled with smoothing, so large
  // surfaces get gentle blotches instead of per-pixel speckle.
  let seed = 1337;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  for (const res of [6, 16]) {
    const small = document.createElement("canvas");
    small.width = small.height = res;
    const sctx = small.getContext("2d")!;
    const img = sctx.createImageData(res, res);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rnd() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.round(
        rnd() * 255 * style.noise * (res === 6 ? 2.5 : 0.8),
      );
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small, 0, 0, size, size);
  }

  const step = size / style.divisions;
  ctx.strokeStyle = style.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 1; i < style.divisions; i++) {
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
  }
  ctx.stroke();
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, size, size);
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}
