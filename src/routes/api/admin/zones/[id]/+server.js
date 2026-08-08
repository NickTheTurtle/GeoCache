import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, validPolygon, decodeImage } from '$lib/server/config.js';

export async function PUT({ request, url, params }) {
  requireAdmin(request, url);
  const id = Number(params.id);
  if (!db.getZoneById(id)) throw error(404, 'Zone not found');
  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  const hint = (body.hint || '').trim();
  const polygon = body.polygon;
  if (!name) throw error(400, 'Zone name is required');
  if (!validPolygon(polygon)) {
    throw error(400, 'Polygon must have 3+ points inside San Francisco');
  }
  const img = decodeImage(body.imageData);
  const zone = db.updateZone(id, {
    name,
    hint,
    polygon,
    image: img?.image,
    imageType: img?.imageType,
    removeImage: !!body.removeImage,
  });
  return json(db.zonePublic(zone));
}

export function DELETE({ request, url, params }) {
  requireAdmin(request, url);
  const id = Number(params.id);
  if (!db.getZoneById(id)) throw error(404, 'Zone not found');
  db.deleteZone(id);
  return json({ ok: true });
}
