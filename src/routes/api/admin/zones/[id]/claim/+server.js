import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin } from '$lib/server/config.js';

// Manually claim a zone for a crew (no QR scan needed).
export async function POST({ request, url, params }) {
  requireAdmin(request, url);
  const id = Number(params.id);
  if (!db.getZoneById(id)) throw error(404, 'Zone not found');
  const body = await request.json().catch(() => ({}));
  const group = db.getGroupById(Number(body.groupId));
  if (!group) throw error(400, 'Unknown crew');
  const result = db.claimZone(id, group.id);
  return json({ ...result, group: { id: group.id, name: group.name } });
}
