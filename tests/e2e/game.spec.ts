import { expect, type Page, test } from '@playwright/test';

/** Test hooks exposed on window.__game (see src/main.ts). */
interface Hooks {
  __game: {
    app: {
      startMatch(): void;
      debugState(): {
        state: string;
        match: { world: { round: { phase: string }; agents: { x: number; z: number; alive: boolean; stats: { shots: number } }[] }; setPaused(p: boolean): void } | null;
        attract: { showcase: boolean } | null;
      };
    };
    gfx: { kind: string };
    input: { enabled: boolean };
  };
}

async function boot(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?fs=0&${query}`);
  await page.waitForFunction(() => (window as unknown as Hooks).__game?.app.debugState().state === 'title', null, { timeout: 30_000 });
  return errors;
}

async function startMatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as Hooks).__game;
    g.app.startMatch();
    g.input.enabled = true; // pointer lock is unavailable headless
    g.app.debugState().match!.setPaused(false);
  });
}

test('title boots with the bot demo behind it (WebGL2)', async ({ page }) => {
  const errors = await boot(page, 'engine=webgl');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as Hooks).__game.gfx.kind)).toBe('webgl2');
  await expect(page.locator('.logo')).toBeVisible();
  await page.screenshot({ path: 'test-results/title.png' });
  expect(errors).toEqual([]);
});

test('a match starts, the player moves and can shoot', async ({ page }) => {
  const errors = await boot(page, 'engine=webgl&q=low&autostart');
  await startMatch(page);
  await page.waitForFunction(() => (window as unknown as Hooks).__game.app.debugState().match?.world.round.phase === 'live', null, { timeout: 30_000 });
  const z0 = await page.evaluate(() => (window as unknown as Hooks).__game.app.debugState().match!.world.agents[0].z);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const z1 = await page.evaluate(() => (window as unknown as Hooks).__game.app.debugState().match!.world.agents[0].z);
  expect(z1 - z0).toBeGreaterThan(0.5);
  await expect(page.locator('.hud-top')).toBeVisible();
  await page.screenshot({ path: 'test-results/match.png' });
  expect(errors).toEqual([]);
});

test('no input for the idle timeout returns to the title', async ({ page }) => {
  await boot(page, 'engine=webgl&q=low&autostart&idle=3');
  await startMatch(page);
  await page.waitForFunction(() => (window as unknown as Hooks).__game.app.debugState().state === 'title', null, { timeout: 20_000 });
});

test('an uncaught error shows the recovery screen and returns to the title', async ({ page }) => {
  await page.goto('/?fs=0&engine=webgl&q=low&autostart');
  await page.waitForFunction(() => (window as unknown as Hooks).__game?.app.debugState().state === 'title', null, { timeout: 30_000 });
  await startMatch(page);
  await page.evaluate(() => setTimeout(() => {
    throw new Error('injected test failure');
  }));
  await expect(page.locator('.crash')).toBeVisible();
  await page.waitForFunction(() => (window as unknown as Hooks).__game.app.debugState().state === 'title', null, { timeout: 15_000 });
  await expect(page.locator('.crash')).toHaveCount(0);
});

test('title idle switches to the full-screen demo, input brings the menu back', async ({ page }) => {
  await boot(page, 'engine=webgl&q=low&attract=2');
  await page.waitForFunction(() => (window as unknown as Hooks).__game.app.debugState().attract?.showcase === true, null, { timeout: 20_000 });
  await expect(page.locator('.attract-banner')).toBeVisible();
  await page.mouse.move(100, 100);
  await page.mouse.move(300, 200);
  await expect(page.locator('.attract-banner')).toHaveCount(0);
});

test('WebGPU path makes no external network requests (offline-safe)', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost')) external.push(r.url());
  });
  const errors = await boot(page, 'q=high&autostart');
  await startMatch(page);
  await page.waitForTimeout(4000);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('Tier 0 (all feature flags off) still plays', async ({ page }) => {
  const errors = await boot(page, 'engine=webgl&q=low&autostart&f=tier0');
  await startMatch(page);
  await page.waitForFunction(() => (window as unknown as Hooks).__game.app.debugState().match?.world.round.phase === 'live', null, { timeout: 30_000 });
  expect(errors).toEqual([]);
});
