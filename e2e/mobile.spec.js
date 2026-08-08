import { test, expect } from '@playwright/test';
import { fixture, signInAs, expectLegible } from './helpers.js';

const fx = fixture();

// These checks are meaningful only at a phone width (bottom tab bar layout).
test.describe('Mobile layout', () => {
  test.beforeEach(async ({ page }) => {
    const vp = page.viewportSize();
    test.skip(!vp || vp.width >= 760, 'phone-width only');
  });

  test('bottom tab bar is visible and legible', async ({ page }) => {
    await page.goto('/');
    const tabbar = page.locator('.tabbar');
    await expect(tabbar).toBeVisible();
    await expectLegible(page.getByRole('button', { name: 'Map' }));
    await expectLegible(page.getByRole('button', { name: 'Leaderboard' }));
  });

  test('Leaderboard tab swaps the map for a full-screen board', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Leaderboard' }).click();
    const board = page.locator('.leaderboard');
    await expect(board).toBeVisible();
    await expect(board).toContainText('Fog Chasers');
    // Map hidden while board is shown.
    await expect(page.locator('.layout #map')).toBeHidden();

    // Back to the map.
    await page.getByRole('button', { name: 'Map' }).click();
    await expect(page.locator('.layout #map')).toBeVisible();
  });

  test('scan button sits above the tab bar (not overlapped)', async ({ page }) => {
    await page.goto('/');
    const fab = page.locator('.scan-fab');
    const tabbar = page.locator('.tabbar');
    await expect(fab).toBeVisible();
    const fabBox = await fab.boundingBox();
    const tabBox = await tabbar.boundingBox();
    expect(fabBox, 'scan fab box').not.toBeNull();
    expect(tabBox, 'tabbar box').not.toBeNull();
    // The fab's bottom edge should be above the tab bar's top edge.
    expect(fabBox.y + fabBox.height).toBeLessThanOrEqual(tabBox.y + 2);
  });

  test('claim modal fits the viewport width on mobile', async ({ page }) => {
    await signInAs(page, fx.crews.trolls);
    await page.goto(`/?c=${fx.zones.beta.secret}`);
    const modal = page.locator('.modal.admin-modal').last();
    await expect(modal).toBeVisible();
    const box = await modal.boundingBox();
    const vp = page.viewportSize();
    expect(box.width).toBeLessThanOrEqual(vp.width);
    await expectLegible(modal.locator('.modal-body h2'));
  });
});
