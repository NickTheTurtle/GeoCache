import * as db from '$lib/server/db.js';
import { requireAdmin } from '$lib/server/config.js';

// Download every zone as a re-importable JSON file. Auth works via the
// x-admin-password header or a signed ?t= token, so a plain <a download> link
// (which can't set headers) can trigger the download.
export function GET({ request, url }) {
  requireAdmin(request, url);
  const body = JSON.stringify({ zones: db.exportZones() }, null, 2);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="geocache-zones.json"',
      'Cache-Control': 'no-store',
    },
  });
}
