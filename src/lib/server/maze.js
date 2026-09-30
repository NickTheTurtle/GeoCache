// A deterministic, JavaScript-free maze puzzle ("The Heist") served at /heist72
// so the Wayback Machine can capture it. (/heist shows Flabber Gast's note.)
//
// The page is fully self-contained (inline CSS, no scripts or external assets)
// so it survives being captured by the Internet Archive's Wayback Machine.
// Movement uses fragment links and CSS :target. A hidden marker element with a
// random-looking id (see makeCodes) exists for every cell, and the targeted
// marker is the player's position (no target means the entrance). An on-screen
// arrow pad holds one link per open passage, and generated sibling selectors
// (#id:target ~ .pad .padClass) show only the arrows leading out of the current
// cell, so moves respect walls.
//
// Arrows slide along a corridor until the next turn or junction (or the Target).
// The Target sits near the middle; reaching it reveals a picture, inlined as a
// data: URL so nothing else is fetched.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const N = 1, E = 2, S = 4, W = 8;
const OPPOSITE = { [N]: S, [S]: N, [E]: W, [W]: E };

// FNV-1a string hash -> 32-bit seed.
function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Small, fast seeded PRNG so the same seed always yields the same maze.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function neighbours(i, w, h) {
  const x = i % w, y = Math.floor(i / w);
  const out = [];
  if (y > 0) out.push([N, i - w]);
  if (x < w - 1) out.push([E, i + 1]);
  if (y < h - 1) out.push([S, i + w]);
  if (x > 0) out.push([W, i - 1]);
  return out;
}

// Perfect maze (exactly one route between any two cells) via a "growing tree":
// usually extend the newest cell (recursive backtracker, long winding
// corridors), but near the entrance often branch from a random earlier cell
// instead, which sprouts many side passages there. Each cell holds a bitmask of
// its open sides.
const BRANCH_NEAR_START = 0.8; // branching chance at the entrance...
const BRANCH_REACH = 0.6; // ...fading to 0 by this fraction of the way to the exit

function carve(w, h, rng) {
  const open = new Array(w * h).fill(0);
  const seen = new Array(w * h).fill(false);
  const active = [0];
  seen[0] = true;
  const far = w + h - 2;
  while (active.length) {
    const newest = active[active.length - 1];
    const dist = (newest % w) + Math.floor(newest / w);
    const branch = BRANCH_NEAR_START * Math.max(0, 1 - dist / (BRANCH_REACH * far));
    const k = rng() < branch ? Math.floor(rng() * active.length) : active.length - 1;
    const cur = active[k];
    const next = shuffle(neighbours(cur, w, h).filter(([, j]) => !seen[j]), rng);
    if (!next.length) {
      active.splice(k, 1);
      continue;
    }
    const [dir, j] = next[0];
    open[cur] |= dir;
    open[j] |= OPPOSITE[dir];
    seen[j] = true;
    active.push(j);
  }
  return open;
}

// Adjacent cells reachable from i (i.e. with no wall in between).
export function passages(open, i, w, h) {
  return neighbours(i, w, h)
    .filter(([dir]) => open[i] & dir)
    .map(([, j]) => j);
}

function solve(open, w, h, from, to) {
  const prev = new Array(w * h).fill(-1);
  prev[from] = from;
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const j of passages(open, cur, w, h)) {
      if (prev[j] === -1) {
        prev[j] = cur;
        queue.push(j);
      }
    }
  }
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return path;
}

// "18" -> 18x18, "24x16" -> 24 wide by 16 tall. Clamped to a sane range.
export function parseSize(value, fallback = 18) {
  const m = /^\s*(\d+)\s*(?:[x×]\s*(\d+))?\s*$/i.exec(String(value ?? ''));
  const clamp = (n) => Math.min(40, Math.max(5, n));
  if (!m) return { w: fallback, h: fallback };
  const w = clamp(Number(m[1]));
  return { w, h: m[2] ? clamp(Number(m[2])) : w };
}

const STEP = (w) => ({ [N]: -w, [S]: w, [E]: 1, [W]: -1 });
const SIDEWAYS = { [N]: E | W, [S]: E | W, [E]: N | S, [W]: N | S };

