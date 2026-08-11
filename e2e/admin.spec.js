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
    await expect(page.getByRole('heading', { name: 'Zones', exact: true })).toBeVisible();
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

  test('imports zones from a JSON file and lists them', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('h2', { hasText: 'Import zones' })).toBeVisible();
    await expectLegible(page.locator('h2', { hasText: 'Import zones' }));

    const stamp = Date.now();
    const zoneName = `Imported Zone ${stamp}`;
    const file = {
      name: 'zones.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          zones: [
            {
              name: zoneName,
              hint: 'Uploaded from a file',
              polygon: [
                [37.77, -122.45],
                [37.771, -122.45],
                [37.771, -122.449],
              ],
            },
          ],
        })
      ),
    };

    // Append mode (default): the confirm dialog then the toast.
    await page.locator('#zonesFile').setInputFiles(file);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('body')).toContainText(zoneName);
  });

  test('exports the current zones as a JSON download', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('h2', { hasText: 'Export zones' })).toBeVisible();
    // The export link is authed with the signed image token, which is fetched
    // asynchronously after login. Wait for a token-dependent QR thumbnail to
    // appear so we don't click Export before the token is ready.
    await expect(page.locator('img.qr-thumb').first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export zones' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('geocache-zones.json');
  });
});
