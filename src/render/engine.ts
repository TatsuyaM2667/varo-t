import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';

export type EngineKind = 'webgpu' | 'webgl2';

export interface EngineHandle {
  engine: AbstractEngine;
  kind: EngineKind;
}

/**
 * WebGPU first, WebGL2 fallback. `?engine=webgl` forces WebGL2 (useful on
 * flaky integrated-GPU drivers at the venue).
 */
export async function createEngine(canvas: HTMLCanvasElement, prefer: 'auto' | 'webgpu' | 'webgl'): Promise<EngineHandle> {
  if (prefer !== 'webgl' && 'gpu' in navigator) {
    try {
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, {
          antialias: true,
          stencil: true,
          powerPreference: 'high-performance',
          adaptToDeviceRatio: false,
        });
        await engine.initAsync();
        return { engine, kind: 'webgpu' };
      }
    } catch (err) {
      console.warn('[engine] WebGPU init failed, falling back to WebGL2', err);
    }
  }
  const engine = new Engine(canvas, true, {
    stencil: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    disableWebGL2Support: false,
  }, false);
  if (engine.webGLVersion < 2) throw new Error('WebGL2 is required');
  return { engine, kind: 'webgl2' };
}