// Where an arrow press in `dir` from cell i lands: keep sliding straight until a
// wall is ahead, a side passage opens (a turn or junction), or the Target
// (`stop`) is reached, so long corridors take one press but the Target is never
// skipped. Assumes the first step is open.
export function slideTarget(open, i, dir, w, stop = -1) {
  const step = STEP(w)[dir];
  let j = i + step;
  while (j !== stop && open[j] & dir && !(open[j] & SIDEWAYS[dir])) j += step;
  return j;
}

// Side branches leaving the first half of the true path, and how many of those
// are real dead ends (at least 4 cells deep) rather than one-cell nooks.
export function earlyBranches({ w, h, open, path }) {
  const onPath = new Set(path);
  let branches = 0;
  let deep = 0;
  for (const c of path.slice(0, Math.floor(path.length / 2))) {
    for (const j of passages(open, c, w, h)) {
      if (onPath.has(j)) continue;
      branches++;
      let size = 0;
      const stack = [[j, c]];
      while (stack.length) {
        const [x, from] = stack.pop();
        size++;
        for (const y of passages(open, x, w, h)) if (y !== from) stack.push([y, x]);
      }
      if (size >= 4) deep++;
    }
  }
  return { branches, deep };
}

const CANDIDATES = 20;
// Bump to regenerate every maze (new layout and new square codes) from the same
// seed, e.g. after a change in how Targets are chosen.
export const LAYOUT_VERSION = 2;
const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Unguessable, seed-derived names for every square: `id` is the URL fragment
// (#code) marking the player's position, while `cell` (board square) and `pad`
// (that square's arrows) are unrelated CSS class names, so knowing one doesn't
// give away the others. `order` is a shuffled square order for emitting them.
// All start with a letter so they are valid CSS identifiers.
export function makeCodes(seed, n) {
  const rng = mulberry32(hashSeed(`${seed}:codes`));
  const used = new Set(['c', 'n', 'e', 's', 'w', 'b', 'g', 'io', 'in', 'out', 'mk', 'pad', 'ar', 'off', 'u', 'l', 'r', 'd', 'win', 'ctl', 'mz']);
  const code = () => {
    for (;;) {
      let s = CODE_CHARS[Math.floor(rng() * 26)];
      for (let k = 0; k < 7; k++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
      if (!used.has(s)) return used.add(s), s;
    }
  };
  const make = () => Array.from({ length: n }, code);
  return { id: make(), cell: make(), pad: make(), order: shuffle([...Array(n).keys()], rng) };
}

// Steps from `from` to every cell (every cell is reachable in a perfect maze).
function distances(open, w, h, from) {
  const dist = new Array(w * h).fill(-1);
  dist[from] = 0;
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const j of passages(open, cur, w, h)) {
      if (dist[j] === -1) {
        dist[j] = dist[cur] + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

// Cells in the middle of the grid: within 1.5 cells of the exact center (a 4x4
// block on even sizes, 3x3 on odd ones).
export function centralCells(w, h) {
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const cells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (Math.abs(x - cx) <= 1.5 && Math.abs(y - cy) <= 1.5) cells.push(y * w + x);
  }
  return cells;
}

// The Target: the central dead end (a "vault" off a passage) farthest from the
// entrance, or the farthest central cell if none of them is a dead end.
function centralTarget(open, w, h, dist) {
  const central = centralCells(w, h);
  const dead = central.filter((c) => passages(open, c, w, h).length === 1);
  return (dead.length ? dead : central).reduce((a, b) => (dist[b] > dist[a] ? b : a));
}

// The candidate layouts buildMaze chooses from, each with its central Target,
// the route to it, and how many real dead ends branch off that route early.
export function layoutCandidates(key, w, h) {
  const start = 0;
  return Array.from({ length: CANDIDATES }, (_, k) => {
    const open = carve(w, h, mulberry32(hashSeed(`${key}#${k}`)));
    const exit = centralTarget(open, w, h, distances(open, w, h, start));
    const maze = { w, h, open, start, exit, path: solve(open, w, h, start, exit) };
    return { maze, deep: earlyBranches(maze).deep };
  });
}

// Build the maze model. Deterministic for a given (seed, w, h). The Target is in
// the middle, which a direct route can reach quickly, so of a fixed set of
// candidate layouts keep those whose route covers at least a quarter of the grid
// (81 squares at 18x18), then pick the one with the most real dead ends branching
// off early (ties go to the longer route).
export function buildMaze({ seed = 'geocache', w = 18, h = 18 } = {}) {
  const key = `${seed}/v${LAYOUT_VERSION}`;
  const all = layoutCandidates(key, w, h);
  const long = all.filter(({ maze }) => maze.path.length >= Math.round((w * h) / 4));
  const best = (long.length ? long : all).reduce((a, b) =>
    b.deep > a.deep || (b.deep === a.deep && b.maze.path.length > a.maze.path.length) ? b : a
  );
  return { ...best.maze, codes: makeCodes(key, w * h) };
}

const CSS = `
*{box-sizing:border-box}
html{background:#f3e7c9;color:#2b1d0e}
body{margin:0;font:16px/1.5 Georgia,"Times New Roman",serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 40px;text-align:center}
h1{font-size:2.2rem;letter-spacing:.12em;text-transform:uppercase;margin:0 0 .5em}
.say{max-width:34em;margin:0 auto 1.1em;padding:14px 18px;text-align:left;background:#fdf8ea;border:1px solid #d9c49a;border-radius:4px;box-shadow:0 2px 8px rgba(60,35,5,.15)}
.say p{margin:0}
.say .who{font-weight:bold;margin-bottom:.3em}
.mk{display:none}
.b{display:inline-block;--s:min(calc((100vw - 40px)/var(--w)),34px)}
.io{font:bold 13px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7a4b12}
.in{display:flex;justify-content:space-between;align-items:flex-end}.out{text-align:right}
.t{font:bold 20px system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.02em;text-transform:none;color:#2b1d0e}
/* Countdown digit window (.cw) and its sliding strip (.cs). Short names like .d
   and .s are taken: .u/.l/.r/.d are the arrows and .n/.w/.e/.s are cell walls. */
.cw{display:inline-block;height:1.25em;overflow:hidden;vertical-align:bottom}
.cs{display:block;line-height:1.25em}
.armed{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;visibility:hidden}
.armed span{padding:12px 18px;border:2px solid #b23a3a;border-radius:10px;background:#fbe3e1;color:#7a1f1f;font:bold 1.25rem/1.35 Georgia,serif;text-align:center}
.g{display:grid;grid-template-columns:repeat(var(--w),var(--s));background:#fbf4e2;box-shadow:0 2px 10px rgba(60,35,5,.25)}
.c{width:var(--s);height:var(--s);border:0 solid #2b1d0e}
.tg{background:radial-gradient(circle closest-side,#b23a3a 0 28%,#fbe3e1 30% 52%,#b23a3a 54% 76%,transparent 78%)}
.key{display:inline-block;width:1.15em;height:1.15em;vertical-align:-.2em}
.n{border-top-width:2px}.w{border-left-width:2px}.e{border-right-width:2px}.s{border-bottom-width:2px}
.pad{display:grid;grid-template-columns:repeat(3,64px);grid-template-rows:repeat(3,64px);gap:8px;justify-content:center;margin:1.2em auto 0;position:relative}
.ar{display:flex;align-items:center;justify-content:center;border:2px solid #2b1d0e;border-radius:16px;background:#fff8e6;color:#2b1d0e;font:bold 30px/1 system-ui,sans-serif;text-decoration:none;user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.off{opacity:.25;border-style:dashed;pointer-events:none}
.u{grid-area:1/2}.l{grid-area:2/1}.r{grid-area:2/3}.d{grid-area:3/2}
a.ar{display:none;position:relative;z-index:1}
a.ar:active{background:#c9731a;color:#fff}
a.ar:focus-visible{outline:3px solid #1f4f8f;outline-offset:2px}
.win{display:none;margin:1em auto 0;max-width:520px;padding:12px;border:2px solid #2d6a2d;border-radius:10px;background:#e3f3dc;color:#173d17}
.win .got{margin:.1em 0 .6em;font-weight:bold;font-size:1.3rem}
.win .say{margin-bottom:.9em;color:#2b1d0e}
.win .say p+p{margin-top:.6em}
.reward summary{display:inline-block;list-style:none;cursor:pointer;padding:10px 22px;border-radius:999px;border:2px solid #173d17;background:#2d6a2d;color:#fff;font:bold 16px system-ui,sans-serif;letter-spacing:.03em}
.reward summary::-webkit-details-marker{display:none}
.reward summary:focus-visible{outline:3px solid #1f4f8f;outline-offset:2px}
.reward[open] summary{display:none}
.win img{display:block;max-width:100%;height:auto;margin:.2em auto 0;border-radius:6px}
.ctl{margin-top:1.2em}
.ctl a{display:inline-block;font:bold 15px system-ui,sans-serif;padding:8px 18px;border-radius:999px;border:2px solid #2b1d0e;background:#fff8e6;color:#2b1d0e;text-decoration:none}
.ctl a:focus-visible{outline:3px solid #1f4f8f;outline-offset:2px}
@media (max-width:600px){main{padding-top:12px}h1{margin-bottom:.3em}.say{margin-bottom:.8em;padding:10px 14px;font-size:15px}.pad{margin-top:.8em;grid-template-columns:repeat(3,58px);grid-template-rows:repeat(3,58px);gap:6px}}
`;

const ARROWS = [
  [N, 'u', '&uarr;', 'Up'],
  [W, 'l', '&larr;', 'Left'],
  [E, 'r', '&rarr;', 'Right'],
  [S, 'd', '&darr;', 'Down'],
];

// Shown on escape when MAZE_IMAGE isn't set.
const DEFAULT_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180" width="480" height="360">
<rect width="240" height="180" fill="#fbf4e2"/>
<g fill="#f4c542"><circle cx="40" cy="40" r="4"/><circle cx="200" cy="34" r="5"/><circle cx="214" cy="80" r="3"/><circle cx="28" cy="96" r="3"/></g>
<path d="M50 90h140v62a8 8 0 0 1-8 8H58a8 8 0 0 1-8-8z" fill="#8a4b1c" stroke="#2b1d0e" stroke-width="4"/>
<path d="M50 90c0-34 20-52 70-52s70 18 70 52z" fill="#a8602a" stroke="#2b1d0e" stroke-width="4"/>
<path d="M60 90c8-14 28-22 60-22s52 8 60 22" fill="#f4c542" stroke="#2b1d0e" stroke-width="3"/>
<path d="M70 38v122M170 38v122" stroke="#c9a227" stroke-width="8"/>
<path d="M50 90h140" stroke="#2b1d0e" stroke-width="4"/>
<rect x="108" y="84" width="24" height="30" rx="4" fill="#f4c542" stroke="#2b1d0e" stroke-width="3"/>
<circle cx="120" cy="96" r="4" fill="#2b1d0e"/><path d="M120 98v9" stroke="#2b1d0e" stroke-width="3"/>
</svg>`;
export const DEFAULT_IMAGE = {
  src: `data:image/svg+xml;base64,${Buffer.from(DEFAULT_IMAGE_SVG).toString('base64')}`,
  alt: 'A treasure chest',
};

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

// Inline an image file as a data: URL so the page stays a single self-contained
// document (nothing extra for the archive to fetch).
export function imageFromFile(file, alt = 'The prize') {
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error(`MAZE_IMAGE must be one of: ${Object.keys(IMAGE_TYPES).join(', ')}`);
  return { src: `data:${type};base64,${fs.readFileSync(file).toString('base64')}`, alt };
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// A no-JavaScript M:SS countdown. Each digit is a vertical strip of numbers in a
// one-line window, slid up by a CSS animation: ones every second, tens every 10s,
// minutes every 60s. Times are offset by 1s so "5:00" shows for the first second
// like a normal countdown, and trailing duplicates keep the final "0" in view
// after the last step. It starts on page load (a reload restarts it) and keeps
// running as the player moves, since moves only change the URL fragment.
// At 0:00 the arrow pad hides and "Lasers re-armed!" shows in its place.
export function countdown(minutes, exitId) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 9) throw new Error('minutes must be 1 to 9');
  const total = minutes * 60;
  const line = 1.25; // em per digit, matches .cs/.cw in CSS
  const strip = (cls, digits) =>
    `<span class="cw" aria-hidden="true"><span class="cs ${cls}">${digits.join('<br>')}</span></span>`;
  const up = (k) => `transform:translateY(-${+(k * line).toFixed(4)}em)`;

  const minuteDigits = [...Array(minutes + 1).keys()].reverse(); // M … 0
  const minuteFrames = ['0%{transform:none}'];
  for (let k = 0; k < minutes; k++) {
    minuteFrames.push(`${+(((1 + 60 * k) / total) * 100).toFixed(4)}%{${up(k + 1)}}`);
  }
  minuteFrames.push(`100%{${up(minutes)}}`);

  const html =
    `<span class="t" role="timer" aria-label="${minutes}-minute countdown">` +
    strip('tm', minuteDigits) +
    ':' +
    strip('t10', [5, 4, 3, 2, 1, 0, 0]) +
    strip('t1', [0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) +
    '</span>';
  const css =
    `@keyframes tm{${minuteFrames.join('')}}.tm{animation:tm ${total}s step-end forwards}` +
    `@keyframes t10{to{${up(6)}}}.t10{animation:t10 60s steps(6,end) -59s ${+((total + 59) / 60).toFixed(6)} forwards}` +
    `@keyframes t1{to{${up(10)}}}.t1{animation:t1 10s steps(10,end) ${total / 10} forwards}` +
    `@keyframes hurry{to{color:#b23a3a}}.t{animation:hurry 0s ${total - 60}s forwards}` +
    `@keyframes arm{to{visibility:hidden}}.pad{animation:arm 0s ${total}s forwards}` +
    `@keyframes alarm{to{visibility:visible}}.armed{animation:alarm 0s ${total}s forwards}` +
    `#${exitId}:target~.b .t,#${exitId}:target~.b .cs{animation-play-state:paused}`;
  const armed = '<div class="armed"><span>Lasers re-armed!</span></div>';
  return { html, css, armed };
}

// Render the full, self-contained HTML page for a maze.
export function renderMazePage(maze, { title = 'The Heist', image = DEFAULT_IMAGE, minutes = 5 } = {}) {
  const { w, h, open, start, exit, codes } = maze;
  const timer = countdown(minutes, codes.id[exit]);
  const n = w * h;
  // The outer wall has one opening, at the entrance (top of the start cell); the
  // Target is inside the maze and marked with a bullseye.
  const sides = open.slice();
  sides[start] |= N;

  const cells = [];
  for (let i = 0; i < n; i++) {
    const x = i % w, y = Math.floor(i / w);
    const cls = ['c', codes.cell[i]];
    if (i === exit) cls.push('tg');
    if (!(sides[i] & N)) cls.push('n');
    if (!(sides[i] & W)) cls.push('w');
    if (x === w - 1 && !(sides[i] & E)) cls.push('e');
    if (y === h - 1 && !(sides[i] & S)) cls.push('s');
    cells.push(`<div class="${cls.join(' ')}"></div>`);
  }

  // Everything else is emitted in a shuffled order, so neither the page source
  // nor the codes themselves reveal which code belongs to which square.
  const markers = [];
  const moves = [];
  const current = [];
  const shown = [];
  for (const i of codes.order) {
    markers.push(`<i class="mk" id="${codes.id[i]}"></i>`);
    for (const [dir, cl, glyph, label] of ARROWS) {
      if (open[i] & dir) {
        const to = codes.id[slideTarget(open, i, dir, w, exit)];
        moves.push(`<a href="#${to}" class="ar ${cl} ${codes.pad[i]}" aria-label="${label}">${glyph}</a>`);
      }
    }
    current.push(`#${codes.id[i]}:target~.b .${codes.cell[i]}`);
    shown.push(`#${codes.id[i]}:target~.pad a.${codes.pad[i]}`);
  }
  const placeholders = ARROWS.map(([, cl, glyph]) => `<span class="ar ${cl} off" aria-hidden="true">${glyph}</span>`);

  // With no #code in the URL the player stands at the entrance.
  const [startCell, startPad] = [codes.cell[start], codes.pad[start]];
  const dynamicCss =
    `.${startCell}{background:#c9731a}.mk:target~.b .${startCell}{background:none}` +
    `a.${startPad}{display:flex}.mk:target~.pad a.${startPad}{display:none}` +
    `${current.join(',')}{background:#c9731a}` +
    `${shown.join(',')}{display:flex}` +
    `#${codes.id[exit]}:target~.win{display:block}` +
    `#${codes.id[exit]}:target~.pad{display:none}` +
    timer.css;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${CSS}${dynamicCss}</style>
</head>
<body>
<main>
<h1>${title}</h1>
<section class="say">
<p class="who">Flabber Geese:</p>
<p>“Wow, you actually made it on time. I had very little faith in you. Well what are you waiting for? I disabled the lasers. Grab the target, then scram.”</p>
</section>
<div class="mz">
${markers.join('')}
<div class="b" style="--w:${w}">
<div class="io in"><span>Entrance &darr;</span>${timer.html}</div>
<div class="g">${cells.join('')}</div>
<div class="io out"><span class="tg key" aria-hidden="true"></span> Target</div>
</div>
<nav class="pad" aria-label="Move">${placeholders.join('')}${moves.join('')}${timer.armed}</nav>
<div class="win">
<p class="got">Target acquired!</p>
<section class="say">
<p class="who">Flabber Geese:</p>
<p>“I’m genuinely impressed. You did it. You stole their router. Now the Museum won’t have any Internet. They’re going to be so annoyed. Just imagine their faces.</p>
<p>“What are you still standing there for? Run!”</p>
</section>
<details class="reward"><summary>Claim Reward</summary><img src="${image.src}" alt="${escapeAttr(image.alt)}"></details>
</div>
<p class="ctl"><a href="#">Start over</a></p>
</div>
</main>
</body>
</html>
`;
}

let cached = null;

// The page configured via env vars, built once per process so every request
// (and every archive capture) sees the exact same maze.
//   MAZE_SEED       any string; sets the layout and the square codes. If unset,
//                   a private random seed is created once and kept in
//                   DATA_DIR/maze-seed (see resolveSeed).
//   MAZE_SIZE       "18" for 18x18 or "24x16" for width x height (5 to 40)
//   MAZE_IMAGE      picture shown on escape (png/jpg/gif/webp/svg); defaults to
//                   assets/maze-prize.png, or a treasure chest if that is missing
//   MAZE_IMAGE_ALT  alt text for that picture
// Resolved from the app directory (the service's WorkingDirectory): the server
// code is bundled into build/, so a path relative to this module won't work.
export const PRIZE_FILE = 'assets/maze-prize.png';

// MAZE_SEED if set. Otherwise a random seed generated on first use and stored
// next to the database, so it stays private (the code is public), survives
// restarts and deploys (the live maze keeps matching its archived capture), and
// needs no server setup. Delete the file only if you want a brand-new maze.
export function resolveSeed(env = process.env) {
  if (env.MAZE_SEED) return env.MAZE_SEED;
  const dir = env.DATA_DIR || path.join(process.cwd(), 'data');
  const file = path.join(dir, 'maze-seed');
  const read = () => fs.readFileSync(file, 'utf8').trim();
  if (fs.existsSync(file)) return read();
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(file, `${crypto.randomBytes(16).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err; // another process created it first
  }
  return read();
}

export function configuredMazePage(env = process.env) {
  if (!cached) {
    const { w, h } = parseSize(env.MAZE_SIZE);
    const maze = buildMaze({ seed: resolveSeed(env), w, h });
    const file = env.MAZE_IMAGE || (fs.existsSync(PRIZE_FILE) ? PRIZE_FILE : null);
    const image = file
      ? imageFromFile(path.resolve(file), env.MAZE_IMAGE_ALT || (env.MAZE_IMAGE ? undefined : 'QR code'))
      : DEFAULT_IMAGE;
    cached = renderMazePage(maze, { image });
  }
  return cached;
}
