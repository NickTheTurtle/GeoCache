export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Render a hint with limited, safe Markdown (bold + italic only). The text is
// HTML-escaped FIRST so raw hint content can never inject markup, then the
// bold/italic delimiters are turned into <strong>/<em>. Newlines are left as-is
// (.popup-hint CSS uses white-space: pre-wrap). Escape a delimiter with a
// backslash to keep it literal: "\*" -> * and "\_" -> _ (handy for fill-in
// blanks like "\_ \_ \_" or "3 \* 4").
export function renderHint(s) {
  let out = escapeHtml(s == null ? '' : s);
  // Set escaped delimiters aside as placeholders (private-use chars) so they are
  // never parsed as markdown, then restore them as literals at the end.
  const STAR = '\uE000';
  const UNDER = '\uE001';
  out = out.replace(/\\([*_])/g, (_, ch) => (ch === '*' ? STAR : UNDER));
  out = out
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([\s\S]+?)__/g, '<strong>$1</strong>')
    .replace(/\*([\s\S]+?)\*/g, '<em>$1</em>')
    .replace(/(?<![A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/g, '<em>$1</em>');
  return out.split(STAR).join('*').split(UNDER).join('_');
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
