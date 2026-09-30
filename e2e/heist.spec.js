import { test, expect } from '@playwright/test';

test.describe('Heist note (JavaScript disabled)', () => {
  test.use({ javaScriptEnabled: false });

  for (const path of ['/heist', '/heist72']) {
    test(`${path} shows the note, not the maze`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers()['cache-control']).toBe('public, max-age=60');

      await expect(page).toHaveTitle('The Heist');
      const note = page.locator('article.note');
      await expect(note).toBeVisible();
      await expect(note.locator('.to')).toHaveText('Dear idiots,');
      await expect(note).toContainText('I TOLD you to be on time.');
      await expect(note).toContainText('Use that machine and come back here ON TIME.');
      await expect(note.locator('.sig')).toContainText('Flabber Gast');
      await expect(note.locator('.sig')).toContainText('September 28th');

      // None of the maze is left on the live page.
      await expect(page.locator('.pad, .g, .win, .say, img, [role="timer"]')).toHaveCount(0);
      expect(await page.content()).not.toMatch(/Claim Reward|Target acquired|Flabber Geese|data:image/);
    });
  }
});
