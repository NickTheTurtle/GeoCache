import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMaze, renderMazePage, passages, parseSize, normalizeWord } from '../src/lib/server/maze.js';

test('parseSize handles square, WxH, clamping and junk', () => {
  assert.deepEqual(parseSize('12'), { w: 12, h: 12 });
  assert.deepEqual(parseSize('20x10'), { w: 20, h: 10 });
  assert.deepEqual(parseSize('2x99'), { w: 5, h: 40 });
  assert.deepEqual(parseSize(undefined), { w: 15, h: 15 });
  assert.deepEqual(parseSize('big'), { w: 15, h: 15 });
});

test('normalizeWord uppercases and strips non-alphanumerics', () => {
  assert.equal(normalizeWord('Hello, World 42!'), 'HELLOWORLD42');
  assert.throws(() => buildMaze({ word: '!!!' }), /at least one letter/);
});

test('buildMaze is deterministic for the same inputs', () => {
  const a = buildMaze({ word: 'secret', seed: 's1', w: 12, h: 12 });
  const b = buildMaze({ word: 'secret', seed: 's1', w: 12, h: 12 });
  const c = buildMaze({ word: 'secret', seed: 's2', w: 12, h: 12 });
  assert.deepEqual(a.open, b.open);
  assert.deepEqual([...a.letters], [...b.letters]);
  assert.notDeepEqual(a.open, c.open);
});

test('maze is perfect: every cell reachable, n-1 passages', () => {
  const { w, h, open } = buildMaze({ word: 'X', seed: 'p', w: 10, h: 8 });
  let edges = 0;
  for (let i = 0; i < w * h; i++) edges += passages(open, i, w, h).length;
  assert.equal(edges / 2, w * h - 1);

  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    for (const j of passages(open, queue.shift(), w, h)) {
      if (!seen.has(j)) seen.add(j), queue.push(j);
    }
  }
  assert.equal(seen.size, w * h);
});

test('letters on the true path spell the word in order; decoys are off-path', () => {
  const maze = buildMaze({ word: 'Golden Gate', seed: 'x', w: 15, h: 15 });
  const { path, letters, start, exit, w, h, open } = maze;
  assert.equal(path[0], start);
  assert.equal(path.at(-1), exit);
  for (let i = 1; i < path.length; i++) assert.ok(passages(open, path[i - 1], w, h).includes(path[i]));

  const spelled = path.filter((i) => letters.has(i)).map((i) => letters.get(i)).join('');
  assert.equal(spelled, 'GOLDENGATE');
  assert.ok(!letters.has(start) && !letters.has(exit));

  const onPath = new Set(path);
  const decoys = [...letters.keys()].filter((i) => !onPath.has(i));
  assert.ok(decoys.length >= 'GOLDENGATE'.length);
  for (const i of decoys) assert.equal(passages(open, i, w, h).length, 1, 'decoys sit in dead ends');
});

test('buildMaze rejects words too long for the grid', () => {
  assert.throws(() => buildMaze({ word: 'A'.repeat(60), w: 5, h: 5 }), /too small/);
});

test('rendered page is self-contained with no scripts or external assets', () => {
  const maze = buildMaze({ word: 'abc', seed: 'r', w: 6, h: 6 });
  const html = renderMazePage(maze);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /\bsrc=/i);
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.every((href) => href.startsWith('#')), 'only in-page fragment links');
  assert.equal(hrefs.filter((href) => /^#c\d+$/.test(href)).length, 36);
  assert.equal((html.match(/class="mk"/g) || []).length, 36);
  assert.match(html, /#c35:target~\.win\{display:block\}/);
});
