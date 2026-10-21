// Ad-hoc visual check driver.
// node tests/e2e/shoot.mjs <url> <outPrefix> '<json steps>'
// steps: [{"wait":ms}|{"eval":"js"}|{"shot":"name"}|{"keys":["KeyW"],"ms":500}|{"mouse":[dx,dy]}]
import { chromium } from '@playwright/test';
const [url, out, stepsJson = '[]'] = process.argv.slice(2);
const steps = JSON.parse(stepsJson);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
const requests = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
page.on('request', (r) => { if (!r.url().startsWith('http://localhost')) requests.push(r.url()); });
await page.goto(url);
try {
for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.eval) console.log('eval:', JSON.stringify(await page.evaluate(s.eval)));
  if (s.shot) await page.screenshot({ path: `${out}-${s.shot}.png` });
  if (s.keys) { for (const k of s.keys) await page.keyboard.down(k); await page.waitForTimeout(s.ms ?? 300); for (const k of s.keys) await page.keyboard.up(k); }
}
} catch (e) { console.log('STEP FAILED:', e.message); }
console.log(logs.filter((l) => !/GL Driver|\[vite\]/.test(l)).slice(0, 40).join('\n'));
if (requests.length) console.log('EXTERNAL REQUESTS:', requests);
await browser.close();
