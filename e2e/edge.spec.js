import { test, expect } from '@playwright/test';
import { fixture, signInAs, createZone } from './helpers.js';

// Edge cases for a paid event: bad input, flaky networks, odd phones, long names,
// and an admin console left open all day. Nothing here may produce a 500, a page
// error, or a layout that spills off a small phone.
const fx = fixture();
const H = { 'x-admin-password': fx.admin };
const POLY = [[37.77, -122.45], [37.771, -122.45], [37.771, -122.449]];
const uid = () => Math.random().toString(36).slice(2, 8);
const newEmployee = async (request, name = `Edge ${uid()}`) =>
  (await request.post('/api/employees', { headers: H, data: { name } })).json();

// Fail the test on any uncaught error in the page.
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
const claimModal = (page) => page.locator('.modal-overlay', { has: page.locator('#claimTitle') });

test.describe('API hardening', () => {
  test('every admin endpoint rejects a missing or wrong password, and download tokens can\u2019t write', async ({ request }) => {
    const e = await newEmployee(request);
    const z = await createZone(request, fx.admin);
    const { token } = await (await request.get('/api/admin/token', { headers: H })).json();
    const routes = [
      ['GET', '/api/admin/zones'], ['POST', '/api/admin/zones'], ['PUT', `/api/admin/zones/${z.id}`],
      ['DELETE', `/api/admin/zones/${z.id}`], ['POST', `/api/admin/zones/${z.id}/claim`], ['POST', `/api/admin/zones/${z.id}/unclaim`],
      ['GET', `/api/admin/zones/${z.id}/qr`], ['GET', '/api/admin/zones/export'], ['POST', '/api/admin/zones/import'],
      ['POST', '/api/admin/reset'], ['GET', '/api/admin/token'], ['DELETE', `/api/admin/employees/${e.id}`],
      ['POST', `/api/admin/employees/${e.id}/points`], ['POST', '/api/employees'],
    ];
    for (const [method, path] of routes) {
      const data = method === 'POST' || method === 'PUT' ? {} : undefined;
      for (const headers of [{}, { 'x-admin-password': `${fx.admin}x` }]) {
        expect((await request.fetch(path, { method, headers, data })).status(), `${method} ${path}`).toBe(401);
      }
      if (method !== 'GET') {
        const res = await request.fetch(`${path}?t=${encodeURIComponent(token)}`, { method, data });
        expect(res.status(), `${method} ${path} with a download token`).toBe(401);
      }
    }
    for (const t of ['', '.', 'abc', '123.', `${Date.now() - 1000}.${token.split('.')[1]}`, 'x'.repeat(5000)]) {
      expect((await request.get(`/api/admin/zones/export?t=${encodeURIComponent(t)}`)).status()).toBe(401);
    }
  });

  test('public responses never include zone secrets or personal-link tokens', async ({ request }) => {
    const e = await newEmployee(request);
    const secret = fx.zones.alpha.secret;
    for (const path of ['/api/zones', '/api/leaderboard', '/api/employees', `/api/claim/${secret}`, '/api/config']) {
      const text = await (await request.get(path)).text();
      if (!path.includes(secret)) expect(text, path).not.toContain(secret);
      expect(text, path).not.toContain(e.token);
      expect(text, path).not.toContain(fx.employees.fog.token);
    }
  });

  test('malformed or wrongly typed requests get a 4xx, never a 500', async ({ request }) => {
    const e = await newEmployee(request);
    const z = await createZone(request, fx.admin);
    const bodies = ['', 'hello', 'null', '[]', '"x"', '5', 'true', '{"a":', '['.repeat(5000)];
    const endpoints = [
      ['POST', '/api/claim', {}], ['POST', '/api/admin/login', {}], ['POST', '/api/admin/reset?dry', H],
      ['POST', '/api/admin/zones', H], ['PUT', `/api/admin/zones/${z.id}`, H], ['POST', `/api/admin/zones/${z.id}/claim`, H],
      ['POST', `/api/admin/zones/${z.id}/unclaim`, H], ['POST', `/api/admin/employees/${e.id}/points`, H],
      ['POST', '/api/admin/zones/import', H], ['POST', '/api/employees', H],
    ];
    for (const [method, path, headers] of endpoints) {
      if (path.startsWith('/api/admin/reset')) continue; // a valid reset would wipe the shared fixture
      for (const body of bodies) {
        const res = await request.fetch(path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, data: body });
        expect(res.status(), `${method} ${path} body ${JSON.stringify(body.slice(0, 12))}`).toBeLessThan(500);
      }
    }
    const typed = [
      ['/api/claim', {}, { secret: 123, employeeToken: e.token }], ['/api/claim', {}, { secret: ['x'], employeeToken: e.token }],
      ['/api/claim', {}, { secret: { a: 1 }, employeeToken: 42 }], ['/api/claim', {}, { secret: fx.zones.alpha.secret, employeeToken: [e.token] }],
      ['/api/claim', {}, { secret: fx.zones.alpha.secret, employeeToken: e.token, lat: 'x', lng: {}, accuracy: -5 }],
      ['/api/employees', H, { name: 12 }], ['/api/employees', H, { name: { a: 1 } }], ['/api/employees', H, { name: ['a'] }],
      ['/api/admin/zones', H, { name: { a: 1 }, polygon: POLY }], ['/api/admin/zones', H, { name: 'n', hint: ['x'], polygon: POLY }],
      ['/api/admin/zones', H, { name: 'n', polygon: [[{}, {}], 'x', null] }],
      [`/api/admin/zones/${z.id}/claim`, H, { employeeId: { a: 1 } }], ['/api/admin/login', {}, { password: { a: 1 } }],
    ];
    for (const [path, headers, data] of typed) {
      const res = await request.post(path, { headers, data });
      expect(res.status(), `${path} ${JSON.stringify(data).slice(0, 60)}`).toBeLessThan(500);
    }
    // The odd-but-valid claim (junk location on a zone without a claim spot) still works.
    const ok = await request.post('/api/claim', { data: { secret: fx.zones.alpha.secret, employeeToken: e.token, lat: 'x' } });
    expect(ok.status()).toBe(200);
  });

  test('odd ids and secrets in URLs get a 404/400, never a 500', async ({ request }) => {
    for (const id of ['abc', '-1', '0', '1.5', '99999999999999999999', '1e3', 'NaN', '0x10']) {
      expect((await request.delete(`/api/admin/employees/${id}`, { headers: H })).status()).toBe(404);
      expect((await request.post(`/api/admin/employees/${id}/points`, { headers: H, data: { delta: 1 } })).status()).toBe(404);
      expect((await request.get(`/api/admin/zones/${id}/qr`, { headers: H })).status()).toBe(404);
      expect((await request.get(`/api/zones/${id}/image`)).status()).toBe(404);
      expect((await request.put(`/api/admin/zones/${id}`, { headers: H, data: { name: 'x', polygon: POLY } })).status()).toBe(404);
    }
    for (const s of ['%00', '..%2F..%2Fetc%2Fpasswd', 'a'.repeat(3000), '%E2%80%AE', '%3Cscript%3E']) {
      expect((await request.get(`/api/claim/${s}`)).status()).toBe(404);
      expect((await request.get(`/api/employees/${s}`)).status()).toBe(404);
    }
  });

  test('an import only replaces the map when "replace" is exactly true', async ({ request }) => {
    const before = (await (await request.get('/api/admin/zones', { headers: H })).json()).length;
    for (const replace of ['false', 'true', 1, 'yes']) {
      const res = await request.post('/api/admin/zones/import', { headers: H, data: { zones: [{ name: `Keep ${uid()}`, polygon: POLY }], replace } });
      expect(res.status()).toBe(201);
      expect((await res.json()).replaced, JSON.stringify(replace)).toBe(false);
    }
    const after = await (await request.get('/api/admin/zones', { headers: H })).json();
    expect(after.length).toBe(before + 4); // appended, nothing wiped
    expect(after.some((z) => z.secret === fx.zones.alpha.secret)).toBe(true);
  });

  test('point adjustments only accept whole numbers from \u22121000 to 1000', async ({ request }) => {
    const e = await newEmployee(request);
    for (const delta of ['5', true, [1], null, '', 0, 1.5, 1001, -1001, 'Infinity']) {
      expect((await request.post(`/api/admin/employees/${e.id}/points`, { headers: H, data: { delta } })).status(), JSON.stringify(delta)).toBe(400);
    }
    for (const delta of [1000, -1000, -1]) {
      expect((await request.post(`/api/admin/employees/${e.id}/points`, { headers: H, data: { delta } })).status()).toBe(200);
    }
    const board = await (await request.get('/api/leaderboard')).json();
    expect(board.find((r) => r.id === e.id).points).toBe(-1);
  });

  test('invisible names are rejected; control characters are cleaned out', async ({ request }) => {
    for (const name of ['\u200B', '\u200B\u200D', '   ', '\n\t', '\u0000']) {
      expect((await request.post('/api/employees', { headers: H, data: { name } })).status(), JSON.stringify(name)).toBe(400);
      expect((await request.post('/api/admin/zones', { headers: H, data: { name, polygon: POLY } })).status(), JSON.stringify(name)).toBe(400);
    }
    expect((await newEmployee(request, 'Line\nBreak\u202E')).name).toBe('Line Break');
    expect((await newEmployee(request, '\u{1F469}\u200D\u{1F4BB} Team')).name).toBe('\u{1F469}\u200D\u{1F4BB} Team');
    expect((await request.post('/api/employees', { headers: H, data: { name: 'x'.repeat(41) } })).status()).toBe(400);
  });
});

