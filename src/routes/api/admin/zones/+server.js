import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, validPolygon, decodeImage } from '$lib/server/config.js';

export function GET({ request, url }) {
  requireAdmin(request, url);
  return json(db.listZonesAdmin());
}

export async function POST({ request, url }) {
  requireAdmin(request, url);
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  const hint = (body.hint || '').trim();
  const polygon = body.polygon;
  if (!name) throw error(400, 'Zone name is required.');
  if (!validPolygon(polygon)) {
    throw error(400, 'Polygon must have 3+ points inside San Francisco.');
  }
  const img = decodeImage(body.imageData);
  const zone = db.createZone({ name, hint, polygon, image: img?.image, imageType: img?.imageType });
  return json(db.zonePublic(zone), { status: 201 });
}
