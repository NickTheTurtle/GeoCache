// Render the logo sources into every derived icon/logo file:
//   static/favicon.ico           16/32/48px PNGs (older browsers, /favicon.ico)
//   static/apple-touch-icon.png  180px, square corners (iOS rounds them itself)
//   brand/care-logo.svg + -1024.png    rabbit on the navy tile (any background)
//   brand/care-rabbit.svg + -1024.png  rabbit alone, transparent (dark backgrounds)
// Sources: static/favicon.svg (tile logo) and src/lib/BrandIcon.svelte (rabbit).
// Run after editing either: `npm run gen-icons`. Uses the same Edge install as
// the e2e tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = path.join(root, 'static');
const brandDir = path.join(root, 'brand');
const svg = fs.readFileSync(path.join(staticDir, 'favicon.svg'), 'utf8');

// Standalone SVG file from the header component's markup.
function rabbitSvg() {
  const source = fs.readFileSync(path.join(root, 'src', 'lib', 'BrandIcon.svelte'), 'utf8');
  const markup = source.slice(source.indexOf('<svg'));
  const viewBox = /viewBox="([^"]+)"/.exec(markup)[1];
  return markup
    .replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`)
    .replace(/ \/>/g, '/>');
}

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

fs.mkdirSync(brandDir, { recursive: true });
const rabbit = rabbitSvg();
fs.writeFileSync(path.join(brandDir, 'care-logo.svg'), svg);
fs.writeFileSync(path.join(brandDir, 'care-logo-1024.png'), await render(page, svg, 1024));
fs.writeFileSync(path.join(brandDir, 'care-rabbit.svg'), rabbit);
fs.writeFileSync(path.join(brandDir, 'care-rabbit-1024.png'), await render(page, rabbit, 1024));
await browser.close();
console.log('Wrote static/favicon.ico, static/apple-touch-icon.png and brand/*');
