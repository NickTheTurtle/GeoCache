import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildMaze,
  renderMazePage,
  passages,
  parseSize,
  slideTarget,
  earlyBranches,
  makeCodes,
  imageFromFile,
  resolveSeed,
  countdown,
  centralCells,
  LAYOUT_VERSION,
  solutionPresses,
  TARGET_PRESSES,
  DEFAULT_IMAGE,
} from '../src/lib/server/maze.js';

test('parseSize handles square, WxH, clamping and junk', () => {
  assert.deepEqual(parseSize('12'), { w: 12, h: 12 });
  assert.deepEqual(parseSize('20x10'), { w: 20, h: 10 });
  assert.deepEqual(parseSize('2x99'), { w: 5, h: 40 });
  assert.deepEqual(parseSize(undefined), { w: 15, h: 15 });
  assert.deepEqual(parseSize('big'), { w: 15, h: 15 });
});

test('the early part of the route still offers real wrong turns', () => {
  for (const seed of ['geocache', 'a', 'b', 'c']) {
    const { branches, deep } = earlyBranches(buildMaze({ seed }));
    assert.ok(branches >= 6, `${seed}: ${branches} early branches`);
    assert.ok(deep >= 3, `${seed}: ${deep} early dead ends`);
  }
});

test('buildMaze is deterministic for the same inputs', () => {
  const a = buildMaze({ seed: 's1', w: 12, h: 12 });
  const b = buildMaze({ seed: 's1', w: 12, h: 12 });
  const c = buildMaze({ seed: 's2', w: 12, h: 12 });
  assert.deepEqual(a.open, b.open);
  assert.notDeepEqual(a.open, c.open);
});

test('maze is perfect: every cell reachable, n-1 passages, path runs start to exit', () => {
  const { w, h, open, path: route, start, exit } = buildMaze({ seed: 'p', w: 10, h: 8 });
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
  assert.equal(route[0], start);
  assert.equal(route.at(-1), exit);
  for (let i = 1; i < route.length; i++) assert.ok(passages(open, route[i - 1], w, h).includes(route[i]));
});

test('slideTarget follows a corridor and stops at walls and side openings', () => {
  const N = 1, E = 2, S = 4, W = 8;
  // A 5x1 strip: 0-1-2-3-4, with a side opening south of cell 3 (into a 5x2 grid).
  const w = 5;
  const open = [E, E | W, E | W, E | W | S, W, 0, 0, 0, N, 0];
  assert.equal(slideTarget(open, 0, E, w), 3); // stops where the side passage opens
  assert.equal(slideTarget(open, 3, E, w), 4); // stops at the wall
  assert.equal(slideTarget(open, 4, W, w), 3);
  assert.equal(slideTarget(open, 3, S, w), 8);
  assert.equal(slideTarget(open, 0, E, w, 2), 2); // never slides past the Target
});

