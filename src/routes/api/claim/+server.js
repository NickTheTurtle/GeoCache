import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

// Claim a zone by its QR secret for the caller's crew.
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const zone = db.getZoneBySecret((body.secret || '').trim());
  if (!zone) throw error(404, 'Unknown QR code');
  const group = db.getGroupByToken((body.groupToken || '').trim());
  if (!group) throw error(400, 'Unknown crew. Open your crew link first.');

  const result = db.claimZone(zone.id, group.id);
  return json({ status: result.status, zone: { id: zone.id, name: zone.name } });
}
