import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, zoneStyle, extractSecret, renderHint } from '../src/lib/util.js';

test('escapeHtml escapes all HTML-sensitive characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(escapeHtml('plain text'), 'plain text');
  assert.equal(escapeHtml(123), '123'); // coerces non-strings
});

test("zoneStyle highlights only the current crew's claimed zones", () => {
  const zone = { claimedBy: [{ id: 7, name: 'S&V' }] };

  const mine = zoneStyle(zone, { id: 7 });
  assert.equal(mine.weight, 5);
  assert.equal(mine.color, '#1f6f8f');
  assert.equal(mine.fillColor, '#2a7ea3');

  const other = zoneStyle(zone, { id: 6 });
  assert.equal(other.weight, 3);
  assert.equal(other.color, '#123a5c');

  const anon = zoneStyle(zone, null);
  assert.equal(anon.weight, 3); // not signed in -> looks unclaimed
});

test('extractSecret pulls the secret from a claim URL', () => {
  assert.equal(extractSecret('/claim?c=ABC123def'), 'ABC123def');
  assert.equal(extractSecret('https://host.example/claim?c=xY_z-1234'), 'xY_z-1234');
});

test('extractSecret accepts a bare secret string', () => {
  assert.equal(extractSecret('abcdef'), 'abcdef');
  assert.equal(extractSecret('  h05aMv6952Bu  '), 'h05aMv6952Bu'); // trims
});

test('extractSecret rejects invalid input', () => {
  assert.equal(extractSecret(''), null);
  assert.equal(extractSecret('ab'), null); // too short for a bare secret
  assert.equal(extractSecret('http://host/claim'), null); // URL without ?c=
  assert.equal(extractSecret(null), null);
});

test('renderHint applies bold and italic markdown', () => {
  assert.equal(renderHint('a **bold** word'), 'a <strong>bold</strong> word');
  assert.equal(renderHint('a __bold__ word'), 'a <strong>bold</strong> word');
  assert.equal(renderHint('an *italic* word'), 'an <em>italic</em> word');
  assert.equal(renderHint('an _italic_ word'), 'an <em>italic</em> word');
  // bold takes precedence over italic on double delimiters
  assert.equal(renderHint('**strong**'), '<strong>strong</strong>');
});

test('renderHint escapes HTML before applying markdown (XSS-safe)', () => {
  assert.equal(
    renderHint('<script>alert(1)</script> **x**'),
    '&lt;script&gt;alert(1)&lt;/script&gt; <strong>x</strong>'
  );
  assert.equal(renderHint(null), '');
});

test('renderHint escapes delimiters with a backslash', () => {
  // Fill-in blanks: escape each underscore so it stays literal.
  assert.equal(
    renderHint('beat the \\_ \\_ \\_ \\_ \\_ \\_ in a race'),
    'beat the _ _ _ _ _ _ in a race'
  );
  // Escaped asterisks/underscores are literal, not emphasis.
  assert.equal(renderHint('3 \\* 4 = 12'), '3 * 4 = 12');
  assert.equal(renderHint('\\*not italic\\*'), '*not italic*');
  assert.equal(renderHint('\\_not italic\\_'), '_not italic_');
  // A lone underscore or mid-word underscore is not italics.
  assert.equal(renderHint('snake_case value'), 'snake_case value');
});

