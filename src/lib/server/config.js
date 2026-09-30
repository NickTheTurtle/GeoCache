import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { error } from '@sveltejs/kit';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// San Francisco bounding box (approx). [south, west, north, east]
export const SF_BOUNDS = { south: 37.7, west: -122.52, north: 37.83, east: -122.35 };

// TLS certs live in ./certs (created by `npm run gen-cert`). When present the
// custom launcher serves HTTPS on 443, which is what QR URLs should point at.
const keyPath = path.join(process.cwd(), 'certs', 'key.pem');
const certPath = path.join(process.cwd(), 'certs', 'cert.pem');
export const httpsEnabled = fs.existsSync(keyPath) && fs.existsSync(certPath);
export const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);
const PORT = Number(process.env.PORT || 3000);

// Short-lived signed tokens let <img>/<a> tags (which can't set headers) prove
// admin access without putting the password in the URL, where it would leak via
// server logs, browser history and Referer headers. Signed with the admin
// password so no extra secret/storage is needed; default lifetime 12h.
export function makeAdminToken(ttlMs = 12 * 60 * 60 * 1000) {
  const exp = String(Date.now() + ttlMs);
  const sig = crypto.createHmac('sha256', ADMIN_PASSWORD).update(exp).digest('base64url');
  return `${exp}.${sig}`;
}

function validAdminToken(tok) {
  if (!tok) return false;
  const dot = tok.indexOf('.');
  if (dot < 0) return false;
  const exp = tok.slice(0, dot);
  const sig = tok.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expect = crypto.createHmac('sha256', ADMIN_PASSWORD).update(exp).digest('base64url');
  return (
    sig.length === expect.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))
  );
}

// Constant-time check of a supplied admin password. Both sides are hashed first
// so the comparison always runs over equal-length buffers.
export function checkPassword(supplied) {
  const digest = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest();
  return crypto.timingSafeEqual(digest(supplied), digest(ADMIN_PASSWORD));
}

// True when the request carries valid admin credentials: the x-admin-password
// header, or a signed ?t= token. Tokens exist only for <img>/<a> download URLs
// (QR codes, zone export) that can't set headers, so they are accepted for
// read-only GET requests and never for changes.
export function isAdmin(request, url) {
  if (checkPassword(request.headers.get('x-admin-password'))) return true;
  return request.method === 'GET' && validAdminToken(url.searchParams.get('t'));
}

// Reject non-admin requests (see isAdmin for what counts as admin).
export function requireAdmin(request, url) {
  if (!isAdmin(request, url)) throw error(401, 'Bad admin password');
}

export function pointInSF(lat, lng) {
  return (
    lat >= SF_BOUNDS.south &&
    lat <= SF_BOUNDS.north &&
    lng >= SF_BOUNDS.west &&
    lng <= SF_BOUNDS.east
  );
}

// Limits on admin-supplied zone fields, enforced server-side for every way a zone
// is written (create, edit, import).
export const ZONE_LIMITS = { name: 60, hint: 5000, points: 1000 };

// Validate and normalize a zone payload from the admin UI or an import file.
// Returns the fields db.createZone/updateZone expect, or throws a 400 with a
// message fit to show the admin.
export function parseZone(body) {
  const name = String(body?.name ?? '').trim();
  const hint = String(body?.hint ?? '').trim();
  if (!name) throw error(400, 'Zone name is required.');
  if (name.length > ZONE_LIMITS.name) throw error(400, `Zone name must be ${ZONE_LIMITS.name} characters or fewer.`);
  if (hint.length > ZONE_LIMITS.hint) throw error(400, `Hint must be ${ZONE_LIMITS.hint} characters or fewer.`);
  if (!validPolygon(body?.polygon)) throw error(400, 'Polygon must have 3+ points inside San Francisco.');
  if (body.polygon.length > ZONE_LIMITS.points) {
    throw error(400, `Polygon must have ${ZONE_LIMITS.points} points or fewer.`);
  }

  const requirePresence = !!body.requirePresence;
  let presenceLat = null;
  let presenceLng = null;
  if (requirePresence) {
    presenceLat = Number(body.presenceLat);
    presenceLng = Number(body.presenceLng);
    if (!Number.isFinite(presenceLat) || !Number.isFinite(presenceLng) || !pointInSF(presenceLat, presenceLng)) {
      throw error(400, 'Set a claim spot inside San Francisco for on-site zones.');
    }
  }

  const img = decodeImage(body.imageData);
  return { name, hint, polygon: body.polygon, requirePresence, presenceLat, presenceLng, image: img?.image, imageType: img?.imageType };
}

// A zone QR secret supplied in an import file. Generated secrets are 16
// URL-safe base64 characters; accept 8-64 of the same alphabet so the value is
// safe in a ?c= claim URL, readable by the QR scanner, and not trivially short.
export function validSecret(secret) {
  return typeof secret === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(secret);
}

export function validPolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  return polygon.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1]) &&
      pointInSF(p[0], p[1])
  );
}

// Great-circle distance in metres between two lat/lng points. Used to check a
// employee is near a zone's admin-placed claim spot.
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Max decoded image size (~4MB) for a hint image.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Decode a base64 data URL (e.g. "data:image/png;base64,....") into a Buffer +
// mime type. Throws a 400 on malformed input, non-image types, or oversize.
// Returns null when the input is empty/falsy (no image supplied).
export function decodeImage(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw error(400, 'Invalid image data');
  const mime = m[1].toLowerCase();
  if (!mime.startsWith('image/')) throw error(400, 'Only image files are allowed.');
  // SVGs can carry scripts and are served inline from our own origin, so reject
  // them to avoid a stored-XSS vector via hint images.
  if (mime === 'image/svg+xml') throw error(400, 'SVG images are not allowed.');
  let buf;
  try {
    buf = Buffer.from(m[2], 'base64');
  } catch {
    throw error(400, 'Invalid image data');
  }
  if (!buf.length) throw error(400, 'Invalid image data');
  if (buf.length > MAX_IMAGE_BYTES) throw error(400, 'Image is too large (max 4MB).');
  return { image: buf, imageType: mime };
}

// First non-internal IPv4 address, so QR codes point at a phone-reachable host.
function lanIPv4() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

// Build the claim URL a QR code should encode. Prefers PUBLIC_BASE_URL, then a
// LAN IP (so phones can reach it even when admin browses via localhost), then
// falls back to the request origin.
export function claimUrl(url, zone) {
  const suffix = `/?c=${zone.secret}`;
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (base) return `${base}${suffix}`;
  const ip = lanIPv4();
  if (ip) {
    const scheme = httpsEnabled ? 'https' : 'http';
    const activePort = httpsEnabled ? HTTPS_PORT : PORT;
    const portPart =
      (scheme === 'https' && activePort === 443) || (scheme === 'http' && activePort === 80)
        ? ''
        : `:${activePort}`;
    return `${scheme}://${ip}${portPart}${suffix}`;
  }
  return `${url.origin}${suffix}`;
}
