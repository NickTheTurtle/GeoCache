import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'geocache.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS zones (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    hint       TEXT NOT NULL DEFAULT '',
    polygon    TEXT NOT NULL,           -- JSON: [[lat,lng], ...]
    secret     TEXT NOT NULL UNIQUE,    -- encoded in the QR code
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS claims (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id    INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (zone_id, group_id)   -- a group can claim a given zone only once
  );
`);

// Migration: hint images (added after initial release). Stored as a BLOB so
// there is no file/disk to manage; image_ver changes on every upload so cached
// <img> URLs bust automatically.
{
  const cols = db.prepare('PRAGMA table_info(zones)').all().map((c) => c.name);
  if (!cols.includes('image')) db.exec('ALTER TABLE zones ADD COLUMN image BLOB');
  if (!cols.includes('image_type')) db.exec('ALTER TABLE zones ADD COLUMN image_type TEXT');
  if (!cols.includes('image_ver')) db.exec('ALTER TABLE zones ADD COLUMN image_ver TEXT');
}

function newToken(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ---------- Groups ----------
export function createGroup(name) {
  const token = newToken();
  const info = db.prepare('INSERT INTO groups (name, token) VALUES (?, ?)').run(name, token);
  return getGroupById(info.lastInsertRowid);
}

export function getGroupById(id) {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
}

export function getGroupByToken(token) {
  return db.prepare('SELECT * FROM groups WHERE token = ?').get(token);
}

export function listGroups() {
  return db.prepare('SELECT id, name, token, created_at FROM groups ORDER BY name').all();
}

// ---------- Zones ----------
export function createZone({ name, hint, polygon, image, imageType }) {
  const secret = newToken(12);
  const hasImg = image && imageType;
  const info = db
    .prepare(
      'INSERT INTO zones (name, hint, polygon, secret, image, image_type, image_ver) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      name,
      hint || '',
      JSON.stringify(polygon),
      secret,
      hasImg ? image : null,
      hasImg ? imageType : null,
      hasImg ? newToken(4) : null
    );
  return getZoneById(info.lastInsertRowid);
}

// image handling: pass a Buffer + imageType to replace the image, removeImage
// to clear it, or neither to leave the existing image untouched.
export function updateZone(id, { name, hint, polygon, image, imageType, removeImage }) {
  db.prepare('UPDATE zones SET name = ?, hint = ?, polygon = ? WHERE id = ?').run(
    name,
    hint || '',
    JSON.stringify(polygon),
    id
  );
  if (removeImage) {
    db.prepare('UPDATE zones SET image = NULL, image_type = NULL, image_ver = NULL WHERE id = ?').run(id);
  } else if (image && imageType) {
    db.prepare('UPDATE zones SET image = ?, image_type = ?, image_ver = ? WHERE id = ?').run(
      image,
      imageType,
      newToken(4),
      id
    );
  }
  return getZoneById(id);
}

export function getZoneImage(id) {
  return db.prepare('SELECT image, image_type FROM zones WHERE id = ?').get(id);
}

export function deleteZone(id) {
  // Claims are removed automatically via ON DELETE CASCADE (foreign_keys = ON).
  return db.prepare('DELETE FROM zones WHERE id = ?').run(id);
}

// ---------- Bulk import / export ----------
// Dump every zone in the portable shape the import endpoint accepts: name,
// hint, polygon, and (when present) the hint image as a base64 data URL. This
// makes an export a complete, re-importable backup. Secrets are intentionally
// omitted — fresh ones are minted on import so QR codes never collide.
export function exportZones() {
  const rows = db
    .prepare('SELECT name, hint, polygon, image, image_type FROM zones ORDER BY id')
    .all();
  return rows.map((r) => {
    const zone = { name: r.name, hint: r.hint, polygon: JSON.parse(r.polygon) };
    if (r.image && r.image_type) {
      zone.imageData = `data:${r.image_type};base64,${Buffer.from(r.image).toString('base64')}`;
    }
    return zone;
  });
}

// Insert many pre-validated zones in a single transaction (all-or-nothing).
// When replace is true, existing zones (and their claims, via cascade) are
// cleared first. Each entry: { name, hint, polygon, image?, imageType? }.
export function importZones(zones, { replace = false } = {}) {
  db.exec('BEGIN');
  try {
    if (replace) db.exec('DELETE FROM zones');
    for (const z of zones) createZone(z);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return zones.length;
}

// Strip the binary image columns from a raw zone row and parse its polygon,
// giving the JSON shape the admin API returns for a single zone.
export function zonePublic(zone) {
  const { image, image_type, ...rest } = zone;
  return { ...rest, polygon: JSON.parse(rest.polygon) };
}

export function getZoneById(id) {
  return db.prepare('SELECT * FROM zones WHERE id = ?').get(id);
}

export function getZoneBySecret(secret) {
  return db.prepare('SELECT * FROM zones WHERE secret = ?').get(secret);
}

// Crews that have claimed a single zone, earliest first (used by the claim page).
export function getZoneClaimers(zoneId) {
  return db
    .prepare(
      `SELECT c.group_id AS id, g.name AS name, c.created_at AS at
         FROM claims c
         JOIN groups g ON g.id = c.group_id
        WHERE c.zone_id = ?
        ORDER BY c.created_at`
    )
    .all(zoneId);
}

// Public zone list with claim info (never leaks the secret).
// Each zone can be claimed by multiple groups; claimedBy is an array.
export function listZonesPublic() {
  const rows = db
    .prepare(
      `SELECT z.id, z.name, z.hint, z.polygon, z.image_ver,
              c.group_id AS claimed_group_id,
              g.name     AS claimed_group_name,
              c.created_at AS claimed_at
         FROM zones z
         LEFT JOIN claims c ON c.zone_id = z.id
         LEFT JOIN groups g ON g.id = c.group_id
        ORDER BY z.id, c.created_at`
    )
    .all();

  const byId = new Map();
  for (const r of rows) {
    let zone = byId.get(r.id);
    if (!zone) {
      zone = {
        id: r.id,
        name: r.name,
        hint: r.hint,
        polygon: JSON.parse(r.polygon),
        image: r.image_ver ? `/api/zones/${r.id}/image?v=${r.image_ver}` : null,
        claimedBy: [],
      };
      byId.set(r.id, zone);
    }
    if (r.claimed_group_id) {
      zone.claimedBy.push({ id: r.claimed_group_id, name: r.claimed_group_name, at: r.claimed_at });
    }
  }
  return [...byId.values()];
}

// Admin list (includes secret so QR codes can be generated, and current claimers).
export function listZonesAdmin() {
  const rows = db
    .prepare(
      `SELECT z.id, z.name, z.hint, z.polygon, z.secret, z.image_ver,
              c.group_id AS claimed_group_id,
              g.name     AS claimed_group_name
         FROM zones z
         LEFT JOIN claims c ON c.zone_id = z.id
         LEFT JOIN groups g ON g.id = c.group_id
        ORDER BY z.id, c.created_at`
    )
    .all();

  const byId = new Map();
  for (const r of rows) {
    let zone = byId.get(r.id);
    if (!zone) {
      zone = {
        id: r.id,
        name: r.name,
        hint: r.hint,
        polygon: JSON.parse(r.polygon),
        secret: r.secret,
        image: r.image_ver ? `/api/zones/${r.id}/image?v=${r.image_ver}` : null,
        claimedBy: [],
      };
      byId.set(r.id, zone);
    }
    if (r.claimed_group_id) {
      zone.claimedBy.push({ id: r.claimed_group_id, name: r.claimed_group_name });
    }
  }
  return [...byId.values()];
}

// ---------- Claims ----------
// Multiple groups may claim the same zone, but each group only once.
// INSERT OR IGNORE + the UNIQUE(zone_id, group_id) constraint makes this
// idempotent and race-proof (no check-then-insert window, no duplicate points).
// created_at is stamped with millisecond precision so the leaderboard can break
// ties by who reached their score first.
// Returns { status: 'claimed' | 'already-yours' }
export function claimZone(zoneId, groupId) {
  const info = db
    .prepare(
      "INSERT OR IGNORE INTO claims (zone_id, group_id, created_at) VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))"
    )
    .run(zoneId, groupId);
  return { status: info.changes > 0 ? 'claimed' : 'already-yours' };
}

export function unclaimZone(zoneId, groupId) {
  const info = db
    .prepare('DELETE FROM claims WHERE zone_id = ? AND group_id = ?')
    .run(zoneId, groupId);
  return { removed: info.changes > 0 };
}

export function leaderboard() {
  // Rank by points, then break ties by whoever reached that score first: the
  // crew whose most-recent claim (MAX created_at) is earliest ranks higher.
  // Crews with no claims (NULL) fall to the bottom of the tie.
  return db
    .prepare(
      `SELECT g.id, g.name,
              COUNT(c.id) AS points,
              MAX(c.created_at) AS last_claim_at
         FROM groups g
         LEFT JOIN claims c ON c.group_id = g.id
        GROUP BY g.id
        ORDER BY points DESC,
                 (last_claim_at IS NULL) ASC,
                 last_claim_at ASC,
                 g.name ASC`
    )
    .all();
}

// Reset the game. Always clears claims and groups; optionally keeps zones.
export function resetGame({ keepZones = true } = {}) {
  db.exec('DELETE FROM claims');
  db.exec('DELETE FROM groups');
  if (!keepZones) db.exec('DELETE FROM zones');
}

export { db };
