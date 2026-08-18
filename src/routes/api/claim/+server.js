import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

// Claim a zone by its QR secret for the caller's crew.
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const zone = db.getZoneBySecret((body.secret || '').trim());
  if (!zone) throw error(404, 'Unknown QR code');
  const crew = db.getCrewByToken((body.crewToken || '').trim());
  if (!crew) throw error(400, 'Unknown crew. Open your crew link first.');

  const result = db.claimZone(zone.id, crew.id);
  return json({ status: result.status, first: result.first, points: result.points, zone: { id: zone.id, name: zone.name } });
}
