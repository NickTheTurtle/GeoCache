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
  // nested emphasis stays well-formed
  assert.equal(renderHint('**bold _and italic_**'), '<strong>bold <em>and italic</em></strong>');
  assert.equal(renderHint('***both***'), '<em><strong>both</strong></em>');
  // unbalanced/leftover delimiters degrade to literal, never crossed tags
  assert.equal(renderHint('**'), '**');
  assert.equal(renderHint('a * b'), 'a * b');
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

test('renderHint renders safe [label](url) links', () => {
  assert.equal(
    renderHint('See [the map](https://sfgov.org/map)'),
    'See <a href="https://sfgov.org/map" target="_blank" rel="noopener noreferrer">the map</a>'
  );
  assert.equal(
    renderHint('Email [us](mailto:hi@example.com)'),
    'Email <a href="mailto:hi@example.com" target="_blank" rel="noopener noreferrer">us</a>'
  );
  // URLs may contain _ and * without triggering emphasis.
  assert.equal(
    renderHint('*[go](https://x.com/a_b)*'),
    '<em><a href="https://x.com/a_b" target="_blank" rel="noopener noreferrer">go</a></em>'
  );
  // Ampersands in the URL stay HTML-escaped in the href.
  assert.equal(
    renderHint('[x](https://x.com/a?b=1&c=2)'),
    '<a href="https://x.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a>'
  );
});

test('renderHint rejects unsafe link URLs (XSS-safe)', () => {
  // Only http(s)/mailto are allowed; everything else stays literal, no anchor.
  assert.equal(renderHint('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(renderHint('[x](data:text/html,<b>)'), '[x](data:text/html,&lt;b&gt;)');
  assert.equal(renderHint('[x](/local/path)'), '[x](/local/path)');
});

