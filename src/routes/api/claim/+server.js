import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { haversineMeters } from '$lib/server/config.js';

// How close (metres) a crew must be to the admin-placed claim spot. The
// device's own reported accuracy widens this when larger, capped so a wildly
// inaccurate fix can't defeat the geofence.
const CLAIM_RADIUS_M = 40;
const MAX_ACCURACY_M = 100;

// Claim a zone by its QR secret for the caller's crew.
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const zone = db.getZoneBySecret((body.secret || '').trim());
  if (!zone) throw error(404, 'Unknown QR code');
  const crew = db.getCrewByToken((body.crewToken || '').trim());
  if (!crew) throw error(400, 'Unknown crew. Open your crew link first.');

  // Geofenced zones: the crew must be near the admin-placed claim spot.
  if (zone.require_presence && Number.isFinite(zone.presence_lat) && Number.isFinite(zone.presence_lng)) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ status: 'needs-location', zone: { id: zone.id, name: zone.name } });
    }
    const distance = haversineMeters(lat, lng, zone.presence_lat, zone.presence_lng);
    const allowed = Math.max(CLAIM_RADIUS_M, Math.min(Number(body.accuracy) || 0, MAX_ACCURACY_M));
    if (distance > allowed) {
      return json({
        status: 'too-far',
        distance: Math.round(distance),
        zone: { id: zone.id, name: zone.name },
      });
    }
  }

  const result = db.claimZone(zone.id, crew.id);
  return json({ status: result.status, first: result.first, points: result.points, zone: { id: zone.id, name: zone.name } });
}
