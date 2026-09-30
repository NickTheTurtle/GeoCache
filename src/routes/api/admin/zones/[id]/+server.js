import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, parseZone } from '$lib/server/config.js';

export async function PUT({ request, url, params }) {
  requireAdmin(request, url);
  const id = Number(params.id);
  const body = await request.json().catch(() => ({}));
  // Read the body before checking the zone exists: SQLite calls are synchronous, so
  // nothing (like a delete) can run between the check and the write below.
  if (!db.getZoneById(id)) throw error(404, 'Zone not found');
  const zone = db.updateZone(id, { ...parseZone(body), removeImage: !!body.removeImage });
  return json(db.zonePublic(zone));
}

export function DELETE({ request, url, params }) {
  requireAdmin(request, url);
  const id = Number(params.id);
  if (!db.getZoneById(id)) throw error(404, 'Zone not found');
  db.deleteZone(id);
  return json({ ok: true });
}
