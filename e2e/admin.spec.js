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

    // The Zones tab is selected by default; seeded zones are listed there.
    await expect(page.getByRole('heading', { name: 'Zones', exact: true })).toBeVisible();
    await expect(page.locator('body')).toContainText('Alpha Cache');

    // Employees live under the Employees tab.
    await page.getByRole('tab', { name: 'Employees' }).click();
    await expect(page.locator('h2', { hasText: 'Employees' })).toBeVisible();
    await expectLegible(page.locator('h2', { hasText: 'Employees' }));
    await expect(page.locator('body')).toContainText('Fog Chasers');
  });

  test('can create a new employee from the console', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('tab', { name: 'Employees' }).click();
    await expect(page.locator('h2', { hasText: 'Employees' })).toBeVisible();

    const name = `Test Employee ${Date.now()}`;
    await page.locator('#grpName').fill(name);
    await page.getByRole('button', { name: 'Create employee' }).click();
    await expect(page.locator('body')).toContainText(name);
  });

  test('imports zones from a JSON file and lists them', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('tab', { name: 'Data' }).click();
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
    // Imported zones are listed under the Zones tab.
    await page.getByRole('tab', { name: 'Zones' }).click();
    await expect(page.locator('body')).toContainText(zoneName);
  });

  test('exports the current zones as a JSON download', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    // The export link is authed with the signed image token, which is fetched
    // asynchronously after login. Wait for a token-dependent QR thumbnail on the
    // Zones tab so we don't click Export before the token is ready.
    await expect(page.locator('img.qr-thumb').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Data' }).click();
    await expect(page.locator('h2', { hasText: 'Export zones' })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Export zones' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('care-zones.json');
  });

  test('adjusts an employee\u2019s points and deletes an employee', async ({ page, request }) => {
    const headers = { 'x-admin-password': fx.admin };
    const name = `Temp Employee ${Date.now()}`;
    const created = await (await request.post('/api/employees', { headers, data: { name } })).json();

    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('tab', { name: 'Employees' }).click();
    const card = page.locator('.zone-item', { hasText: name });
    await expect(card.locator('.stepper-value')).toHaveText('0 pts');
    await expect(card.locator('.adjustment')).toHaveCount(0); // hidden when there's no adjustment

    const plus = card.getByRole('button', { name: `Add a point for ${name}` });
    const minus = card.getByRole('button', { name: `Subtract a point from ${name}` });
    for (let i = 0; i < 3; i++) await plus.click();
    await expect(card.locator('.stepper-value')).toHaveText(/^\s*3 pts\s*\(\+3\)\s*$/);
    for (let i = 0; i < 4; i++) await minus.click();
    await expect(card.locator('.stepper-value')).toHaveText(/^\s*\u22121 pts\s*\(\u22121\)\s*$/);
    await expect(card.locator('.adjustment')).toHaveClass(/neg/);
    for (let i = 0; i < 3; i++) await plus.click();
    await expect.poll(async () => {
      const board = await (await request.get('/api/leaderboard')).json();
      return board.find((r) => r.id === created.id)?.points;
    }).toBe(2);
    await page.reload(); // the total survives a reload (saved server-side; login is kept for the session)
    await page.getByRole('tab', { name: 'Employees' }).click();
    await expect(card.locator('.stepper-value')).toHaveText(/^\s*2 pts\s*\(\+2\)\s*$/);

    await card.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete employee' }).click();
    await expect(page.locator('.zone-item', { hasText: name })).toHaveCount(0);
    expect((await request.get(`/api/employees/${created.token}`)).status()).toBe(404);
  });
});

