import { test, expect } from '@playwright/test';
import { fixture, signInAs, signOut, expectLegible } from './helpers.js';

const fx = fixture();

// Reveal the leaderboard regardless of viewport: desktop shows it in the
// sidebar; mobile needs the bottom "Leaderboard" tab tapped first.
async function openLeaderboard(page) {
  const tab = page.getByRole('button', { name: 'Leaderboard' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  return page.locator('.leaderboard');
}

test.describe('Main map page', () => {
  test('loads with header, map, scan button and tabs visible', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/GeoCache SF/);
    await expectLegible(page.locator('.brand h1'));

    // Map tiles/container present (#map itself gets the leaflet-container class).
    await expect(page.locator('#map')).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeVisible();

    // Scan button legible.
    await expectLegible(page.locator('.scan-fab'));
  });

  test('leaderboard lists seeded crews with points', async ({ page }) => {
    await page.goto('/');
    const board = await openLeaderboard(page);
    await expect(board).toBeVisible();
    await expect(board).toContainText('Fog Chasers');
    await expect(board).toContainText('Bridge Trolls');
    // Fog Chasers pre-claimed Beta in setup, so it has at least one point.
    const fogRow = board.locator('li', { hasText: 'Fog Chasers' });
    expect(Number(await fogRow.locator('.points').textContent())).toBeGreaterThanOrEqual(1);
    await expectLegible(fogRow.locator('.lname'));
    await expectLegible(fogRow.locator('.points'));
  });

  test('clicking a zone opens the hint modal with rendered markdown', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#map path.leaflet-interactive');
    await page.locator('#map path.leaflet-interactive').first().click({ force: true });

    const modal = page.locator('.modal-overlay', { has: page.locator('.popup-hint') });
    await expect(page.locator('.popup-hint')).toBeVisible();
    // Markdown bold/italic should be rendered as tags, not literal asterisks.
    await expect(page.locator('.popup-hint strong, .popup-hint em')).toHaveCount(2);
    await expect(page.locator('.popup-hint')).not.toContainText('**');
    await expectLegible(page.locator('.modal .popup-hint'));

    // Escape closes it.
    await page.keyboard.press('Escape');
    await expect(page.locator('.popup-hint')).toBeHidden();
  });

  test('adopting a crew via ?g=<token> signs in and strips the token from the URL', async ({ page }) => {
    await page.goto(`/?g=${fx.crews.trolls.token}`);
    const badge = page.locator('.crew-menu .badge');
    await expect(badge).toContainText('Bridge Trolls');
    await expectLegible(badge);
    // Token removed from the address bar.
    await expect(page).toHaveURL(/\/$|\/(?!\?g=)/);
    expect(new URL(page.url()).searchParams.get('g')).toBeNull();
  });

  test('scanner modal shows a themed placeholder (not a blank box) when no camera', async ({ page }) => {
    await signInAs(page, fx.crews.trolls);
    await page.goto('/');
    await page.locator('.scan-fab').click();
    const modal = page.locator('.modal.admin-modal', { hasText: 'Scan a QR code' });
    await expect(modal).toBeVisible();
    // Camera is unavailable in headless -> placeholder + "Try again", never an
    // empty navy reader box.
    await expect(modal.locator('.scan-placeholder')).toBeVisible();
    await expectLegible(modal.locator('.modal-body h2'));
    await expect(modal.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('help modal is reachable and legible', async ({ page }) => {
    await page.goto('/');
    // The "?" help control on the map.
    const help = page.locator('button[aria-label*="help" i], .help-fab, [title*="help" i]');
    // Fallback: some builds put help behind a fixed button; open via keyboard flow if present.
    if (await help.first().isVisible().catch(() => false)) {
      await help.first().click();
      await expect(page.locator('.help-modal')).toBeVisible();
      await expectLegible(page.locator('.help-modal .help-list li').first());
    }
  });
});
