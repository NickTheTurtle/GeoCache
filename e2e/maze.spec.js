import { test, expect } from '@playwright/test';
import { buildMaze, passages } from '../src/lib/server/maze.js';
import { MAZE_ENV } from '../playwright.config.js';

// Mirror the server's env-configured maze so the test knows the solution.
const [w, h] = MAZE_ENV.MAZE_SIZE.split('x').map(Number);
const maze = buildMaze({ word: MAZE_ENV.MAZE_WORD, seed: MAZE_ENV.MAZE_SEED, w, h });
const cell = (page, i) => page.locator(`.c${i}`);
const link = (page, i) => page.locator(`a[href="#c${i}"]`);
const atCell = (page, i) => expect(page).toHaveURL(new RegExp(`#c${i}$`));

// Walk the true path with `step`, collecting the letters revealed on the way.
async function walk(page, step) {
  let spelled = '';
  for (const i of maze.path) {
    await step(i);
    await atCell(page, i);
    if (maze.letters.has(i)) {
      const letter = cell(page, i).locator('b');
      await expect(letter).toBeVisible();
      spelled += await letter.textContent();
    }
  }
  return spelled;
}

test.describe('Maze (JavaScript disabled)', () => {
  test.use({ javaScriptEnabled: false });

  test('mouse: walk the true path, collect letters, escape', async ({ page }) => {
    await page.goto('/maze');
    const win = page.locator('.win');
    await expect(win).toBeHidden();

    // Before entering, only the entrance square is clickable.
    await expect(link(page, 0)).toBeVisible();
    await expect(link(page, maze.path[1])).toBeHidden();

    await link(page, 0).click();
    await atCell(page, 0);

    // Squares walled off from the current one are not clickable.
    const blocked = [...Array(w * h).keys()].find(
      (i) => i !== 0 && !passages(maze.open, 0, w, h).includes(i)
    );
    await expect(link(page, blocked)).toBeHidden();

    const spelled = await walk(page, (i) => (i === 0 ? null : link(page, i).click()));
    expect(spelled).toBe(maze.word);
    await expect(win).toBeVisible();

    // Back undoes a move, and letters hide again once you step off them.
    await page.goBack();
    await atCell(page, maze.path.at(-2));
    await expect(win).toBeHidden();
    const firstLetter = maze.path.find((i) => maze.letters.has(i));
    await expect(cell(page, firstLetter).locator('b')).toBeHidden();

    await page.getByRole('link', { name: 'Start over' }).click();
    await expect(link(page, 0)).toBeVisible();
    await expect(win).toBeHidden();
  });

  test('keyboard: Tab reaches only open neighbours, Enter steps', async ({ page }) => {
    await page.goto('/maze');
    const startY = await page.evaluate(() => window.scrollY);

    const spelled = await walk(page, async (i) => {
      const allowed = new Set(
        i === 0 ? [] : passages(maze.open, maze.path[maze.path.indexOf(i) - 1], w, h).map((j) => `#c${j}`)
      );
      for (let tries = 0; tries < 12; tries++) {
        await page.keyboard.press('Tab');
        const href = await page.locator(':focus').getAttribute('href').catch(() => null);
        if (href === `#c${i}`) return page.keyboard.press('Enter');
        // Any other maze square reached by Tab must be an open neighbour.
        if (href?.startsWith('#c') && i !== 0) expect(allowed.has(href)).toBe(true);
      }
      throw new Error(`Could not Tab to square ${i}`);
    });
    expect(spelled).toBe(maze.word);
    await expect(page.locator('.win')).toBeVisible();
    // Moving must not make the page jump around.
    expect(await page.evaluate(() => window.scrollY)).toBe(startY);
  });
});