test.describe('Employee admin API', () => {
  test('points and delete endpoints need the admin password and validate input', async ({ request }) => {
    const headers = { 'x-admin-password': fx.admin };
    const e = await (await request.post('/api/employees', { headers, data: { name: `API ${Date.now()}` } })).json();

    expect((await request.post(`/api/admin/employees/${e.id}/points`, { data: { delta: 5 } })).status()).toBe(401);
    expect((await request.delete(`/api/admin/employees/${e.id}`)).status()).toBe(401);

    for (const delta of [0, 1.5, 'abc', 5000]) {
      const bad = await request.post(`/api/admin/employees/${e.id}/points`, { headers, data: { delta } });
      expect(bad.status()).toBe(400);
    }
    const ok = await request.post(`/api/admin/employees/${e.id}/points`, { headers, data: { delta: -4 } });
    expect(await ok.json()).toEqual({ points: -4 });

    expect((await request.delete(`/api/admin/employees/${e.id}`, { headers })).status()).toBe(200);
    expect((await request.delete(`/api/admin/employees/${e.id}`, { headers })).status()).toBe(404);
    expect((await request.post(`/api/admin/employees/${e.id}/points`, { headers, data: { delta: 1 } })).status()).toBe(404);
  });
});

test.describe('Zone import API keeps QR secrets', () => {
  const POLY = [[37.77, -122.45], [37.771, -122.45], [37.771, -122.449]];
  const post = (request, zones, replace = false) =>
    request.post('/api/admin/zones/import', { headers: { 'x-admin-password': fx.admin }, data: { zones, replace } });

  test('accepts files well over the old 512 KB limit, and says clearly when one is too large', async ({ request }) => {
    const headers = { 'x-admin-password': fx.admin };
    // 1.5 MB, like an export with a few hint images: parsed (then rejected only for
    // having no zones), so nothing is written.
    const big = await request.post('/api/admin/zones/import', { headers, data: { zones: [], pad: 'x'.repeat(1.5 * 1024 * 1024) } });
    expect(big.status()).toBe(400);
    expect((await big.json()).message).toBe('No zones found in the file');

    // Over the 10 MB default: a 413 that names the size, not "not valid JSON".
    const huge = await request.post('/api/admin/zones/import', { headers, data: { zones: [], pad: 'x'.repeat(11 * 1024 * 1024) } });
    expect(huge.status()).toBe(413);
    expect((await huge.json()).message).toMatch(/^That file \(11\.0 MB\) is larger than this server accepts\. Raise BODY_SIZE_LIMIT/);
  });

  test('an exported secret is reused, so the QR code resolves to the imported zone', async ({ request }) => {
    const secret = `keep_${Date.now().toString(36)}`;
    const res = await post(request, [{ name: `Kept QR ${secret}`, hint: '', polygon: POLY, secret }]);
    expect(res.status()).toBe(201);
    const zone = await (await request.get(`/api/claim/${secret}`)).json();
    expect(zone.name).toBe(`Kept QR ${secret}`);

    // Export includes it.
    const t = await (await request.get('/api/admin/token', { headers: { 'x-admin-password': fx.admin } })).json();
    const dump = await (await request.get(`/api/admin/zones/export?t=${encodeURIComponent(t.token)}`)).json();
    expect(dump.zones.find((z) => z.secret === secret)?.name).toBe(`Kept QR ${secret}`);
  });

  test('clashing, duplicated and malformed secrets are rejected with a clear 400', async ({ request }) => {
    const taken = fx.zones.alpha.secret;
    const clash = await post(request, [{ name: 'Clash', hint: '', polygon: POLY, secret: taken }]);
    expect(clash.status()).toBe(400);
    expect((await clash.json()).message).toMatch(/Zone #1 \("Clash"\): its QR secret already belongs to the zone "Alpha Cache"/);
    expect((await (await request.get(`/api/claim/${taken}`)).json()).name).toBe('Alpha Cache'); // untouched

    const dup = await post(request, [
      { name: 'One', hint: '', polygon: POLY, secret: 'sameSecret99' },
      { name: 'Two', hint: '', polygon: POLY, secret: 'sameSecret99' },
    ]);
    expect(dup.status()).toBe(400);
    expect((await dup.json()).message).toMatch(/Zone #2 \("Two"\): another zone in this file has the same "secret"/);

    const bad = await post(request, [{ name: 'Bad', hint: '', polygon: POLY, secret: 'no spaces!' }]);
    expect(bad.status()).toBe(400);
    expect((await bad.json()).message).toMatch(/"secret" must be 8-64 letters/);
    expect((await request.get('/api/claim/sameSecret99')).status()).toBe(404); // nothing was imported
  });
});
