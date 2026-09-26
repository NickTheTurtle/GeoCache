import { configuredMazePage } from '$lib/server/maze.js';

// Served as a raw, self-contained HTML document (no SvelteKit layout or
// client JS) so it can be archived by the Wayback Machine and still work.
export function GET() {
  return new Response(configuredMazePage(), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