test.describe('Phone edge cases', () => {
  test('a page opened while the server is down recovers by itself once it\u2019s back', async ({ page }) => {
    const errors = watchErrors(page);
    let down = true;
    await page.route('**/api/{config,zones,leaderboard}', (route) => (down ? route.abort('connectionrefused') : route.continue()));
    await page.goto('/');
    await page.waitForTimeout(2500); // startup has failed at least once by now
    await expect(page.locator('#map path.leaflet-interactive')).toHaveCount(0);
    down = false;
    await expect(page.locator('#map path.leaflet-interactive').first()).toBeVisible({ timeout: 15000 });
    expect(errors).toEqual([]);
  });

  test('a dropped connection mid-claim says so, and trying again works', async ({ page, request }) => {
    const errors = watchErrors(page);
    const e = await newEmployee(request);
    const z = await createZone(request, fx.admin);
    await signInAs(page, e);
    let failNext = true;
    await page.route('**/api/claim', (route) => {
      if (failNext) { failNext = false; return route.abort('internetdisconnected'); }
      return route.continue();
    });
    await page.goto(`/?c=${z.secret}`);
    const modal = claimModal(page);
    await modal.getByRole('button', { name: 'Claim this zone' }).click();
    await expect(modal).toContainText('Network error. Try again.');
    await modal.getByRole('button', { name: 'Claim this zone' }).click();
    await expect(modal.locator('.success-text')).toContainText(`Claimed ${z.name}`);
    expect(errors).toEqual([]);
  });

  test('a server error during a claim shows a message, not a broken page', async ({ page, request }) => {
    const errors = watchErrors(page);
    const e = await newEmployee(request);
    const z = await createZone(request, fx.admin);
    await signInAs(page, e);
    await page.route('**/api/claim', (route) => route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Bad gateway</h1>' }));
    await page.goto(`/?c=${z.secret}`);
    const modal = claimModal(page);
    await modal.getByRole('button', { name: 'Claim this zone' }).click();
    await expect(modal.locator('.err')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Claim this zone' })).toBeEnabled(); // can retry
    expect(errors).toEqual([]);
  });

  test('double-tapping Claim sends one request', async ({ page, request }) => {
    const e = await newEmployee(request);
    const z = await createZone(request, fx.admin);
    await signInAs(page, e);
    let posts = 0;
    await page.route('**/api/claim', async (route) => { posts++; await new Promise((r) => setTimeout(r, 400)); await route.continue(); });
    await page.goto(`/?c=${z.secret}`);
    const btn = claimModal(page).getByRole('button', { name: 'Claim this zone' });
    await btn.dblclick();
    await btn.click({ force: true, timeout: 1000 }).catch(() => {});
    await expect(claimModal(page).locator('.success-text')).toContainText('Claimed');
    expect(posts).toBe(1);
  });

  for (const [label, saved] of [['corrupt JSON', '{bad'], ['a number', '5'], ['an empty object', '{}'], ['a token with no name', '{"token":"x"}']]) {
    test(`a saved sign-in that is ${label} doesn\u2019t break the page`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.addInitScript((v) => localStorage.setItem('care_employee', v), saved);
      await page.goto(`/?c=${fx.zones.alpha.secret}`);
      await expect(claimModal(page)).toContainText('open the personal link');
      await expect(page.locator('.employee-menu')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('with browser storage blocked, a personal link still signs in and claims', async ({ page, request }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      for (const m of ['getItem', 'setItem', 'removeItem']) {
        Storage.prototype[m] = () => { throw new DOMException('blocked', 'SecurityError'); };
      }
    });
    const e = await newEmployee(request);
    const z = await createZone(request, fx.admin);
    await page.goto(`/?g=${e.token}&c=${z.secret}`);
    await expect(page.locator('.employee-menu')).toContainText(e.name);
    await claimModal(page).getByRole('button', { name: 'Claim this zone' }).click();
    await expect(claimModal(page).locator('.success-text')).toContainText(`Claimed ${z.name} for ${e.name}`);
    expect(errors).toEqual([]);
  });

  test('an invalid personal link leaves the phone signed out and tidies the URL', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/?g=notARealToken123');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.employee-menu')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('negative scores read "\u2212N pts"', async ({ page, request }) => {
    const e = await newEmployee(request);
    await request.post(`/api/admin/employees/${e.id}/points`, { headers: H, data: { delta: -3 } });
    await page.goto('/');
    const tab = page.getByRole('button', { name: 'Leaderboard' });
    if (await tab.isVisible()) await tab.click();
    await expect(page.locator('.leaderboard li', { hasText: e.name }).locator('.points')).toHaveText('\u22123 pts');
  });
});

test.describe('On-site zones', () => {
  let zone;
  const SPOT = { latitude: 37.7705, longitude: -122.4495 };
  test.beforeAll(async ({ request }) => {
    zone = await createZone(request, fx.admin);
    const res = await request.put(`/api/admin/zones/${zone.id}`, {
      headers: H, data: { name: zone.name, hint: '', polygon: zone.polygon, requirePresence: true, presenceLat: SPOT.latitude, presenceLng: SPOT.longitude },
    });
    expect(res.status()).toBe(200);
  });

  async function claimAs(browser, request, contextOptions) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...contextOptions });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    const e = await newEmployee(request);
    await page.goto(`/?g=${e.token}&c=${zone.secret}`);
    await claimModal(page).getByRole('button', { name: 'Claim this zone' }).click();
    return { page, ctx, errors, modal: claimModal(page) };
  }

  test('location blocked: asks to turn it on', async ({ browser, request }) => {
    const { modal, errors, ctx } = await claimAs(browser, request, {});
    await expect(modal).toContainText('Turn on location access');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('1 km away: says how far, no claim', async ({ browser, request }) => {
    const { modal, errors, ctx } = await claimAs(browser, request, { permissions: ['geolocation'], geolocation: { latitude: SPOT.latitude + 0.009, longitude: SPOT.longitude, accuracy: 10 } });
    await expect(modal).toContainText(/about \d+m away/);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('on the spot: claims', async ({ browser, request }) => {
    const { modal, errors, ctx } = await claimAs(browser, request, { permissions: ['geolocation'], geolocation: { ...SPOT, accuracy: 10 } });
    await expect(modal.locator('.success-text')).toContainText(`Claimed ${zone.name}`);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test.describe('Hostile and oversized names', () => {
  test('HTML in names and hints shows as text everywhere, never runs', async ({ page, request }) => {
    const errors = watchErrors(page);
    const evil = `<img src=x onerror="window.__xss=1">`;
    const e = await newEmployee(request, evil.slice(0, 40));
    const z = await createZone(request, fx.admin, { name: `<b onmouseover=window.__xss=1>${uid()}`, hint: `${evil} [x](javascript:window.__xss=1) **ok**` });
    await request.post(`/api/admin/zones/${z.id}/claim`, { headers: H, data: { employeeId: e.id } });

    await page.goto(`/?g=${e.token}&c=${z.secret}`);
    await expect(claimModal(page)).toContainText('<b onmouseover');
    await page.keyboard.press('Escape');
    const tab = page.getByRole('button', { name: 'Leaderboard' });
    if (await tab.isVisible()) await tab.click();
    await expect(page.locator('.leaderboard')).toContainText('<img src=x');
    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('body')).toContainText('<b onmouseover');
    await page.locator('.leaflet-interactive').first().hover({ force: true }).catch(() => {});
    await page.getByRole('tab', { name: 'Employees' }).click();
    await expect(page.locator('.employee-list')).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('the longest allowed names fit a 320px-wide phone', async ({ browser, request }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, ignoreHTTPSErrors: true, hasTouch: true });
    const page = await ctx.newPage();
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const [ename, zname] of [
      ['Wolfeschlegelsteinhausenbergerdorff Jr.', 'The Extraordinarily Long Zone Name For Testing Wrapping Here'],
      ['W'.repeat(40), 'Z'.repeat(60)],
    ]) {
      const e = await newEmployee(request, ename);
      const z = await createZone(request, fx.admin, { name: zname });
      await request.post(`/api/admin/zones/${z.id}/claim`, { headers: H, data: { employeeId: e.id } });
      await page.goto(`/?g=${e.token}&c=${z.secret}`);
      await expect(claimModal(page)).toBeVisible();
      expect(await overflow(), `claim popup: ${ename}`).toBeLessThanOrEqual(0);
      const box = await claimModal(page).locator('#claimTitle').boundingBox();
      expect(box.x + box.width, 'claim title stays on screen').toBeLessThanOrEqual(320);
      await page.keyboard.press('Escape');
      expect(await overflow(), `map page: ${ename}`).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: 'Leaderboard' }).click();
      const row = page.locator('.leaderboard li', { hasText: ename.slice(0, 20) }).first();
      const rb = await row.locator('.points').boundingBox();
      expect(rb.x + rb.width, `leaderboard points stay on screen: ${ename}`).toBeLessThanOrEqual(320);
      expect(await overflow(), `leaderboard: ${ename}`).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: 'Map' }).click();
    }
    // A hint with a long URL wraps inside the hint popup instead of widening it.
    await page.goto('/');
    const zone = page.locator('#map path.leaflet-interactive').first();
    await zone.waitFor();
    const zb = await zone.boundingBox();
    await zone.click({ position: { x: zb.width * 0.25, y: zb.height * 0.25 }, force: true });
    const hint = page.locator('.popup-hint');
    await expect(hint).toBeVisible();
    await hint.evaluate((el) => { el.textContent = `See https://example.com/${'a'.repeat(200)}?x=${'b'.repeat(80)} for details`; });
    expect(await hint.evaluate((el) => el.scrollWidth - el.clientWidth), 'hint with a long URL').toBeLessThanOrEqual(0);
    expect(await overflow(), 'hint popup').toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');

    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('tab', { name: 'Employees' }).click();
    await expect(page.locator('.employee-list')).toContainText('W'.repeat(40));
    const plus = page.getByRole('button', { name: `Add a point for ${'W'.repeat(40)}` }).first();
    const pb = await plus.boundingBox();
    expect(pb.x + pb.width, 'admin stepper stays on screen').toBeLessThanOrEqual(320);
    await ctx.close();
  });
});

test.describe('Admin console left open all day', () => {
  test('keeps renewing its download token, so QR codes and exports keep working', async ({ page }) => {
    await page.clock.install();
    let tokenFetches = 0;
    page.on('request', (r) => { if (r.url().includes('/api/admin/token')) tokenFetches++; });
    await page.goto('/admin');
    await page.locator('#pw').fill(fx.admin);
    await page.getByRole('button', { name: 'Log in' }).click();
    const qr = page.locator('img.qr-thumb').first();
    await expect(qr).toBeVisible();
    const firstSrc = await qr.getAttribute('src');
    expect(tokenFetches).toBe(1);

    await page.clock.fastForward('01:01:00');
    await page.clock.runFor(16_000); // next 15s refresh notices the token is over an hour old
    await expect.poll(() => tokenFetches).toBeGreaterThanOrEqual(2);
    await expect(qr).not.toHaveAttribute('src', firstSrc);
    await expect.poll(() => qr.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  });
});