test('square codes are unguessable, unique, seed-bound and not emitted in order', () => {
  const n = 18 * 18;
  const a = makeCodes('secret-seed', n);
  const all = [...a.id, ...a.cell, ...a.pad];
  assert.equal(new Set(all).size, 3 * n, 'ids and class names never collide');
  assert.ok(all.every((c) => /^[a-z][a-z0-9]{7}$/.test(c)), 'valid CSS identifiers');
  assert.deepEqual(makeCodes('secret-seed', n), a, 'deterministic');
  const b = makeCodes('other-seed', n);
  assert.equal(a.id.filter((c, i) => b.id[i] === c).length, 0, 'a different seed changes every code');

  const maze = buildMaze({ seed: 'secret-seed', w: 18, h: 18 });
  const html = renderMazePage(maze);
  assert.doesNotMatch(html, /#c\d+\b/, 'no sequential square numbers');
  const markerOrder = [...html.matchAll(/<i class="mk" id="([^"]+)">/g)].map((m) => maze.codes.id.indexOf(m[1]));
  assert.equal(markerOrder.length, n);
  assert.notDeepEqual(markerOrder, [...Array(n).keys()], 'markers are shuffled');
  assert.ok(markerOrder.at(-1) !== n - 1 && markerOrder[0] !== 0);
});

test('rendered page is self-contained with no scripts or external assets', () => {
  const maze = buildMaze({ seed: 'r', w: 6, h: 6 });
  const html = renderMazePage(maze);
  assert.doesNotMatch(html, /<script/i);
  const srcs = [...html.matchAll(/\bsrc="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, [DEFAULT_IMAGE.src]);
  assert.ok(srcs[0].startsWith('data:image/svg+xml;base64,'));
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.every((href) => href.startsWith('#')), 'only in-page fragment links');
  // One arrow link per direction of every open passage, each to a square's code.
  const moves = hrefs.filter((href) => href !== '#');
  assert.equal(moves.length, 2 * (36 - 1));
  assert.ok(moves.every((href) => maze.codes.id.includes(href.slice(1))));
  assert.equal((html.match(/class="mk"/g) || []).length, 36);
  assert.ok(html.includes(`#${maze.codes.id[maze.exit]}:target~.win{display:block}`));
  // No letters on the board.
  assert.equal((html.match(/<div class="c [^"]*"><\/div>/g) || []).length, 36);
});

test('imageFromFile inlines the picture as a data URL and escapes alt text', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'maze-')), 'prize.PNG');
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const image = imageFromFile(file, 'Say "hi" <3');
  assert.equal(image.src, 'data:image/png;base64,iVBORw==');
  const html = renderMazePage(buildMaze({ seed: 'i', w: 5, h: 5 }), { image });
  assert.match(html, /<img src="data:image\/png;base64,iVBORw==" alt="Say &quot;hi&quot; &lt;3">/);
  assert.throws(() => imageFromFile(file.replace(/PNG$/, 'txt')), /MAZE_IMAGE must be/);
});

test('resolveSeed: MAZE_SEED wins, else one private seed is created and kept in DATA_DIR', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maze-seed-'));
  assert.equal(resolveSeed({ MAZE_SEED: 'explicit', DATA_DIR: dir }), 'explicit');
  assert.ok(!fs.existsSync(path.join(dir, 'maze-seed')), 'no file written when MAZE_SEED is set');

  const first = resolveSeed({ DATA_DIR: dir });
  assert.match(first, /^[0-9a-f]{32}$/, 'random 128-bit hex seed');
  assert.equal(resolveSeed({ DATA_DIR: dir }), first, 'stable across calls (and restarts)');
  assert.equal(fs.readFileSync(path.join(dir, 'maze-seed'), 'utf8').trim(), first);

  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'maze-seed-'));
  assert.notEqual(resolveSeed({ DATA_DIR: other }), first, 'each install gets its own seed');

  const nested = path.join(dir, 'not', 'yet', 'created');
  assert.match(resolveSeed({ DATA_DIR: nested }), /^[0-9a-f]{32}$/, 'creates DATA_DIR if needed');
});

