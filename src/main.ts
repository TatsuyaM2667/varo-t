import './ui/styles.css';
import { App } from './app/app';
import { InputManager } from './input/input-manager';
import { createEngine } from './render/engine';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

async function boot(): Promise<void> {
  const prefer = (params.get('engine') as 'webgpu' | 'webgl' | null) ?? 'auto';
  const gfx = await createEngine(canvas, prefer);
  const input = new InputManager(canvas);
  const app = new App(gfx, input, ui, params);

  // Exhibition safety: uncaught errors from the game return to the title
  // instead of freezing. Harmless browser noise (ResizeObserver, extensions,
  // rejected pointer-lock / fullscreen / audio requests) is only logged.
  window.addEventListener('error', (e) => {
    const fromPage = !e.filename || e.filename.startsWith(location.origin);
    if (!fromPage || isBenign(e.message)) return void console.warn('[ignored error]', e.message);
    app.recover(e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason);
    if (isBenign(msg)) return void console.warn('[ignored rejection]', msg);
    app.recover(e.reason);
  });
  gfx.engine.onContextLostObservable?.add(() => setTimeout(() => location.reload(), 1500));

  canvas.addEventListener('click', () => {
    if (app.debugState().state === 'match' && !input.pointerLocked) void input.lockPointer();
  });

  (window as unknown as { __game: unknown }).__game = { app, gfx, input };

  app.goTitle();
  gfx.engine.runRenderLoop(() => {
    try {
      app.frame();
    } catch (err) {
      app.recover(err);
    }
  });
  window.addEventListener('resize', () => gfx.engine.resize());
}

/** Errors that are not game bugs and must not trigger the recovery screen. */
export function isBenign(message: string | undefined): boolean {
  return /ResizeObserver loop|^Script error\.?$|pointer ?lock|exited the lock|NotAllowedError|AbortError|fullscreen|keyboard\.lock|play\(\) request|The AudioContext/i.test(message ?? '');
}

boot().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'crash';
  box.textContent = `起動に失敗しました / Failed to start: ${String(err)}`;
  ui.append(box);
  setTimeout(() => location.reload(), 8000);
});
