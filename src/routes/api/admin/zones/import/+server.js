import { json, error } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, validPolygon, validSecret, decodeImage, pointInSF } from '$lib/server/config.js';

// Bulk-import zones from a JSON file: a bare array of zones, or
// { zones: [...], replace: bool }. Validated up front so the import is
// all-or-nothing (db.importZones runs in a transaction).
export async function POST({ request, url }) {
  requireAdmin(request, url);

  const body = await request.json().catch(() => null);
  if (body == null) throw error(400, 'File is not valid JSON.');

  const zones = Array.isArray(body) ? body : body.zones;
  const replace = Array.isArray(body) ? false : !!body.replace;
  if (!Array.isArray(zones) || zones.length === 0) throw error(400, 'No zones found in the file');
  if (zones.length > 500) throw error(400, 'Too many zones (max 500 per import)');

  const seenSecrets = new Set();
  const prepared = zones.map((z, i) => {
    const label = `Zone #${i + 1}${z?.name ? ` ("${String(z.name).trim()}")` : ''}`;
    const name = (z?.name || '').trim();
    const hint = (z?.hint || '').trim();
    if (!name) throw error(400, `${label}: a name is required.`);
    if (!validPolygon(z?.polygon)) {
      throw error(400, `${label}: polygon must have 3+ points inside San Francisco.`);
    }
    // A secret (as in an exported file) is kept so the zone's QR code keeps
    // working; zones without one get a fresh QR code.
    const secret = z?.secret == null || z.secret === '' ? null : z.secret;
    if (secret !== null) {
      if (!validSecret(secret)) {
        throw error(400, `${label}: "secret" must be 8-64 letters, digits, "-" or "_" (or leave it out for a new QR code).`);
      }
      if (seenSecrets.has(secret)) throw error(400, `${label}: another zone in this file has the same "secret".`);
      seenSecrets.add(secret);
    }
    // Only imageData (a base64 data URL) is an image; the export's `image` URL
    // field is ignored.
    const img = decodeImage(z?.imageData);
    const requirePresence = !!z?.requirePresence;
    let presenceLat = null;
    let presenceLng = null;
    if (requirePresence) {
      presenceLat = Number(z?.presenceLat);
      presenceLng = Number(z?.presenceLng);
      if (!Number.isFinite(presenceLat) || !Number.isFinite(presenceLng) || !pointInSF(presenceLat, presenceLng)) {
        throw error(400, `${label}: on-site zones need a claim spot inside San Francisco.`);
      }
    }
    return {
      name,
      hint,
      polygon: z.polygon,
      requirePresence,
      presenceLat,
      presenceLng,
      image: img?.image,
      imageType: img?.imageType,
      secret,
    };
  });

  let imported;
  try {
    imported = db.importZones(prepared, { replace });
  } catch (e) {
    if (e instanceof db.SecretTakenError) throw error(400, e.message);
    throw e;
  }
  return json({ imported, replaced: replace }, { status: 201 });
}