test('countdown: 5:00 timer CSS with a lock at 0:00 and a pause on win', () => {
  const { html, css, armed } = countdown(5, 'exitid');
  assert.match(html, /role="timer"/);
  assert.equal((html.match(/class="cw"/g) || []).length, 3, 'minute, tens and ones windows');
  assert.match(html, /class="cs tm">5<br>4<br>3<br>2<br>1<br>0</);
  assert.match(css, /\.t1\{animation:t1 10s steps\(10,end\) 30 forwards\}/);
  assert.match(css, /\.t10\{animation:t10 60s steps\(6,end\) -59s 5\.983333 forwards\}/);
  assert.match(css, /\.tm\{animation:tm 300s step-end forwards\}/);
  assert.match(css, /\.t\{animation:hurry 0s 240s forwards\}/, 'turns red at 1:00');
  assert.match(css, /\.pad\{animation:arm 0s 300s forwards\}/);
  assert.match(css, /\.armed\{animation:alarm 0s 300s forwards\}/);
  assert.match(css, /#exitid:target~\.b \.t,#exitid:target~\.b \.cs\{animation-play-state:paused\}/);
  assert.match(armed, /Lasers re-armed!/);

  const two = countdown(2, 'x');
  assert.match(two.css, /\.pad\{animation:arm 0s 120s forwards\}/);
  assert.match(two.css, /\.t\{animation:hurry 0s 60s forwards\}/);
  assert.throws(() => countdown(0, 'x'), /minutes must be/);
  assert.throws(() => countdown(10, 'x'), /minutes must be/);

  const page = renderMazePage(buildMaze({ seed: 'timer', w: 6, h: 6 }));
  assert.ok(page.includes('role="timer"') && page.includes('Lasers re-armed!'));
  assert.doesNotMatch(page, /<script/i);
});

test('the Target sits in the middle, about 40 presses away, and slides never skip it', () => {
  for (const seed of ['geocache', 'a', 'b', 'c', 'd']) {
    for (const [w, h] of [[15, 15], [18, 18], [8, 8], [9, 7]]) {
      const maze = buildMaze({ seed, w, h });
      const { open, exit, path: route } = maze;
      assert.ok(centralCells(w, h).includes(exit), `${seed} ${w}x${h}: Target is central`);
      assert.equal(route.at(-1), exit);
      if (w >= 15) {
        const p = solutionPresses(maze);
        assert.ok(Math.abs(p - 40) <= 4, `${seed}: a perfect run is ${p} presses`);
        assert.equal(passages(open, exit, w, h).length, 1, `${seed}: Target is a dead-end vault`);
      }
      // From every square, in every open direction, a slide stops on the Target
      // rather than gliding over it.
      for (let i = 0; i < w * h; i++) {
        for (const [dir, step] of [[1, -w], [2, 1], [4, w], [8, -1]]) {
          if (!(open[i] & dir)) continue;
          const to = slideTarget(open, i, dir, w, exit);
          for (let j = i + step; j !== to; j += step) assert.notEqual(j, exit, `slide from ${i} skipped the Target`);
        }
      }
    }
  }
});

test('the layout version is part of the seed, so bumping it regenerates the maze', () => {
  assert.equal(LAYOUT_VERSION, 2);
  const a = buildMaze({ seed: 'same' });
  const b = buildMaze({ seed: 'same' });
  assert.deepEqual(a.open, b.open);
  // Same seed text as a v1 key would produce different codes than the v2 build.
  assert.notDeepEqual(makeCodes('same', a.w * a.h).id, a.codes.id);
  assert.deepEqual(makeCodes(`same/v${LAYOUT_VERSION}`, a.w * a.h).id, a.codes.id);
  assert.equal(a.w * a.h, 15 * 15, 'default size is 15x15');
});

test('solutionPresses counts a slide as one press, and buildMaze aims for the requested count', () => {
  const N = 1, E = 2, S = 4, W = 8;
  // 5x1 strip 0-1-2-3-4 with a side opening south of 3 (into a 5x2 grid), Target at 8.
  const w = 5;
  const open = [E, E | W, E | W, E | W | S, W, 0, 0, 0, N, 0];
  assert.equal(solutionPresses({ w, open, path: [0, 1, 2, 3, 8], exit: 8 }), 2); // slide to 3, then down

  const within = (seed, presses) => Math.abs(solutionPresses(buildMaze({ seed, presses })) - presses);
  let hits = 0;
  for (const seed of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) if (within(seed, 40) <= 2) hits++;
  assert.ok(hits >= 4, `${hits}/6 seeds within 2 presses of 40`);
  assert.equal(TARGET_PRESSES, 40);
  const longer = ['p1', 'p2', 'p3'].map((seed) => solutionPresses(buildMaze({ seed, presses: 60 })));
  assert.ok(longer.every((p) => p > 50), `presses: 60 gives longer runs (${longer})`);
});
