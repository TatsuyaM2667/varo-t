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

  drawPattern(ctx, style, size, rnd);
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return tex;
}

/** Pattern layer drawn over the base colour + noise. Lines tile seamlessly. */
function drawPattern(ctx: CanvasRenderingContext2D, style: GridStyle, size: number, rnd: () => number): void {
  const n = style.divisions;
  const step = size / n;
  const pattern = style.pattern ?? "grid";
  ctx.strokeStyle = style.line;
  switch (pattern) {
    case "grid": {
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step, size);
        ctx.moveTo(0, i * step);
        ctx.lineTo(size, i * step);
      }
      ctx.stroke();
      ctx.strokeStyle = style.accent;
      ctx.lineWidth = 6;
      ctx.strokeRect(0, 0, size, size);
      break;
    }
    case "tile": {
      // slightly varied tiles with grout
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const v = Math.round((rnd() - 0.5) * 18);
          ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
          ctx.fillRect(x * step, y * step, step, step);
        }
      ctx.lineWidth = Math.max(3, size / 128);
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step, size);
        ctx.moveTo(0, i * step);
        ctx.lineTo(size, i * step);
      }
      ctx.stroke();
      break;
    }
    case "brick": {
      // running-bond bricks: n rows, 4 bricks per row, every other row offset
      const rows = n;
      const bh = size / rows;
      const bw = size / 4;
      ctx.lineWidth = Math.max(3, size / 150);
      for (let r = 0; r < rows; r++) {
        const off = r % 2 ? bw / 2 : 0;
        for (let i = -1; i < 5; i++) {
          const v = Math.round((rnd() - 0.5) * 30);
          ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
          ctx.fillRect(i * bw + off, r * bh, bw, bh);
        }
        ctx.beginPath();
        ctx.moveTo(0, r * bh);
        ctx.lineTo(size, r * bh);
        for (let i = 0; i <= 4; i++) {
          ctx.moveTo(i * bw + off, r * bh);
          ctx.lineTo(i * bw + off, (r + 1) * bh);
        }
        ctx.stroke();
      }
      break;
    }
    case "cobble": {
      // rounded stones on a jittered grid (wrapped so the tile repeats)
      ctx.lineWidth = Math.max(2, size / 200);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const cx = (x + 0.5 + (rnd() - 0.5) * 0.25) * step;
          const cy = (y + 0.5 + (rnd() - 0.5) * 0.25) * step;
          const rx = step * (0.42 + rnd() * 0.06);
          const ry = step * (0.4 + rnd() * 0.06);
          const v = Math.round((rnd() - 0.5) * 40);
          for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
            ctx.beginPath();
            ctx.ellipse(cx + ox, cy + oy, rx, ry, rnd() * Math.PI, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
            ctx.fill();
            ctx.stroke();
          }
        }
      break;
    }
    case "plaster": {
      // soft stucco: a few faint horizontal render lines
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        ctx.moveTo(0, i * step);
        ctx.lineTo(size, i * step);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case "plate": {
      ctx.lineWidth = Math.max(3, size / 128);
      ctx.strokeRect(2, 2, size - 4, size - 4);
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step, size);
        ctx.moveTo(0, i * step);
        ctx.lineTo(size, i * step);
      }
      ctx.stroke();
      // rivets and a diamond-tread hint
      ctx.fillStyle = style.accent;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
          for (const [dx, dy] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) {
            ctx.beginPath();
            ctx.arc((x + dx) * step, (y + dy) * step, size / 120, 0, Math.PI * 2);
            ctx.fill();
          }
      break;
    }
    case "grass": {
      // short strokes of lighter/darker blades
      for (let i = 0; i < 1400; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        ctx.strokeStyle = rnd() < 0.5 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.16)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rnd() - 0.5) * 6, y - 6 - rnd() * 8);
        ctx.stroke();
      }
      break;
    }
  }
}
