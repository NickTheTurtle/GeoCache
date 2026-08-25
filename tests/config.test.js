import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validPolygon,
  pointInSF,
  decodeImage,
  isAdmin,
  makeAdminToken,
  haversineMeters,
} from '../src/lib/server/config.js';

const SF_TRIANGLE = [
  [37.77, -122.45],
  [37.771, -122.45],
  [37.771, -122.449],
];

test('pointInSF accepts points inside the bounds and rejects those outside', () => {
  assert.equal(pointInSF(37.77, -122.45), true);
  assert.equal(pointInSF(40.0, -122.45), false); // too far north
  assert.equal(pointInSF(37.77, -100.0), false); // too far east
});

test('validPolygon accepts a valid SF polygon', () => {
  assert.equal(validPolygon(SF_TRIANGLE), true);
});

test('validPolygon rejects malformed polygons', () => {
  assert.equal(validPolygon(null), false);
  assert.equal(validPolygon('nope'), false);
  assert.equal(validPolygon([[37.77, -122.45], [37.771, -122.45]]), false); // < 3 points
  assert.equal(validPolygon([[37.77, -122.45, 1], [37.771, -122.45], [37.771, -122.449]]), false); // wrong arity
  assert.equal(validPolygon([[NaN, -122.45], [37.771, -122.45], [37.771, -122.449]]), false); // non-finite
});

test('validPolygon rejects polygons with a point outside San Francisco', () => {
  const outside = [[37.77, -122.45], [37.771, -122.45], [40.0, -122.449]];
  assert.equal(validPolygon(outside), false);
});

test('decodeImage returns null for empty input', () => {
  assert.equal(decodeImage(''), null);
  assert.equal(decodeImage(undefined), null);
  assert.equal(decodeImage(null), null);
});

test('decodeImage decodes a valid image data URL', () => {
  const out = decodeImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  assert.ok(out);
  assert.equal(out.imageType, 'image/png');
  assert.ok(Buffer.isBuffer(out.image));
  assert.ok(out.image.length > 0);
});

test('decodeImage lower-cases the mime type', () => {
  const out = decodeImage('data:IMAGE/JPEG;base64,/9j/4AAQSkZJRg==');
  assert.equal(out.imageType, 'image/jpeg');
});

test('decodeImage rejects malformed, non-image, and oversize input', () => {
  assert.throws(() => decodeImage('not-a-data-url'));
  assert.throws(() => decodeImage('data:text/plain;base64,aGVsbG8=')); // not an image
  const huge = 'data:image/png;base64,' + Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64');
  assert.throws(() => decodeImage(huge)); // > 4MB
});

test('decodeImage rejects SVG (stored-XSS vector)', () => {
  assert.throws(() =>
    decodeImage('data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'))
  );
});

const fakeReq = (pw) => ({ headers: { get: (k) => (k === 'x-admin-password' ? pw ?? null : null) } });
const fakeUrl = (qs = '') => new URL(`https://x/${qs}`);

test('isAdmin accepts the password via header, rejects wrong ones and ?pw=', () => {
  assert.equal(isAdmin(fakeReq('changeme'), fakeUrl()), true);
  assert.equal(isAdmin(fakeReq('nope'), fakeUrl()), false);
  // ?pw= is no longer accepted (passwords must not travel in URLs).
  assert.equal(isAdmin(fakeReq(), fakeUrl('?pw=changeme')), false);
});

test('makeAdminToken mints a token isAdmin accepts via ?t=; tampering is rejected', () => {
  const tok = makeAdminToken();
  assert.equal(isAdmin(fakeReq(), fakeUrl(`?t=${encodeURIComponent(tok)}`)), true);
  assert.equal(isAdmin(fakeReq(), fakeUrl('?t=123.deadbeef')), false);
  assert.equal(isAdmin(fakeReq(), fakeUrl('?t=garbage')), false);
});

test('makeAdminToken tokens expire', () => {
  const expired = makeAdminToken(-1000); // already in the past
  assert.equal(isAdmin(fakeReq(), fakeUrl(`?t=${encodeURIComponent(expired)}`)), false);
});

test('haversineMeters returns ~0 for identical points', () => {
  assert.ok(haversineMeters(37.765, -122.445, 37.765, -122.445) < 0.001);
});

test('haversineMeters measures a short east offset (~88m at SF latitude)', () => {
  // 0.001 deg of longitude ≈ 88m at ~37.76°N.
  const d = haversineMeters(37.765, -122.445, 37.765, -122.444);
  assert.ok(d > 80 && d < 95, `expected ~88m, got ${d}`);
});

test('haversineMeters measures a north offset (~111m per 0.001 deg lat)', () => {
  const d = haversineMeters(37.765, -122.445, 37.766, -122.445);
  assert.ok(d > 105 && d < 118, `expected ~111m, got ${d}`);
});

test('haversineMeters grows for far-apart points', () => {
  assert.ok(haversineMeters(37.70, -122.40, 37.765, -122.445) > 1000);
});
