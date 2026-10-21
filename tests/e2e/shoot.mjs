// Ad-hoc visual check: node tests/e2e/shoot.mjs <url> <out.png> [waitMs]
import { chromium } from '@playwright/test';
const [url, out, wait = '2500'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(Number(wait));
if (process.env.EVAL) console.log('eval:', JSON.stringify(await page.evaluate(process.env.EVAL)));
await page.screenshot({ path: out });
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
