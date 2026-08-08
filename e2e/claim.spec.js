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
    await signInAs(page, fx.crews.trolls);
    await page.goto('/?c=deadbeefdeadbeef00');
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.locator('.err')).toBeVisible();
    await expectLegible(modal.locator('.err'));
  });

  test('crew that already claimed sees the "already claimed" celebration', async ({ page }) => {
    await signInAs(page, fx.crews.fog); // fog pre-claimed Beta in setup
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

  test('signed-in crew can claim an unclaimed zone and earn a point', async ({ page }) => {
    await signInAs(page, fx.crews.trolls);
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

    // Leaderboard should now credit Bridge Trolls with at least one point.
    await modal.getByRole('button', { name: 'See leaderboard' }).click();
    const board = await openLeaderboard(page);
    await expect(board).toContainText('Bridge Trolls');
    const trollsRow = board.locator('li', { hasText: 'Bridge Trolls' });
    expect(Number(await trollsRow.locator('.points').textContent())).toBeGreaterThanOrEqual(1);
  });

  test('re-visiting an already-claimed zone shows the already state (no double claim)', async ({ page }) => {
    await signInAs(page, fx.crews.trolls); // trolls claimed freshZone in the previous test
    await page.goto(`/?c=${freshZone.secret}`);
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('already claimed');
  });

  test('closing the modal strips ?c= from the URL', async ({ page }) => {
    await signInAs(page, fx.crews.trolls);
    await page.goto(`/?c=${fx.zones.beta.secret}`);
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await modal.locator('.modal-close').click();
    await expect(modal).toBeHidden();
    expect(new URL(page.url()).searchParams.get('c')).toBeNull();
  });

  test('Escape key closes the claim modal', async ({ page }) => {
    await signInAs(page, fx.crews.trolls);
    await page.goto(`/?c=${fx.zones.beta.secret}`);
    const modal = claimModal(page);
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });
});

test.describe('Old /claim links', () => {
  test('/claim?c=<secret> redirects to /?c=<secret> and pops the modal', async ({ page }) => {
    await signInAs(page, fx.crews.trolls);
    await page.goto(`/claim?c=${fx.zones.beta.secret}`);
    await expect(page).toHaveURL(new RegExp(`/\\?c=${fx.zones.beta.secret}`));
    await expect(claimModal(page)).toBeVisible();
  });

  test('/claim with no secret redirects to the map', async ({ page }) => {
    await page.goto('/claim');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#map')).toBeVisible();
  });
});
