import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { buildMaze, slideTarget } from '../src/lib/server/maze.js';
import { MAZE_ENV } from '../playwright.config.js';

// Mirror the server's env-configured maze so the test knows the solution.
const [w, h] = MAZE_ENV.MAZE_SIZE.split('x').map(Number);
const maze = buildMaze({ seed: MAZE_ENV.MAZE_SEED, w, h });
const DIRS = { [-w]: [1, 'Up'], [w]: [4, 'Down'], [-1]: [8, 'Left'], [1]: [2, 'Right'] };
const OPEN = { 1: 'Up', 2: 'Right', 4: 'Down', 8: 'Left' };
const arrow = (page, name) => page.locator('.pad').getByRole('link', { name, exact: true });
const atCell = (page, i) => expect(page).toHaveURL(new RegExp(`#${maze.codes.id[i]}$`));

// Only the arrows for open sides of cell i should be usable.
async function expectArrowsFor(page, i) {
  for (const [bit, name] of Object.entries(OPEN)) {
    const a = arrow(page, name);
    if (maze.open[i] & Number(bit)) await expect(a).toBeVisible();
    else await expect(a).toHaveCount(0);
  }
}

test.describe('Maze (JavaScript disabled)', () => {
  test.use({ javaScriptEnabled: false });

  test('board has no letters or instructions, and the picture starts hidden', async ({ page }) => {
    const res = await page.goto('/heist72');
    expect(res.headers()['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers()['content-type']).toBe('text/html; charset=utf-8');
    await expect(page.locator('.g')).toHaveText('');
    await expect(page.locator('ul, .intro')).toHaveCount(0);
    await expect(page.locator('.win img')).toBeHidden();
  });

  test('guessing the old sequential square numbers does nothing', async ({ page }) => {
    await page.goto(`/heist72#c${maze.exit}`);
    await expect(page.locator('.win')).toBeHidden();
    await expectArrowsFor(page, maze.start); // still standing at the entrance
  });

  test('arrow pad slides along the true path, respects walls, and reveals the picture', async ({ page }) => {
    await page.goto('/heist72');
    const win = page.locator('.win');
    const startY = await page.evaluate(() => window.scrollY);
    await expectArrowsFor(page, maze.start);

    let k = 0;
    const visited = [];
    while (maze.path[k] !== maze.exit) {
      const from = maze.path[k];
      const [dir, name] = DIRS[maze.path[k + 1] - from];
      await arrow(page, name).click();
      const to = slideTarget(maze.open, from, dir, w);
      k = maze.path.indexOf(to);
      expect(k, 'a slide along the true path stays on it').toBeGreaterThan(0);
      await atCell(page, to);
      if (to !== maze.exit) await expectArrowsFor(page, to);
      visited.push(to);
    }
    expect(visited.length).toBeLessThan(maze.path.length - 1); // corridors took one press
    await expect(page.locator('.pad')).toBeHidden(); // the picture takes the pad's place
    await expect(win).toBeVisible();
    await expect(win).toContainText('Target acquired!');
    await expect(page).toHaveTitle('The Heist');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Heist');
    await expect(page.locator('.io.in')).toHaveText('Entrance ↓');
    await expect(page.locator('.io.out')).toHaveText('↓ Target');
    const img = win.locator('img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
    // The prize is the repo's QR code, embedded byte-for-byte.
    const prize = readFileSync(new URL('../assets/maze-prize.png', import.meta.url)).toString('base64');
    expect(await img.getAttribute('src')).toBe(`data:image/png;base64,${prize}`);
    // Moving must not make the page jump around.
    expect(await page.evaluate(() => window.scrollY)).toBe(startY);

    // Back undoes a move.
    await page.goBack();
    await atCell(page, visited.at(-2));
    await expect(win).toBeHidden();
    await expectArrowsFor(page, visited.at(-2));

    await page.getByRole('link', { name: 'Start over' }).click();
    await expectArrowsFor(page, maze.start);
    await expect(win).toBeHidden();
  });
});
