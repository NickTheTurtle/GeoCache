import { renderHeistNote } from '$lib/server/heistNote.js';

// The live page is a note sending players to the Wayback Machine capture of
// this URL, which still holds the maze. Served as a raw, self-contained HTML
// document (no SvelteKit layout or client JS).
const page = renderHeistNote();

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  // Short, so browsers that cached the old maze (or this note) refresh quickly.
  'cache-control': 'public, max-age=60',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
};

export function GET() {
  return new Response(page, { headers: HEADERS });
}
