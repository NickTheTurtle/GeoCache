import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validPolygon,
  validSecret,
  parseZone,
  ZONE_LIMITS,
  SF_BOUNDS,
  pointInSF,
  decodeImage,
  isAdmin,
  checkPassword,
  makeAdminToken,
  haversineMeters,
  readBody,
  str,
  cleanName,
} from '../src/lib/server/config.js';

const SF_TRIANGLE = [
  [37.77, -122.45],
  [37.771, -122.45],
  [37.771, -122.449],
];

const expectBadZone = (body, re) =>
  assert.throws(() => parseZone(body), (e) => e.status === 400 && re.test(e.body.message));

test('pointInSF accepts points inside the bounds and rejects those outside', () => {
  assert.equal(pointInSF(37.77, -122.45), true);
  assert.equal(pointInSF(40.0, -122.45), false); // too far north
  assert.equal(pointInSF(37.77, -100.0), false); // too far east
});

test('pointInSF treats every SF bounding-box edge as inclusive', () => {
  assert.equal(pointInSF(SF_BOUNDS.south, SF_BOUNDS.west), true);
  assert.equal(pointInSF(SF_BOUNDS.south, SF_BOUNDS.east), true);
  assert.equal(pointInSF(SF_BOUNDS.north, SF_BOUNDS.west), true);
  assert.equal(pointInSF(SF_BOUNDS.north, SF_BOUNDS.east), true);
  assert.equal(pointInSF(SF_BOUNDS.south - 1e-9, -122.45), false);
  assert.equal(pointInSF(SF_BOUNDS.north + 1e-9, -122.45), false);
  assert.equal(pointInSF(37.77, SF_BOUNDS.west - 1e-9), false);
  assert.equal(pointInSF(37.77, SF_BOUNDS.east + 1e-9), false);
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
  assert.equal(validPolygon([['37.77', -122.45], [37.771, -122.45], [37.771, -122.449]]), false); // strings are not coerced
  assert.equal(validPolygon([[[37.77], -122.45], [37.771, -122.45], [37.771, -122.449]]), false); // nested arrays
  assert.equal(validPolygon([[Infinity, -122.45], [37.771, -122.45], [37.771, -122.449]]), false);
});

test('validPolygon accepts exactly three points and does not enforce the max-count limit', () => {
  assert.equal(validPolygon(SF_TRIANGLE), true);
  assert.equal(validPolygon(Array.from({ length: ZONE_LIMITS.points + 1 }, () => [37.77, -122.45])), true);
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
  assert.throws(() => decodeImage('data:image/png;base64,'));
  assert.throws(() => decodeImage('data:image/png;base64,@@@@')); // bad base64 decodes to empty
  assert.throws(() => decodeImage('data:text/plain;base64,aGVsbG8=')); // not an image
  const huge = 'data:image/png;base64,' + Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64');
  assert.throws(() => decodeImage(huge)); // > 4MB
});

test('decodeImage rejects SVG (stored-XSS vector)', () => {
  assert.throws(() =>
    decodeImage('data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'))
  );
  assert.throws(() =>
    decodeImage('data:image/SVG+XML;base64,' + Buffer.from('<svg/>').toString('base64'))
  );
});

test('decodeImage accepts an image exactly at the decoded byte limit', () => {
  const out = decodeImage('data:image/png;base64,' + Buffer.alloc(4 * 1024 * 1024).toString('base64'));
  assert.equal(out.image.length, 4 * 1024 * 1024);
  assert.equal(out.imageType, 'image/png');
});

const fakeReq = (pw, method = 'GET') => ({ method, headers: { get: (k) => (k === 'x-admin-password' ? pw ?? null : null) } });
const fakeUrl = (qs = '') => new URL(`https://x/${qs}`);

