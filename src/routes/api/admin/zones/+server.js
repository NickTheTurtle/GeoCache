import { json } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, parseZone } from '$lib/server/config.js';

export function GET({ request, url }) {
  requireAdmin(request, url);
  return json(db.listZonesAdmin());
}

export async function POST({ request, url }) {
  requireAdmin(request, url);
  const body = await request.json().catch(() => ({}));
  const zone = db.createZone(parseZone(body));
  return json(db.zonePublic(zone), { status: 201 });
}
