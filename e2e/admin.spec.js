import { test, expect } from '@playwright/test';
import { fixture, expectLegible } from './helpers.js';

const fx = fixture();

test.describe('Admin console', () => {
  test('shows a legible login screen', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('h2', { hasText: 'Admin login' })).toBeVisible();
    await expectLegible(page.locator('h2', { hasText: 'Admin login' }));
    await expect(page.locator('#pw')).toBeVisible();
    await expectLegible(page.getByRole('button', { name: 'Log in' }));
  });

  test('rejects a wrong password with a visible error', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#pw').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Log in' }).click();
    const err = page.locator('.err', { hasText: 'Wrong password' });
    await expect(err).toBeVisible();
    await expectLegible(err);
  });

  test('logs in with the correct password and reveals the console', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.locator('h2', { hasText: 'Crews' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Zones' })).toBeVisible();
    await expectLegible(page.locator('h2', { hasText: 'Crews' }));

    // Seeded crews and zones are listed.
    await expect(page.locator('.groups, .group-list, body')).toContainText('Fog Chasers');
    await expect(page.locator('body')).toContainText('Alpha Cache');
  });

  test('can create a new crew from the console', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('h2', { hasText: 'Crews' })).toBeVisible();

    const name = `Test Crew ${Date.now()}`;
    await page.locator('#grpName').fill(name);
    await page.getByRole('button', { name: 'Create crew' }).click();
    await expect(page.locator('body')).toContainText(name);
  });
});
