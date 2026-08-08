import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function fixture() {
  return JSON.parse(readFileSync(path.join(__dirname, '.fixture.json'), 'utf8'));
}

// Create a fresh zone via the admin API using Playwright's request context
// (which already trusts the self-signed cert). Used to keep claim tests
// isolated so re-runs across projects don't collide on shared server state.
export async function createZone(request, admin, overrides = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  const lat = 37.74 + Math.random() * 0.05;
  const lng = -122.47 + Math.random() * 0.05;
  const res = await request.post('/api/admin/zones', {
    headers: { 'x-admin-password': admin },
    data: {
      name: overrides.name || `Fresh Zone ${n}`,
      hint: overrides.hint || 'A one-off zone for testing.',
      polygon: [
        [lat, lng],
        [lat + 0.004, lng],
        [lat + 0.004, lng + 0.004],
      ],
    },
  });
  if (!res.ok()) throw new Error(`createZone failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

// Sign a crew in the way the app does: seed localStorage on the app origin.
// Must be called after an initial navigation so the origin exists.
export async function signInAs(page, crew) {
  await page.addInitScript((c) => {
    localStorage.setItem('geocache_group', JSON.stringify({ id: c.id, name: c.name, token: c.token }));
  }, crew);
}

export async function signOut(page) {
  await page.addInitScript(() => localStorage.removeItem('geocache_group'));
}

// Parse "rgb(a)" / "rgba" into [r,g,b,a].
function relLuminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(fg, bg) {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// Composite a possibly-translucent src [r,g,b,a] over an opaque dst [r,g,b].
function over(src, dst) {
  const a = src[3];
  return [
    src[0] * a + dst[0] * (1 - a),
    src[1] * a + dst[1] * (1 - a),
    src[2] * a + dst[2] * (1 - a),
  ];
}

// Assert an element is truly visible AND its text is legible against its
// effective background. Correctly composites translucent backgrounds (e.g. a
// frosted badge over a navy bar) so it doesn't false-positive. Catches the
// class of bug where text color blends into its card (invisible text).
export async function expectLegible(locator, minRatio = 3) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, 'element should have a bounding box').not.toBeNull();
  expect(box.width, 'element width > 0').toBeGreaterThan(0);
  expect(box.height, 'element height > 0').toBeGreaterThan(0);

  const info = await locator.evaluate((el) => {
    const parse = (str) => {
      const m = String(str).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((s) => parseFloat(s.trim()));
      return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
    };
    // Collect background layers from the element up to the root.
    const layers = [];
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c[3] > 0) layers.push(c);
      node = node.parentElement;
    }
    return {
      color: parse(getComputedStyle(el).color),
      layers, // element-first ... root-last
      text: (el.textContent || '').trim(),
    };
  });

  if (!info.color || info.text.length === 0) return;

  // Composite background layers over an assumed white page base, root-first.
  let bg = [255, 255, 255];
  for (const layer of info.layers.reverse()) bg = over(layer, bg);
  // Composite the (possibly translucent) text color over that background.
  const fg = over(info.color, bg);

  const ratio = contrastRatio(fg, bg);
  expect(
    ratio,
    `text "${info.text.slice(0, 40)}" contrast ${ratio.toFixed(2)} (color=rgba(${info.color}) effBg=rgb(${bg.map((n) => Math.round(n))})) should be >= ${minRatio}`
  ).toBeGreaterThanOrEqual(minRatio);
}
