import { test, expect } from '@playwright/test';
import { buildMaze } from '../src/lib/server/maze.js';
import { MAZE_ENV } from '../playwright.config.js';

// Mirror the server's env-configured maze so the test knows the solution.
const [w, h] = MAZE_ENV.MAZE_SIZE.split('x').map(Number);
const maze = buildMaze({ word: MAZE_ENV.MAZE_WORD, seed: MAZE_ENV.MAZE_SEED, w, h });
const DIRS = { [-w]: 'Up', [w]: 'Down', [-1]: 'Left', [1]: 'Right' };
const OPEN = { 1: 'Up', 2: 'Right', 4: 'Down', 8: 'Left' };
const arrow = (page, name) => page.locator('.pad').getByRole('link', { name, exact: true });
const atCell = (page, i) => expect(page).toHaveURL(new RegExp(`#c${i}$`));

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

  test('letters are printed on the board and no instructions are shown', async ({ page }) => {
    await page.goto('/maze');
    for (const [i, letter] of maze.letters) await expect(page.locator(`.c${i}`)).toHaveText(letter);
    await expect(page.locator('ul, .intro')).toHaveCount(0);
  });

  test('arrow pad walks the true path, respects walls, and escapes', async ({ page }) => {
    await page.goto('/maze');
    const win = page.locator('.win');
    const startY = await page.evaluate(() => window.scrollY);
    await expect(win).toBeHidden();
    await expectArrowsFor(page, maze.start);

    for (let k = 1; k < maze.path.length; k++) {
      const [from, to] = [maze.path[k - 1], maze.path[k]];
      await arrow(page, DIRS[to - from]).click();
      await atCell(page, to);
      await expectArrowsFor(page, to);
    }
    await expect(win).toBeVisible();
    await expect(win).toHaveText('You escaped!');
    // Moving must not make the page jump around.
    expect(await page.evaluate(() => window.scrollY)).toBe(startY);

    // Back undoes a move.
    await page.goBack();
    await atCell(page, maze.path.at(-2));
    await expect(win).toBeHidden();

    await page.getByRole('link', { name: 'Start over' }).click();
    await expectArrowsFor(page, maze.start);
    await expect(win).toBeHidden();
  });
});
