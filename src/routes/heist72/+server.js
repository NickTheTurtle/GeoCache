import { configuredMazePage } from '$lib/server/maze.js';

// The heist maze, served as a raw, self-contained HTML document (no SvelteKit
// layout or client JS) so the Wayback Machine can capture it and it still works.
const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  // Short, so browsers drop it quickly if the maze is taken down again.
  'cache-control': 'public, max-age=60',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // The page has no scripts and only inline styles and data: images.
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
};

export function GET() {
  return new Response(configuredMazePage(), { headers: HEADERS });
}
