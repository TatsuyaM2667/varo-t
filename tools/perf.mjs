// Frame-time profiling across quality presets and backends with Playwright.
//   npm run build && npm run perf               # headless (software GPU, relative numbers only)
//   npm run build && npm run perf -- --headed   # real GPU: run this on the exhibition laptop
// Writes docs/perf.md.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const headed = process.argv.includes('--headed');
const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const executablePath = process.env.CHROME_PATH ?? ['/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const args = headed ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ headless: !headed, executablePath, args });
const rows = [];
let gpu = '';
try {
  for (const engine of ['webgl', 'webgpu']) {
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      await page.goto(`http://localhost:${PORT}/?engine=${engine}&q=${q}&fs=0&attract=1&seed=7`);
      await page.waitForTimeout(5000); // warm-up: shaders, bots spread out
      const r = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const times = [];
            let last = performance.now();
            const end = last + 8000;
            const tick = (t) => {
              times.push(t - last);
              last = t;
              if (t < end) requestAnimationFrame(tick);
              else {
                const s = [...times].sort((a, b) => a - b);
                const g = window.__game;
                let renderer = '';
                try {
                  const info = g.gfx.engine.getGlInfo?.();
                  renderer = `${info?.vendor ?? ''} ${info?.renderer ?? ''}`.trim();
                } catch {}
                resolve({
                  kind: g.gfx.kind,
                  frames: times.length,
                  avg: times.reduce((a, b) => a + b, 0) / times.length,
                  p50: s[Math.floor(s.length * 0.5)],
                  p95: s[Math.floor(s.length * 0.95)],
                  p99: s[Math.floor(s.length * 0.99)],
                  renderer,
                });
              }
            };
            requestAnimationFrame(tick);
          }),
      );
      gpu = gpu || r.renderer;
      rows.push({ engine: r.kind, q, ...r });
      console.log(`${r.kind.padEnd(7)} ${q.padEnd(7)} avg ${r.avg.toFixed(1)}ms  p95 ${r.p95.toFixed(1)}ms  ~${(1000 / r.avg).toFixed(0)} fps`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}

const lines = [
  '# Performance report',
  '',
  `Generated ${new Date().toISOString()} by \`tools/perf.mjs\` (${headed ? 'headed, real GPU' : 'headless, SwiftShader software rendering'}).`,
  `GPU/renderer: \`${gpu || 'unknown'}\`. Scene: attract mode (6 bots fighting, smoke, effects), 1600×900, 8 s after 5 s warm-up.`,
  '',
  headed ? '' : '> Headless numbers use a CPU software rasteriser and are only useful for **relative** comparisons between presets. Run `npm run perf -- --headed` on the exhibition laptop for real numbers (target: Low/Medium ≥ 60 fps = p95 ≤ 16.7 ms).',
  '',
  '| backend | preset | avg ms | p50 ms | p95 ms | p99 ms | ≈fps |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.engine} | ${r.q} | ${r.avg.toFixed(1)} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${(1000 / r.avg).toFixed(0)} |`),
  '',
  'The in-game adaptive controller (render scale → effects → post) additionally lowers quality when p95 > 19 ms for 4 s.',
];
writeFileSync('docs/perf.md', `${lines.join('\n')}\n`);
console.log('wrote docs/perf.md');
