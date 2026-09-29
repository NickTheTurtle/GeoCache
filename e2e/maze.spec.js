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
    const say = page.locator('.say');
    await expect(say.locator('.who')).toHaveText('Flabber Geese:');
    await expect(say).toContainText('“Wow, you actually made it on time. I had very little faith in you.');
    await expect(say).toContainText('I disabled the lasers. Grab the target, then scram.”');
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
    await expect(page.locator('.io.in > span').first()).toHaveText('Entrance ↓');
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

test.describe('Heist countdown (CSS only)', () => {
  // The page has no scripts. JavaScript is on here only so the test can
  // fast-forward the CSS animations instead of waiting 5 real minutes.
  async function at(page, seconds) {
    await page.evaluate((ms) => {
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
    }, seconds * 1000);
  }
  // Read the digit each window actually shows, from its strip's computed offset.
  const shown = (page) =>
    page.evaluate(() => {
      const digit = (sel) => {
        const s = document.querySelector(sel);
        const cs = getComputedStyle(s);
        const ty = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform).m42;
        return s.textContent[Math.round(-ty / parseFloat(cs.lineHeight))];
      };
      return `${digit('.tm')}:${digit('.t10')}${digit('.t1')}`;
    });
  const red = (page) => page.locator('.t').evaluate((el) => getComputedStyle(el).color === 'rgb(178, 58, 58)');

  test('counts down from 5:00, turns red for the last minute, re-arms at 0:00', async ({ page }) => {
    await page.goto('/heist72');
    await expect(page.getByRole('timer')).toBeVisible();
    const pad = page.locator('.pad');
    const armed = page.locator('.armed');
    for (const [t, want] of [[0, '5:00'], [0.5, '5:00'], [1.5, '4:59'], [9.5, '4:51'], [10.5, '4:50'],
      [11.5, '4:49'], [59.5, '4:01'], [60.5, '4:00'], [61.5, '3:59'], [150.5, '2:30'], [239.5, '1:01']]) {
      await at(page, t);
      expect(await shown(page), `at ${t}s`).toBe(want);
    }
    expect(await red(page)).toBe(false);
    await at(page, 240.5);
    expect(await shown(page)).toBe('1:00');
    expect(await red(page)).toBe(true);

    await at(page, 299.5);
    expect(await shown(page)).toBe('0:01');
    await expect(pad.getByRole('link', { name: 'Right' })).toBeVisible();
    await expect(armed).toBeHidden();

    for (const t of [300.5, 400]) {
      await at(page, t);
      expect(await shown(page), `at ${t}s`).toBe('0:00');
      for (const name of ['Up', 'Down', 'Left', 'Right']) await expect(pad.getByRole('link', { name })).toBeHidden();
      await expect(armed).toBeVisible();
      await expect(armed).toContainText('Lasers re-armed!');
    }
  });

  test('the clock stops once the target is acquired', async ({ page }) => {
    await page.goto('/heist72');
    const state = () => page.locator('.t1').evaluate((el) => getComputedStyle(el).animationPlayState);
    expect(await state()).toBe('running');
    await page.goto(`/heist72#${maze.codes.id[maze.exit]}`);
    await expect(page.locator('.win')).toBeVisible();
    expect(await state()).toBe('paused');
  });
});
