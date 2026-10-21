import './ui/styles.css';
import { BRAND } from './config/brand';
import { QUALITY_PRESETS, type QualityName } from './config/quality';
import { Session } from './app/session';
import { InputManager } from './input/input-manager';
import { createEngine } from './render/engine';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

async function boot(): Promise<void> {
  const prefer = (params.get('engine') as 'webgpu' | 'webgl' | null) ?? 'auto';
  const gfx = await createEngine(canvas, prefer);
  const qualityName = (params.get('q') as QualityName | null) ?? 'medium';
  const quality = QUALITY_PRESETS[qualityName] ?? QUALITY_PRESETS.medium;
  const input = new InputManager(canvas);
  const session = new Session(gfx, input, quality, Number(params.get('seed') ?? 1));

  const hud = el('div');
  hud.innerHTML = `<div class="crosshair"><i class="h l"></i><i class="h r"></i><i class="v t"></i><i class="v b"></i><i class="dot"></i></div>`;
  const debug = el('div', 'debug');
  const callout = el('div', 'callout');
  hud.append(debug, callout);
  ui.append(hud);

  const title = el(
    'div',
    'screen',
    `<h1 class="title">${BRAND.gameTitle.replace(' ', ' <span>')}</span></h1>
     <div class="sub">${BRAND.tagline.ja}</div>
     <div class="prompt">クリックして開始</div>`,
  );
  ui.append(title);

  const start = async (): Promise<void> => {
    await input.lockPointer();
    // Fullscreen + Keyboard Lock lets Ctrl (crouch) work without triggering
    // browser shortcuts such as Ctrl+W. Both are best-effort.
    try {
      if (!document.fullscreenElement && params.get('fs') !== '0') await document.documentElement.requestFullscreen();
      await (navigator as Navigator & { keyboard?: { lock?: (k?: string[]) => Promise<void> } }).keyboard?.lock?.();
    } catch {
      /* not allowed here; C still crouches */
    }
  };
  title.addEventListener('click', start);
  canvas.addEventListener('click', start);
  document.addEventListener('pointerlockchange', () => {
    const locked = input.pointerLocked;
    input.enabled = locked;
    title.hidden = locked;
  });

  // Expose for Playwright / debugging.
  (window as unknown as { __game: unknown }).__game = { session, gfx, input };

  let frames = 0;
  gfx.engine.runRenderLoop(() => {
    session.frame();
    if ((frames++ & 7) === 0) {
      debug.textContent = session.debugText();
      callout.textContent = session.callout();
    }
  });
  window.addEventListener('resize', () => gfx.engine.resize());
}

boot().catch((err: unknown) => {
  console.error(err);
  ui.append(el('div', 'crash', `起動に失敗しました: ${String(err)}`));
});
