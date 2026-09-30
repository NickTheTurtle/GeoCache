import { test, expect } from '@playwright/test';
import { fixture, signInAs, signOut, expectLegible, createZone } from './helpers.js';

const fx = fixture();

// A per-run zone so the claim/re-visit pair stays isolated across projects
// (each project run claims its own fresh zone instead of the shared seed data).
let freshZone;
test.beforeAll(async ({ request }) => {
  freshZone = await createZone(request, fx.admin, { hint: 'Fresh claim target.' });
});

const claimModal = (page) => page.locator('.modal.admin-modal', { has: page.locator('.modal-body') }).last();

async function openLeaderboard(page) {
  const tab = page.getByRole('button', { name: 'Leaderboard' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  return page.locator('.leaderboard');
}

test.describe('Claim modal (opened from a QR link /?c=<secret>)', () => {
  test('signed-out visitor sees a legible sign-in prompt', async ({ page }) => {
    await signOut(page);
    await page.goto(`/?c=${fx.zones.alpha.secret}`);
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Alpha Cache');
    await expect(modal).toContainText('open the personal link');
    await expectLegible(modal.locator('.modal-body h2'));
    await expectLegible(modal.locator('.modal-body p').first());
  });

  test('invalid secret shows an error state', async ({ page }) => {
    await signInAs(page, fx.employees.trolls);
    await page.goto('/?c=deadbeefdeadbeef00');
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.locator('.err')).toBeVisible();
    await expectLegible(modal.locator('.err'));
  });

  test('employee that already claimed sees the "already claimed" celebration', async ({ page }) => {
    await signInAs(page, fx.employees.fog); // fog pre-claimed Beta in setup
    await page.goto(`/?c=${fx.zones.beta.secret}`);
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Beta Cache');
    await expect(modal).toContainText('already claimed');
    // Celebration check mark svg present and both action buttons legible.
    await expect(modal.locator('svg.success-check')).toBeVisible();
    await expectLegible(modal.getByRole('button', { name: 'See leaderboard' }));
    await expectLegible(modal.locator('.success-actions').getByRole('button', { name: 'Close' }));
  });

  test('signed-in employee can claim an unclaimed zone and earn a point', async ({ page }) => {
    await signInAs(page, fx.employees.trolls);
    await page.goto(`/?c=${freshZone.secret}`);
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(freshZone.name);

    const claimBtn = modal.getByRole('button', { name: 'Claim this zone' });
    await expectLegible(claimBtn);
    await claimBtn.click();

    // Celebration confirming the claim.
    await expect(modal).toContainText(`Claimed ${freshZone.name}`);
    await expect(modal).toContainText('Bridge Trolls');
    await expectLegible(modal.locator('.success-text, .modal-body h2').first());
    await expect(modal.locator('.success-text')).toHaveText(/pts(\. First to solve!|\.)$/); // no "!."

    // Leaderboard should now credit Bridge Trolls with at least one point.
    await modal.getByRole('button', { name: 'See leaderboard' }).click();
    const board = await openLeaderboard(page);
    await expect(board).toContainText('Bridge Trolls');
    const trollsRow = board.locator('li', { hasText: 'Bridge Trolls' });
    expect(parseInt(await trollsRow.locator('.points').textContent(), 10)).toBeGreaterThanOrEqual(1);
  });

  test('re-visiting an already-claimed zone shows the already state (no double claim)', async ({ page }) => {
    await signInAs(page, fx.employees.trolls); // trolls claimed freshZone in the previous test
    await page.goto(`/?c=${freshZone.secret}`);
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('already claimed');
  });

  test('closing the modal strips ?c= from the URL', async ({ page }) => {
    await signInAs(page, fx.employees.trolls);
    await page.goto(`/?c=${fx.zones.beta.secret}`);
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await modal.locator('.modal-close').click();
    await expect(modal).toBeHidden();
    expect(new URL(page.url()).searchParams.get('c')).toBeNull();
  });

  test('Escape key closes the claim modal', async ({ page }) => {
    await signInAs(page, fx.employees.trolls);
    // Hold the page mid-startup (it loads the leaderboard last) so Escape is
    // pressed before loading finishes, as on a slow connection.
    await page.route('**/api/leaderboard', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.continue().catch(() => {});
    });
    await page.goto(`/?c=${fx.zones.beta.secret}`);
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden({ timeout: 2000 });
  });
});

test.describe('A phone whose employee was removed', () => {
  // 4 phones share one personal link; an admin deleting that employee (or resetting
  // the game) must sign all of them out, not leave them offering claims that fail.
  test('signs itself out and asks for a personal link instead of failing a claim', async ({ page, request }) => {
    const H = { 'x-admin-password': fx.admin };
    const emp = await (await request.post('/api/employees', { headers: H, data: { name: `Gone ${Date.now()}` } })).json();
    await page.goto(`/?g=${emp.token}`);
    await expect(page.locator('.employee-menu')).toContainText(emp.name);

    // Deleted while this phone has the claim popup open, ready to claim.
    await page.goto(`/?c=${freshZone.secret}`);
    const modal = claimModal(page);
    const claimBtn = modal.getByRole('button', { name: 'Claim this zone' });
    await expect(claimBtn).toBeVisible();
    await request.delete(`/api/admin/employees/${emp.id}`, { headers: H });
    await claimBtn.click();
    await expect(modal).toContainText('open the personal link');
    await expect(page.locator('.employee-menu')).toHaveCount(0);

    // Opening the app again later: signed out straight away.
    await page.goto(`/?c=${fx.zones.alpha.secret}`);
    await expect(claimModal(page)).toContainText('open the personal link');
  });
});
