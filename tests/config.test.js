import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validPolygon,
  validSecret,
  parseZone,
  ZONE_LIMITS,
  pointInSF,
  decodeImage,
  isAdmin,
  checkPassword,
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

const fakeReq = (pw, method = 'GET') => ({ method, headers: { get: (k) => (k === 'x-admin-password' ? pw ?? null : null) } });
const fakeUrl = (qs = '') => new URL(`https://x/${qs}`);

test('checkPassword accepts only the exact admin password', () => {
  assert.equal(checkPassword('changeme'), true);
  for (const bad of ['changem', 'changeme ', 'CHANGEME', '', null, undefined, 'x'.repeat(1000)]) {
    assert.equal(checkPassword(bad), false, JSON.stringify(bad));
  }
});

test('isAdmin accepts the password via header, rejects wrong ones and ?pw=', () => {
  assert.equal(isAdmin(fakeReq('changeme'), fakeUrl()), true);
  assert.equal(isAdmin(fakeReq('changeme', 'DELETE'), fakeUrl()), true);
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

test('?t= tokens only work for read-only GET requests, never for changes', () => {
  const t = fakeUrl(`?t=${encodeURIComponent(makeAdminToken())}`);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isAdmin(fakeReq(undefined, method), t), false, method);
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

test('validSecret accepts generated and hand-made URL-safe secrets, and nothing else', () => {
  for (const ok of ['XQJCGx_vUTJF-6Ec', 'abcdefgh', 'A'.repeat(64), 'zone_1-final']) {
    assert.equal(validSecret(ok), true, ok);
  }
  for (const bad of ['short7c', 'A'.repeat(65), 'has space1', 'slash/aaaa', 'plus+aaaa', 'q?c=aaaaa', 'ünïcödeAA', '', null, undefined, 12345678, {}]) {
    assert.equal(validSecret(bad), false, JSON.stringify(bad));
  }
});

test('parseZone normalizes a valid zone and enforces the server-side limits', () => {
  const ok = parseZone({ name: '  Windmill ', hint: ' look up ', polygon: SF_TRIANGLE });
  assert.deepEqual(ok, { name: 'Windmill', hint: 'look up', polygon: SF_TRIANGLE, requirePresence: false, presenceLat: null, presenceLng: null, image: undefined, imageType: undefined });
  const onSite = parseZone({ name: 'Spot', polygon: SF_TRIANGLE, requirePresence: true, presenceLat: 37.7705, presenceLng: -122.4495 });
  assert.deepEqual([onSite.requirePresence, onSite.presenceLat, onSite.presenceLng], [true, 37.7705, -122.4495]);

  const rejects = (body, re) => assert.throws(() => parseZone(body), (e) => e.status === 400 && re.test(e.body.message));
  rejects(null, /Zone name is required/);
  rejects({ name: '   ', polygon: SF_TRIANGLE }, /Zone name is required/);
  rejects({ name: 'x'.repeat(ZONE_LIMITS.name + 1), polygon: SF_TRIANGLE }, /60 characters or fewer/);
  rejects({ name: 'Ok', hint: 'x'.repeat(ZONE_LIMITS.hint + 1), polygon: SF_TRIANGLE }, /Hint must be 5000 characters or fewer/);
  rejects({ name: 'Ok', polygon: [[37.77, -122.45]] }, /3\+ points inside San Francisco/);
  const many = Array.from({ length: ZONE_LIMITS.points + 1 }, (_, i) => [37.77 + i * 1e-6, -122.45]);
  rejects({ name: 'Ok', polygon: many }, /1000 points or fewer/);
  rejects({ name: 'Ok', polygon: SF_TRIANGLE, requirePresence: true, presenceLat: 40, presenceLng: -122.45 }, /claim spot inside San Francisco/);
  rejects({ name: 'Ok', polygon: SF_TRIANGLE, imageData: 'data:image/svg+xml;base64,PHN2Zy8+' }, /SVG images are not allowed/);
  // Limits are inclusive.
  assert.equal(parseZone({ name: 'x'.repeat(ZONE_LIMITS.name), polygon: many.slice(0, ZONE_LIMITS.points) }).name.length, ZONE_LIMITS.name);
});
