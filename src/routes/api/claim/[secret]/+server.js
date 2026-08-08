import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';

// Look up a zone by its QR secret (used by the claim landing page).
export function GET({ params }) {
  const zone = db.getZoneBySecret(params.secret);
  if (!zone) throw error(404, 'Unknown QR code');
  return json({ id: zone.id, name: zone.name, hint: zone.hint, claimedBy: db.getZoneClaimers(zone.id) });
}
