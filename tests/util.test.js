import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { escapeHtml, zoneStyle, extractSecret, renderHint, formatPts, formatDelta, untilOk } from '../src/lib/util.js';

test('escapeHtml escapes all HTML-sensitive characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(escapeHtml('plain text'), 'plain text');
  assert.equal(escapeHtml(123), '123'); // coerces non-strings
});

test('escapeHtml coerces edge values before escaping', () => {
  assert.equal(escapeHtml('&<>"\';'), '&amp;&lt;&gt;&quot;&#39;;');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(undefined), 'undefined');
  assert.equal(escapeHtml(false), 'false');
  assert.equal(escapeHtml({ toString: () => '<obj&>' }), '&lt;obj&amp;&gt;');
});

test("zoneStyle highlights only the current employee's claimed zones", () => {
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

test('extractSecret accepts ?c= from any URL shape and decodes it', () => {
  assert.equal(extractSecret('  HTTPS://HOST.EXAMPLE/claim/?x=1&c=abc%2D_DEF&y=2#frag  '), 'abc-_DEF');
  assert.equal(extractSecret('http://other.example/not-claim?c=Qr_Secret-123'), 'Qr_Secret-123');
  assert.equal(extractSecret('https://host.example/claim/?c=trailSlash'), 'trailSlash');
  assert.equal(extractSecret('https://host.example/claim?x=1&c=first&c=second'), 'first');
});

test('extractSecret accepts a bare secret string', () => {
  assert.equal(extractSecret('abcdef'), 'abcdef');
  assert.equal(extractSecret('  h05aMv6952Bu  '), 'h05aMv6952Bu'); // trims
});

test('extractSecret rejects invalid input', () => {
  assert.equal(extractSecret(''), null);
  assert.equal(extractSecret('abcde'), null); // too short for a bare secret
  assert.equal(extractSecret('http://host/claim'), null); // URL without ?c=
  assert.equal(extractSecret(null), null);
  assert.equal(extractSecret(undefined), null);
  assert.equal(extractSecret('abc def'), null);
  assert.equal(extractSecret('abc/def'), null);
  assert.equal(extractSecret('abc+def'), null);
  assert.equal(extractSecret('abc$def'), null);
  assert.equal(extractSecret('WIFI:T:WPA;S:care;P:secret;;'), null);
  assert.equal(extractSecret('scan this random paragraph instead'), null);
  assert.equal(extractSecret('x'.repeat(10000) + '!'), null);
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

test('renderHint keeps malformed and empty emphasis markers literal', () => {
  assert.equal(renderHint('**a _b** c_'), '<strong>a _b</strong> c_');
  assert.equal(renderHint('****'), '****');
  assert.equal(renderHint('____'), '____');
  assert.equal(renderHint('*'), '*');
  assert.equal(renderHint('_'), '_');
  assert.equal(renderHint('before **after'), 'before **after');
  assert.equal(renderHint('before _after'), 'before _after');
});

test('renderHint escapes HTML before applying markdown (XSS-safe)', () => {
  assert.equal(
    renderHint('<script>alert(1)</script> **x**'),
    '&lt;script&gt;alert(1)&lt;/script&gt; <strong>x</strong>'
  );
  assert.equal(renderHint('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(renderHint('"><svg onload=alert(1)>'), '&quot;&gt;&lt;svg onload=alert(1)&gt;');
  assert.equal(renderHint(null), '');
});

test('renderHint neutralizes link-label and href attribute-breakout attempts', () => {
  assert.equal(
    renderHint('[" onclick="alert(1)](https://example.com)'),
    '<a href="https://example.com" target="_blank" rel="noopener noreferrer">&quot; onclick=&quot;alert(1)</a>'
  );
  assert.equal(
    renderHint('[x](https://example.com/"onmouseover="x)'),
    '<a href="https://example.com/&quot;onmouseover=&quot;x" target="_blank" rel="noopener noreferrer">x</a>'
  );
  assert.equal(renderHint('[x](https://example.com/a b)'), '[x](https://example.com/a b)');
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
  // Escaped carets/tildes stay literal, not sup/sub.
  assert.equal(renderHint('2 \\^ 3'), '2 ^ 3');
  assert.equal(renderHint('a \\~ b'), 'a ~ b');
});

test('renderHint renders superscript and subscript', () => {
  assert.equal(renderHint('E = mc^2^'), 'E = mc<sup>2</sup>');
  assert.equal(renderHint('H~2~O'), 'H<sub>2</sub>O');
  assert.equal(renderHint('x^2^ + y~i~'), 'x<sup>2</sup> + y<sub>i</sub>');
  // Content may not contain spaces or the delimiter, so stray marks stay literal.
  assert.equal(renderHint('2 ^ 3'), '2 ^ 3');
  assert.equal(renderHint('a ~ b'), 'a ~ b');
  assert.equal(renderHint('lone ^ caret'), 'lone ^ caret');
  // sup/sub content is HTML-escaped and never parsed as further markup (XSS-safe).
  assert.equal(renderHint('a^<b>^'), 'a<sup>&lt;b&gt;</sup>');
  // Emphasis around a superscript still works.
  assert.equal(renderHint('**x^2^**'), '<strong>x<sup>2</sup></strong>');
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
  assert.equal(renderHint('[x](JaVaScRiPt:alert(1))'), '[x](JaVaScRiPt:alert(1))');
  assert.equal(renderHint('[x](data:text/html,<b>)'), '[x](data:text/html,&lt;b&gt;)');
  assert.equal(renderHint('[x](vbscript:msgbox(1))'), '[x](vbscript:msgbox(1))');
  assert.equal(renderHint('[x](/local/path)'), '[x](/local/path)');
});

test('renderHint handles long and pathological input quickly', () => {
  const cases = [
    ['stars', '*'.repeat(5000)],
    ['underscores', '_'.repeat(5000)],
    ['open brackets', '['.repeat(5000)],
    ['close-open pairs', ']('.repeat(2500)],
    ['bold delimiters', '**'.repeat(2500)],
    ['unfinished links', '[a]('.repeat(1000)],
  ];

  for (const [name, input] of cases) {
    const start = performance.now();
    const out = renderHint(input);
    const elapsed = performance.now() - start;
    assert.equal(typeof out, 'string');
    assert.ok(elapsed < 50, `${name} took ${elapsed.toFixed(2)} ms`);
  }
});

test('formatPts/formatDelta use "pts" and a true minus sign', () => {
  assert.equal(formatPts(12), '12 pts');
  assert.equal(formatPts(1), '1 pts');
  assert.equal(formatPts(0), '0 pts');
  assert.equal(formatPts(-0), '0 pts');
  assert.equal(formatPts(1_000_000), '1000000 pts');
  assert.equal(formatPts(-3), '\u22123 pts');
  assert.equal(formatDelta(5), '+5');
  assert.equal(formatDelta(0), '+0');
  assert.equal(formatDelta(-0), '+0');
  assert.equal(formatDelta(1_000_000), '+1000000');
  assert.equal(formatDelta(-2), '\u22122');
});

test('untilOk retries a failing task until it succeeds', async () => {
  let calls = 0;
  const t0 = Date.now();
  const v = await untilOk(async () => { if (++calls < 3) throw new Error('down'); return 'up'; });
  assert.equal(v, 'up');
  assert.equal(calls, 3);
  assert.ok(Date.now() - t0 >= 2900, 'waits 1s then 2s between tries'); // backs off instead of hammering
});
