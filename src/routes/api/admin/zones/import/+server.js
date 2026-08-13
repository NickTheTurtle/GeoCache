import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, validPolygon, decodeImage } from '$lib/server/config.js';

// Bulk-import zones from a JSON file: a bare array of zones, or
// { zones: [...], replace: bool }. Validated up front so the import is
// all-or-nothing (db.importZones runs in a transaction).
export async function POST({ request, url }) {
  requireAdmin(request, url);

  const body = await request.json().catch(() => null);
  if (body == null) throw error(400, 'File is not valid JSON.');

  const zones = Array.isArray(body) ? body : body.zones;
  const replace = Array.isArray(body) ? false : !!body.replace;
  if (!Array.isArray(zones) || zones.length === 0) throw error(400, 'No zones found in the file');
  if (zones.length > 500) throw error(400, 'Too many zones (max 500 per import)');

  const prepared = zones.map((z, i) => {
    const label = `Zone #${i + 1}${z?.name ? ` ("${String(z.name).trim()}")` : ''}`;
    const name = (z?.name || '').trim();
    const hint = (z?.hint || '').trim();
    if (!name) throw error(400, `${label}: a name is required.`);
    if (!validPolygon(z?.polygon)) {
      throw error(400, `${label}: polygon must have 3+ points inside San Francisco.`);
    }
    // Only imageData (a base64 data URL) is an image; the export's `image` URL
    // field is ignored.
    const img = decodeImage(z?.imageData);
    return { name, hint, polygon: z.polygon, image: img?.image, imageType: img?.imageType };
  });

  const imported = db.importZones(prepared, { replace });
  return json({ imported, replaced: replace }, { status: 201 });
}
