import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHeistNote } from '../src/lib/server/heistNote.js';

test('heist note is a self-contained page with the full letter', () => {
  const html = renderHeistNote();
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /\b(src|href)=/i, 'no external assets or links');
  assert.match(html, /<title>The Heist<\/title>/);
  for (const text of [
    'Dear idiots,',
    'You’re the most unreliable, worthless piece of rookie meat',
    '“Not a second too late,” I said.',
    'I even waited an extra 30 minutes for your sorry asses.',
    'machine from the Museum, free to the public.',
    'Use that machine and come back here ON TIME.',
    'Flabber Gast',
    'September 28th',
  ]) {
    assert.ok(html.includes(text), `missing: ${text}`);
  }
});
