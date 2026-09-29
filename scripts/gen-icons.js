// Render static/favicon.svg into the raster icons browsers and phones expect:
//   static/favicon.ico           16/32/48px PNGs (older browsers, /favicon.ico)
//   static/apple-touch-icon.png  180px, square corners (iOS rounds them itself)
// Run after editing favicon.svg: `npm run gen-icons`. Uses the same Edge
// install as the e2e tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static');
const svg = fs.readFileSync(path.join(staticDir, 'favicon.svg'), 'utf8');

async function render(page, markup, size) {
  await page.setViewportSize({ width: size, height: size });
  const url = `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`;
  await page.setContent(`<style>*{margin:0}img{display:block}</style><img src="${url}" width="${size}" height="${size}">`);
  await page.locator('img').evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: true });
}

// ICO container holding PNG images (supported by every current browser and OS).
function toIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); // color planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
const pngs = [];
for (const size of [16, 32, 48]) pngs.push({ size, data: await render(page, svg, size) });
fs.writeFileSync(path.join(staticDir, 'favicon.ico'), toIco(pngs));
const square = svg.replace(/ rx="\d+(\.\d+)?"/, '');
fs.writeFileSync(path.join(staticDir, 'apple-touch-icon.png'), await render(page, square, 180));
await browser.close();
console.log('Wrote static/favicon.ico and static/apple-touch-icon.png');
