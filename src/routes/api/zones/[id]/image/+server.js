import { error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

// Serve a zone's hint image. Public (hints/images are not secret). The URL
// carries a ?v= version token that changes on every upload, so the immutable
// cache is safe.
export function GET({ params }) {
  const row = db.getZoneImage(Number(params.id));
  if (!row || !row.image) throw error(404, 'No image');
  return new Response(Buffer.from(row.image), {
    headers: {
      'Content-Type': row.image_type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