test('checkPassword accepts only the exact admin password', () => {
  assert.equal(checkPassword('changeme'), true);
  for (const bad of ['changem', 'changeme ', 'CHANGEME', '', null, undefined, 'x'.repeat(1000), 'changéme', '🐇'.repeat(100)]) {
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

test('isAdmin rejects malformed, expired, and huge signed-token shapes without throwing', () => {
  const token = makeAdminToken();
  const [exp, sig] = token.split('.');
  const sameLengthBadSig = 'A'.repeat(sig.length);
  for (const tok of ['', '.', 'abc', '123.', '.sig', `${exp}.${sameLengthBadSig}`, `${'9'.repeat(5000)}.sig`]) {
    assert.equal(isAdmin(fakeReq(), fakeUrl(`?t=${encodeURIComponent(tok)}`)), false, tok.slice(0, 20));
  }
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

test('haversineMeters measures about 111 km per degree of latitude', () => {
  const d = haversineMeters(0, 0, 1, 0);
  assert.ok(d > 110_000 && d < 112_500, `expected ~111km, got ${d}`);
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

  expectBadZone(null, /Zone name is required/);
  expectBadZone({ name: '   ', polygon: SF_TRIANGLE }, /Zone name is required/);
  expectBadZone({ name: 'x'.repeat(ZONE_LIMITS.name + 1), polygon: SF_TRIANGLE }, /60 characters or fewer/);
  expectBadZone({ name: 'Ok', hint: 'x'.repeat(ZONE_LIMITS.hint + 1), polygon: SF_TRIANGLE }, /Hint must be 5000 characters or fewer/);
  expectBadZone({ name: 'Ok', polygon: [[37.77, -122.45]] }, /3\+ points inside San Francisco/);
  const many = Array.from({ length: ZONE_LIMITS.points + 1 }, (_, i) => [37.77 + i * 1e-6, -122.45]);
  expectBadZone({ name: 'Ok', polygon: many }, /1000 points or fewer/);
  expectBadZone({ name: 'Ok', polygon: SF_TRIANGLE, requirePresence: true, presenceLat: 40, presenceLng: -122.45 }, /claim spot inside San Francisco/);
  expectBadZone({ name: 'Ok', polygon: SF_TRIANGLE, imageData: 'data:image/svg+xml;base64,PHN2Zy8+' }, /SVG images are not allowed/);
  // Limits are inclusive.
  assert.equal(parseZone({ name: 'x'.repeat(ZONE_LIMITS.name), polygon: many.slice(0, ZONE_LIMITS.points) }).name.length, ZONE_LIMITS.name);
});

test('parseZone boundary checks names, hints, polygon size, and code-unit length', () => {
  const exactHint = 'h'.repeat(ZONE_LIMITS.hint);
  const exactPoints = Array.from({ length: ZONE_LIMITS.points }, () => [37.77, -122.45]);
  assert.equal(parseZone({ name: ` ${'n'.repeat(ZONE_LIMITS.name)} `, hint: exactHint, polygon: exactPoints }).hint.length, ZONE_LIMITS.hint);
  expectBadZone({ name: 'n'.repeat(ZONE_LIMITS.name + 1), polygon: SF_TRIANGLE }, /60 characters or fewer/);
  expectBadZone({ name: 'Ok', hint: 'h'.repeat(ZONE_LIMITS.hint + 1), polygon: SF_TRIANGLE }, /5000 characters or fewer/);
  expectBadZone({ name: 'Ok', polygon: [[37.77, -122.45], [37.771, -122.45]] }, /3\+ points/);
  expectBadZone({ name: 'Ok', polygon: [...exactPoints, [37.77, -122.45]] }, /1000 points or fewer/);

  const emojiName = '🐇'.repeat(30);
  assert.equal(parseZone({ name: emojiName, polygon: SF_TRIANGLE }).name.length, ZONE_LIMITS.name);
  expectBadZone({ name: '🐇'.repeat(31), polygon: SF_TRIANGLE }, /60 characters or fewer/);
});

test('parseZone rejects malformed polygon coordinates and accepts SF boundary points', () => {
  const boundary = [
    [SF_BOUNDS.south, SF_BOUNDS.west],
    [SF_BOUNDS.north, SF_BOUNDS.west],
    [SF_BOUNDS.north, SF_BOUNDS.east],
  ];
  assert.deepEqual(parseZone({ name: 'Boundary', polygon: boundary }).polygon, boundary);

  for (const polygon of [
    [['37.77', -122.45], [37.771, -122.45], [37.771, -122.449]],
    [[NaN, -122.45], [37.771, -122.45], [37.771, -122.449]],
    [[Infinity, -122.45], [37.771, -122.45], [37.771, -122.449]],
    [[[37.77], -122.45], [37.771, -122.45], [37.771, -122.449]],
    [[SF_BOUNDS.south - 1e-9, -122.45], [37.771, -122.45], [37.771, -122.449]],
    [[37.77, SF_BOUNDS.east + 1e-9], [37.771, -122.45], [37.771, -122.449]],
  ]) {
    expectBadZone({ name: 'Bad', polygon }, /3\+ points inside San Francisco/);
  }
});

test('parseZone enforces presence coordinates only when requirePresence is true', () => {
  const ok = parseZone({ name: 'On site', polygon: SF_TRIANGLE, requirePresence: true, presenceLat: '37.7705', presenceLng: '-122.4495' });
  assert.deepEqual([ok.presenceLat, ok.presenceLng], [37.7705, -122.4495]);

  for (const body of [
    { presenceLat: undefined, presenceLng: -122.45 },
    { presenceLat: NaN, presenceLng: -122.45 },
    { presenceLat: Infinity, presenceLng: -122.45 },
    { presenceLat: 40, presenceLng: -122.45 },
    { presenceLat: 37.77, presenceLng: -100 },
  ]) {
    expectBadZone({ name: 'Bad presence', polygon: SF_TRIANGLE, requirePresence: true, ...body }, /claim spot inside San Francisco/);
  }

  const ignored = parseZone({ name: 'Remote', polygon: SF_TRIANGLE, requirePresence: false, presenceLat: NaN, presenceLng: Infinity });
  assert.deepEqual([ignored.presenceLat, ignored.presenceLng], [null, null]);
});

const req = (text) => new Request('http://x/', { method: 'POST', body: text, headers: { 'Content-Type': 'application/json' } });

test('readBody turns any malformed body into {} so endpoints never crash', async () => {
  for (const text of ['', 'hello', 'null', '[]', '[1,2]', '"x"', '5', 'true', '{"a":']) {
    assert.deepEqual(await readBody(req(text)), {}, JSON.stringify(text));
  }
  assert.deepEqual(await readBody(req('{"a":1}')), { a: 1 });
  assert.deepEqual(await readBody(req('\uFEFF{"a":1}')), { a: 1 }); // a byte-order mark is fine
});

test('str only accepts strings', () => {
  assert.equal(str('  a b  '), 'a b');
  for (const v of [5, null, undefined, {}, ['a'], true]) assert.equal(str(v), '');
});

test('cleanName rejects invisible names and strips control / direction characters', () => {
  assert.equal(cleanName('  Jane   Doe '), 'Jane Doe');
  assert.equal(cleanName('x\ny\tz'), 'x y z');
  assert.equal(cleanName('a\u0000b'), 'a b');
  assert.equal(cleanName('\u202Eevil'), 'evil'); // right-to-left override removed
  for (const v of ['', '   ', '\u200B', '\u200B\u200D', '\u0000', '\n\t', null, {}, ['a']]) assert.equal(cleanName(v), '', JSON.stringify(v));
  assert.equal(cleanName(42), '42');
  assert.equal(cleanName('\u{1F469}\u200D\u{1F4BB} Dev'), '\u{1F469}\u200D\u{1F4BB} Dev'); // emoji joiner kept
  assert.equal(cleanName('\u05E2\u05D1\u05E8\u05D9\u05EA'), '\u05E2\u05D1\u05E8\u05D9\u05EA');
});

test('parseZone keeps hint line breaks but drops other control characters', () => {
  const poly = [[37.77, -122.45], [37.771, -122.45], [37.771, -122.449]];
  const z = parseZone({ name: 'N', hint: 'line1\r\nline2\u0000\u0007\n\tx', polygon: poly });
  assert.equal(z.hint, 'line1\nline2\n\tx');
  assert.equal(parseZone({ name: 'N', hint: { a: 1 }, polygon: poly }).hint, '');
  assert.throws(() => parseZone({ name: '\u200B', polygon: poly }), /name is required/);
  assert.throws(() => parseZone({ name: { a: 1 }, polygon: poly }), /name is required/);
});
