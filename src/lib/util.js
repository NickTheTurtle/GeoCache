export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Render a hint with limited, safe Markdown. The text is HTML-escaped FIRST so
// raw hint content can never inject markup, then a small set of inline features
// is rendered:
//   - **bold** / __bold__  ->  <strong>
//   - *italic* / _italic_  ->  <em>
//   - ^text^               ->  <sup> (superscript; no spaces inside)
//   - ~text~               ->  <sub> (subscript; no spaces inside)
//   - [label](url)         ->  <a> (http/https/mailto only, opens in a new tab)
// Newlines are left as-is (.popup-hint CSS uses white-space: pre-wrap). Escape a
// delimiter with a backslash to keep it literal: "\*" -> *, "\_" -> _, "\^" -> ^
// and "\~" -> ~ (handy for fill-in blanks like "\_ \_ \_" or "3 \* 4").
//
// A delimiter-stack parser (rather than sequential regex replacement) keeps the
// output well-formed: emphasis is always properly nested, and unbalanced or
// mid-word delimiters degrade to literal text instead of leaking stray markup.
const STAR = '\uE000';
const UNDER = '\uE001';
const HOLE_OPEN = '\uE002';
const HOLE_CLOSE = '\uE003';
const CARET = '\uE004';
const TILDE = '\uE005';
const isWordChar = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch);

// Accept only http(s)/mailto links so a hint can't inject javascript:/data: URLs.
// `url` is already HTML-escaped, so quotes/angle brackets can't break the href.
function safeUrl(url) {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
}

export function renderHint(s) {
  // Rendered fragments (links, sup, sub) are set aside as placeholders so their
  // inner text is never touched by emphasis parsing, then restored at the end.
  const holes = [];
  const pushHole = (html) => {
    holes.push(html);
    return `${HOLE_OPEN}${holes.length - 1}${HOLE_CLOSE}`;
  };
  const text = escapeHtml(s == null ? '' : s)
    // Pull [label](url) links out first (as placeholders) so URLs aren't touched
    // by emphasis parsing; unsafe or malformed links stay literal.
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const href = safeUrl(url);
      if (!href) return m;
      return pushHole(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    })
    // Set escaped delimiters aside as private-use placeholders so they are never
    // parsed as markdown; restored as literals at the end.
    .replace(/\\([*_^~])/g, (_, ch) =>
      ch === '*' ? STAR : ch === '_' ? UNDER : ch === '^' ? CARET : TILDE
    )
    // ^superscript^ and ~subscript~ (Pandoc-style): the content may not contain
    // whitespace or the delimiter, so a stray ^ or ~ stays literal.
    .replace(/\^([^\s^]+)\^/g, (_, inner) => pushHole(`<sup>${inner}</sup>`))
    .replace(/~([^\s~]+)~/g, (_, inner) => pushHole(`<sub>${inner}</sub>`));

  // Tokenize into text nodes and delimiter runs.
  const nodes = [];
  let buf = '';
  const flush = () => { if (buf) { nodes.push({ text: buf }); buf = ''; } };
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === '*' || ch === '_') {
      let j = i + 1;
      while (text[j] === ch) j++;
      // Underscores inside a word (snake_case) are literal, not emphasis: an
      // opener needs a non-word char before it, a closer a non-word char after.
      const canOpen = ch === '*' || !isWordChar(text[i - 1]);
      const canClose = ch === '*' || !isWordChar(text[j]);
      if (canOpen || canClose) {
        flush();
        nodes.push({ ch, count: j - i, canOpen, canClose });
      } else {
        buf += ch.repeat(j - i);
      }
      i = j;
    } else {
      buf += ch;
      i++;
    }
  }
  flush();

  matchEmphasis(nodes);

  let out = '';
  for (const n of nodes) out += n.text ?? n.ch.repeat(n.count);
  return out
    .split(STAR).join('*')
    .split(UNDER).join('_')
    .split(CARET).join('^')
    .split(TILDE).join('~')
    .replace(new RegExp(`${HOLE_OPEN}(\\d+)${HOLE_CLOSE}`, 'g'), (_, i) => holes[i]);
}

// Pair delimiter runs into <strong>/<em>, closest-opener first. Consumes two
// markers for bold when both runs allow it, otherwise one for italic; leftover
// markers stay literal. Mutates `nodes` in place.
function matchEmphasis(nodes) {
  const serialize = (from, to) => {
    let s = '';
    for (let k = from; k < to; k++) s += nodes[k].text ?? nodes[k].ch.repeat(nodes[k].count);
    return s;
  };
  for (let ci = 0; ci < nodes.length; ci++) {
    const closer = nodes[ci];
    if (closer.text || !closer.canClose) continue;
    let oi = ci - 1;
    while (oi >= 0 && !(nodes[oi].canOpen && nodes[oi].ch === closer.ch)) oi--;
    if (oi < 0) continue;
    const opener = nodes[oi];
    const strong = opener.count >= 2 && closer.count >= 2;
    const use = strong ? 2 : 1;
    const wrapped = strong
      ? `<strong>${serialize(oi + 1, ci)}</strong>`
      : `<em>${serialize(oi + 1, ci)}</em>`;
    opener.count -= use;
    closer.count -= use;
    const replacement = [{ text: wrapped }];
    if (closer.count > 0) replacement.push(closer);
    nodes.splice(oi + 1, ci - oi, ...replacement);
    if (opener.count === 0) nodes.splice(oi, 1);
    ci = oi; // re-scan from the opener so leftover/outer markers can still match
  }
}

// Shared zone polygon styling for the main map. Only zones the current crew has
// claimed are highlighted; everything else looks the same (unclaimed style) so
// you can't tell what other crews have taken.
export function zoneStyle(z, currentCrew) {
  const mine = currentCrew && z.claimedBy.some((c) => c.id === currentCrew.id);
  return {
    color: mine ? '#1f6f8f' : '#123a5c',
    weight: mine ? 5 : 3,
    opacity: 0.95,
    fillColor: mine ? '#2a7ea3' : '#3f6f52',
    fillOpacity: mine ? 0.3 : 0.16,
    lineJoin: 'round',
    lineCap: 'round',
  };
}

export const CHECK_ICON =
  '<svg class="ico-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

// Pull the zone secret out of a scanned QR code. Codes encode a full claim
// URL (/claim?c=<secret>), but we also accept a bare secret string.
export function extractSecret(text) {
  const raw = (text || '').trim();
  try {
    const u = new URL(raw, typeof location !== 'undefined' ? location.origin : 'http://localhost');
    const c = u.searchParams.get('c');
    if (c) return c;
  } catch {
    /* not a URL */
  }
  if (/^[A-Za-z0-9_-]{6,}$/.test(raw)) return raw;
  return null;
}
