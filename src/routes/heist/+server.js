import { configuredMazePage } from '$lib/server/maze.js';

// Served as a raw, self-contained HTML document (no SvelteKit layout or
// client JS) so it can be archived by the Wayback Machine and still work.
const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=3600',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // The page has no scripts and only inline styles and data: images.
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
};

export function GET() {
  return new Response(configuredMazePage(), { headers: HEADERS });
}
