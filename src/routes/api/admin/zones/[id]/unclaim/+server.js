import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin } from '$lib/server/config.js';

// Manually unclaim a zone for a crew.
export async function POST({ request, url, params }) {
  requireAdmin(request, url);
  const id = Number(params.id);
  if (!db.getZoneById(id)) throw error(404, 'Zone not found');
  const body = await request.json().catch(() => ({}));
  const crew = db.getCrewById(Number(body.crewId));
  if (!crew) throw error(400, 'Unknown crew');
  const result = db.unclaimZone(id, crew.id);
  return json(result);
}
