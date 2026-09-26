import { test, expect } from '@playwright/test';
import { buildMaze, passages } from '../src/lib/server/maze.js';
import { MAZE_ENV } from '../playwright.config.js';

// Mirror the server's env-configured maze so the test knows the solution.
const [w, h] = MAZE_ENV.MAZE_SIZE.split('x').map(Number);
const maze = buildMaze({ word: MAZE_ENV.MAZE_WORD, seed: MAZE_ENV.MAZE_SEED, w, h });
const cell = (page, i) => page.locator(`label[for="c${i}"]`);

test.describe('Maze', () => {
  test('works with JavaScript disabled: walk the true path, collect letters, escape', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto('/maze');

    const win = page.locator('.win');
    await expect(win).toBeHidden();

    // A cell that is walled off from the start can't be clicked.
    const blocked = [...Array(w * h).keys()].find(
      (i) => i !== 0 && !passages(maze.open, 0, w, h).includes(i)
    );
    await cell(page, blocked).click({ force: true });
    await expect(page.locator('#c0')).toBeChecked();

    let spelled = '';
    for (const i of maze.path.slice(1)) {
      await cell(page, i).click();
      await expect(page.locator(`#c${i}`)).toBeChecked();
      if (maze.letters.has(i)) {
        const letter = cell(page, i).locator('b');
        await expect(letter).toBeVisible();
        spelled += await letter.textContent();
      }
    }
    expect(spelled).toBe(maze.word);
    await expect(win).toBeVisible();

    // Letters hide again once you step off them.
    const lastLetter = maze.path.filter((i) => maze.letters.has(i)).at(-1);
    await expect(cell(page, lastLetter).locator('b')).toBeHidden();

    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.locator('#c0')).toBeChecked();
    await expect(win).toBeHidden();
    await ctx.close();
  });
});
