// A deterministic, JavaScript-free maze puzzle served at /maze.
//
// The page is fully self-contained (inline CSS, no scripts or external assets)
// so it survives being captured by the Internet Archive's Wayback Machine.
// Movement uses fragment links and CSS :target. Each cell holds a link to
// #cN, and a hidden marker element with that id comes before the board, so the
// targeted marker is the player's position. Generated sibling selectors
// (#cN:target ~ .b .cM a) reveal only the links into open neighbouring cells.
// Hidden links can't be clicked and drop out of the Tab order, so mouse, touch
// and keyboard (Tab to pick a square, Enter to step) all respect the walls.
//
// Letters of the answer sit, in order, on the one true path from entrance to
// exit; decoy letters hide in dead ends. A letter only shows while standing on it.

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

// Perfect maze (exactly one route between any two cells) via an iterative
// recursive-backtracker. Each cell holds a bitmask of its open sides.
function carve(w, h, rng) {
  const open = new Array(w * h).fill(0);
  const seen = new Array(w * h).fill(false);
  const stack = [0];
  seen[0] = true;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const next = shuffle(neighbours(cur, w, h).filter(([, j]) => !seen[j]), rng);
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [dir, j] = next[0];
    open[cur] |= dir;
    open[j] |= OPPOSITE[dir];
    seen[j] = true;
    stack.push(j);
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

// "15" -> 15x15, "20x12" -> 20 wide by 12 tall. Clamped to a sane range.
export function parseSize(value, fallback = 15) {
  const m = /^\s*(\d+)\s*(?:[x×]\s*(\d+))?\s*$/i.exec(String(value ?? ''));
  const clamp = (n) => Math.min(40, Math.max(5, n));
  if (!m) return { w: fallback, h: fallback };
  const w = clamp(Number(m[1]));
  return { w, h: m[2] ? clamp(Number(m[2])) : w };
}

export function normalizeWord(word) {
  return String(word ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Build the maze model. Deterministic for a given (word, seed, w, h).
export function buildMaze({ word, seed = 'geocache', w = 15, h = 15 } = {}) {
  const answer = normalizeWord(word);
  if (!answer) throw new Error('Maze word must contain at least one letter or digit.');

  const start = 0;
  const exit = w * h - 1;
  // Retry with derived seeds until the true path is long enough to spread the
  // letters out (at least one blank cell between consecutive letters).
  for (let attempt = 0; attempt < 100; attempt++) {
    const rng = mulberry32(hashSeed(attempt ? `${seed}#${attempt}` : String(seed)));
    const open = carve(w, h, rng);
    const path = solve(open, w, h, start, exit);
    const k = answer.length;
    if (path.length - 2 < 2 * k) continue;

    const letters = new Map();
    for (let i = 0; i < k; i++) {
      letters.set(path[Math.round(((i + 1) * (path.length - 1)) / (k + 1))], answer[i]);
    }

    const onPath = new Set(path);
    const deadEnds = [];
    for (let i = 0; i < w * h; i++) {
      if (i === start || i === exit || onPath.has(i)) continue;
      if (passages(open, i, w, h).length === 1) deadEnds.push(i);
    }
    const decoyCount = Math.min(deadEnds.length, Math.max(k, Math.ceil(deadEnds.length / 2)));
    for (const i of shuffle(deadEnds, rng).slice(0, decoyCount)) {
      letters.set(i, ALPHABET[Math.floor(rng() * ALPHABET.length)]);
    }

    return { w, h, open, start, exit, path, letters, word: answer };
  }
  throw new Error(`A ${w}x${h} maze is too small for a ${answer.length}-letter word; increase MAZE_SIZE.`);
}

const CSS = `
*{box-sizing:border-box}
html{background:#f3e7c9;color:#2b1d0e}
body{margin:0;font:16px/1.5 Georgia,"Times New Roman",serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px;text-align:center}
h1{font-size:2.2rem;letter-spacing:.12em;text-transform:uppercase;margin:.2em 0}
.intro{max-width:34em;margin:0 auto 1.2em;text-align:left}
.intro li{margin:.2em 0}
.mk{display:none}
.b{display:inline-block;--s:min(calc((100vw - 40px)/var(--w)),34px)}
.io{font:bold 13px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7a4b12}
.in{text-align:left}.out{text-align:right}
.g{display:grid;grid-template-columns:repeat(var(--w),var(--s));background:#fbf4e2;box-shadow:0 2px 10px rgba(60,35,5,.25)}
.c{position:relative;width:var(--s);height:var(--s);display:flex;align-items:center;justify-content:center;border:0 solid #2b1d0e;user-select:none;-webkit-user-select:none;font:bold calc(var(--s)*.6)/1 system-ui,sans-serif}
.n{border-top-width:2px}.w{border-left-width:2px}.e{border-right-width:2px}.s{border-bottom-width:2px}
.c b{visibility:var(--vis,hidden);color:#fff}
.c a{position:absolute;inset:0;visibility:hidden;background:#f1d9a0}
.c a:hover{outline:2px solid #c9731a;outline-offset:-4px}
.c a:focus-visible{outline:3px solid #1f4f8f;outline-offset:-3px;background:#e8c46f}
.c0 a{visibility:visible}
.mk:target~.b .c0 a{visibility:hidden}
.win{display:none;margin:1.2em auto 0;max-width:30em;padding:14px 18px;border:2px solid #2d6a2d;border-radius:10px;background:#e3f3dc;color:#173d17}
.win strong{display:block;font-size:1.3rem}
.ctl{margin-top:1.2em}
.ctl a{display:inline-block;font:bold 15px system-ui,sans-serif;padding:8px 18px;border-radius:999px;border:2px solid #2b1d0e;background:#fff8e6;color:#2b1d0e;text-decoration:none}
.ctl a:focus-visible{outline:3px solid #1f4f8f;outline-offset:2px}
`;

// Render the full, self-contained HTML page for a maze.
export function renderMazePage(maze, { title = 'The Maze' } = {}) {
  const { w, h, open, start, exit, letters } = maze;
  const n = w * h;
  // The outer wall gets openings at the entrance (top of the start cell) and the
  // exit (bottom of the exit cell).
  const sides = open.slice();
  sides[start] |= N;
  sides[exit] |= S;

  const markers = [];
  const cells = [];
  const current = [];
  const adjacent = [];
  for (let i = 0; i < n; i++) {
    const x = i % w, y = Math.floor(i / w);
    markers.push(`<i class="mk" id="c${i}"></i>`);

    const cls = ['c', `c${i}`];
    if (!(sides[i] & N)) cls.push('n');
    if (!(sides[i] & W)) cls.push('w');
    if (x === w - 1 && !(sides[i] & E)) cls.push('e');
    if (y === h - 1 && !(sides[i] & S)) cls.push('s');
    const letter = letters.get(i);
    const link = `<a href="#c${i}" aria-label="Row ${y + 1}, column ${x + 1}"></a>`;
    cells.push(`<div class="${cls.join(' ')}">${link}${letter ? `<b>${letter}</b>` : ''}</div>`);

    current.push(`#c${i}:target~.b .c${i}`);
    for (const j of passages(open, i, w, h)) adjacent.push(`#c${i}:target~.b .c${j} a`);
  }

  const dynamicCss =
    `${adjacent.join(',')}{visibility:visible}` +
    `${current.join(',')}{background:#c9731a;--vis:visible}` +
    `#c${exit}:target~.win{display:block}`;

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
<ul class="intro">
<li>Enter at the top left and escape at the bottom right.</li>
<li>Tap or click a highlighted square next to you to move there.</li>
<li>On a keyboard, press Tab to cycle through the squares you can reach, then Enter to step.</li>
<li>Letters appear only while you stand on them. Dead ends hide decoys.</li>
<li>The letters on the one true path from entrance to exit, read in order, spell the answer.</li>
<li>Your browser's Back button undoes a move.</li>
</ul>
<div class="mz">
${markers.join('')}
<div class="b" style="--w:${w}">
<div class="io in">Start &darr;</div>
<div class="g">${cells.join('')}</div>
<div class="io out">&darr; Exit</div>
</div>
<div class="win"><strong>You escaped!</strong>Now retrace the only route from the entrance to the exit. Its letters, in order, are your answer.</div>
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
//   MAZE_WORD  the answer spelled along the true path (letters/digits)
//   MAZE_SEED  any string; change it to get a different layout
//   MAZE_SIZE  "15" for 15x15 or "20x12" for width x height (5 to 40)
export function configuredMazePage() {
  if (!cached) {
    const { w, h } = parseSize(process.env.MAZE_SIZE);
    const maze = buildMaze({
      word: process.env.MAZE_WORD || 'TREASURE',
      seed: process.env.MAZE_SEED || 'geocache',
      w,
      h,
    });
    cached = renderMazePage(maze);
  }
  return cached;
}
