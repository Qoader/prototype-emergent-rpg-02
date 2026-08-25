import { expect, test } from '@playwright/test';

test.describe('Emberwild', () => {
  test('loads the adventure HUD and world canvas', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('./');

    await expect(page).toHaveTitle('Emberwild');
    await expect(page.getByText('EMBERWILD', { exact: true })).toBeVisible();
    await expect(page.getByText('Preparing the Emberwild…', { exact: true })).toBeVisible();
    await expect(
      page.getByText('WORLD SEED EMBERWILD-01', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('.canvas-host canvas')).toBeVisible();
    await expect(page.locator('.tile-debug')).toContainText('CURRENT TILE');
    await expect(page.locator('.tile-debug')).toContainText('starter-ground');
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName('emberwild-player-chunk-ready').length), { timeout: 50_000 }).toBe(1);
    const startupMarks = await page.evaluate(() => ['emberwild-worker-ready', 'emberwild-player-chunk-ready'].map((name) => performance.getEntriesByName(name)[0]?.startTime ?? -1));
    expect(startupMarks[0]).toBeGreaterThanOrEqual(0);
    expect(startupMarks[1]).toBeGreaterThan(startupMarks[0]);
    const firstChunkMs = await page.evaluate(() => performance.getEntriesByName('emberwild-player-chunk')[0]?.duration ?? Infinity);
    expect(firstChunkMs).toBeLessThan(50_000);
  });

  test('opens settings and toggles tile debug visibility', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Nearby settlements', { exact: true })).toBeVisible();
    const toggle = page.getByRole('checkbox', { name: 'Show tile info debug panel' });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(page.locator('.tile-debug')).toHaveCount(0);
    await toggle.check();
    await expect(page.locator('.tile-debug')).toBeVisible();
  });
});
