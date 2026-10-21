import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use the system Chromium when present (no download needed); otherwise
// `npx playwright install chromium` provides one.
const systemChrome = ['/usr/bin/chromium', '/usr/bin/google-chrome'].find((p) => existsSync(p));

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      executablePath: process.env.CHROME_PATH ?? systemChrome,
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    port: 5174,
    reuseExistingServer: true,
  },
});
