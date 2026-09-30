import { json, error, isHttpError } from '@sveltejs/kit';
import * as db from '$lib/server/db.js';
import { requireAdmin, parseZone, validSecret } from '$lib/server/config.js';

// Bulk-import zones from a JSON file: a bare array of zones, or
// { zones: [...], replace: bool }. Validated up front so the import is
// all-or-nothing (db.importZones runs in a transaction).
export async function POST({ request, url }) {
  requireAdmin(request, url);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    // Over the server's upload limit (BODY_SIZE_LIMIT): say so, rather than
    // blaming the file's contents.
    if (e?.status === 413) {
      const bytes = Number(request.headers.get('content-length'));
      const size = bytes ? ` (${(bytes / 1024 / 1024).toFixed(1)} MB)` : '';
      throw error(413, `That file${size} is larger than this server accepts. Raise BODY_SIZE_LIMIT to import it.`);
    }
    throw error(400, 'File is not valid JSON.');
  }
  if (body == null) throw error(400, 'File is not valid JSON.');

  const zones = Array.isArray(body) ? body : body.zones;
  const replace = Array.isArray(body) ? false : !!body.replace;
  if (!Array.isArray(zones) || zones.length === 0) throw error(400, 'No zones found in the file');
  if (zones.length > 500) throw error(400, 'Too many zones (max 500 per import)');

  const seenSecrets = new Set();
  const prepared = zones.map((z, i) => {
    const label = `Zone #${i + 1}${z?.name ? ` ("${String(z.name).trim()}")` : ''}`;
    let zone;
    try {
      zone = parseZone(z); // only imageData (a base64 data URL) is read as an image
    } catch (e) {
      if (isHttpError(e)) throw error(e.status, `${label}: ${e.body.message}`);
      throw e;
    }
    // A secret (as in an exported file) is kept so the zone's QR code keeps
    // working; zones without one get a fresh QR code.
    const secret = z.secret == null || z.secret === '' ? null : z.secret;
    if (secret !== null) {
      if (!validSecret(secret)) {
        throw error(400, `${label}: "secret" must be 8-64 letters, digits, "-" or "_" (or leave it out for a new QR code).`);
      }
      if (seenSecrets.has(secret)) throw error(400, `${label}: another zone in this file has the same "secret".`);
      seenSecrets.add(secret);
    }
    return { ...zone, secret };
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
