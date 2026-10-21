import { expect, test } from '@playwright/test';

interface GameHandle {
  __game: {
    gfx: { kind: string };
    input: { enabled: boolean };
    session: { player: { x: number; y: number; z: number }; world: { tick: number } };
  };
}

for (const engine of ['webgl', 'webgpu'] as const) {
  test(`boots and walks (${engine})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/?engine=${engine}`);
    await page.waitForFunction(() => (window as unknown as GameHandle).__game?.session.world.tick > 30, null, { timeout: 30_000 });

    const kind = await page.evaluate(() => (window as unknown as GameHandle).__game.gfx.kind);
    if (engine === 'webgl') expect(kind).toBe('webgl2');

    const z0 = await page.evaluate(() => {
      const g = (window as unknown as GameHandle).__game;
      g.input.enabled = true; // pointer lock is unavailable headless
      return g.session.player.z;
    });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyW');
    const z1 = await page.evaluate(() => (window as unknown as GameHandle).__game.session.player.z);
    expect(z1 - z0).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });
}
