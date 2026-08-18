import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'geocache.db'));

// Scoring: solving any puzzle is worth SOLVE_POINTS; the first crew to solve a
// given puzzle earns an extra FIRST_BONUS on top.
export const SOLVE_POINTS = 2;
export const FIRST_BONUS = 1;

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

// Migration: rename the legacy `groups` table / `claims.group_id` column to
// `crews` / `crew_id` (SQLite rewrites the dependent FK + UNIQUE constraints).
{
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((t) => t.name);
  if (tables.includes('groups') && !tables.includes('crews')) {
    db.exec('ALTER TABLE groups RENAME TO crews');
  }
  const claimCols = db.prepare('PRAGMA table_info(claims)').all().map((c) => c.name);
  if (claimCols.includes('group_id') && !claimCols.includes('crew_id')) {
    db.exec('ALTER TABLE claims RENAME COLUMN group_id TO crew_id');
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS crews (
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
    crew_id    INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (zone_id, crew_id)   -- a crew can claim a given zone only once
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

// ---------- Crews ----------
export function createCrew(name) {
  const token = newToken();
  const info = db.prepare('INSERT INTO crews (name, token) VALUES (?, ?)').run(name, token);
  return getCrewById(info.lastInsertRowid);
}

export function getCrewById(id) {
  return db.prepare('SELECT * FROM crews WHERE id = ?').get(id);
}

export function getCrewByToken(token) {
  return db.prepare('SELECT * FROM crews WHERE token = ?').get(token);
}

export function listCrews() {
  return db.prepare('SELECT id, name, token, created_at FROM crews ORDER BY name').all();
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
// Export every zone in the portable, re-importable shape the import endpoint
// accepts. Secrets are omitted — fresh ones are minted on import.
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

// Insert pre-validated zones in one transaction (all-or-nothing). When replace
// is true, existing zones (and their claims, via cascade) are cleared first.
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
      `SELECT c.crew_id AS id, cr.name AS name, c.created_at AS at
         FROM claims c
         JOIN crews cr ON cr.id = c.crew_id
        WHERE c.zone_id = ?
        ORDER BY c.created_at`
    )
    .all(zoneId);
}

// Group flat zone+claim rows (one per claim) into zones with a claimedBy array.
// With includeSecret, each zone also carries its QR secret (admin only).
function groupZoneRows(rows, { includeSecret = false } = {}) {
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
      if (includeSecret) zone.secret = r.secret;
      byId.set(r.id, zone);
    }
    if (r.claimed_crew_id) {
      zone.claimedBy.push({ id: r.claimed_crew_id, name: r.claimed_crew_name, at: r.claimed_at });
    }
  }
  return [...byId.values()];
}

// Public zone list with claim info (never leaks the secret). Each zone can be
// claimed by multiple crews; claimedBy is an array.
export function listZonesPublic() {
  const rows = db
    .prepare(
      `SELECT z.id, z.name, z.hint, z.polygon, z.image_ver,
              c.crew_id    AS claimed_crew_id,
              cr.name      AS claimed_crew_name,
              c.created_at AS claimed_at
         FROM zones z
         LEFT JOIN claims c ON c.zone_id = z.id
         LEFT JOIN crews cr ON cr.id = c.crew_id
        ORDER BY z.id, c.created_at`
    )
    .all();
  return groupZoneRows(rows);
}

// Admin list (includes secret so QR codes can be generated, and current claimers).
export function listZonesAdmin() {
  const rows = db
    .prepare(
      `SELECT z.id, z.name, z.hint, z.polygon, z.secret, z.image_ver,
              c.crew_id    AS claimed_crew_id,
              cr.name      AS claimed_crew_name,
              c.created_at AS claimed_at
         FROM zones z
         LEFT JOIN claims c ON c.zone_id = z.id
         LEFT JOIN crews cr ON cr.id = c.crew_id
        ORDER BY z.id, c.created_at`
    )
    .all();
  return groupZoneRows(rows, { includeSecret: true });
}

// ---------- Claims ----------
// Multiple crews may claim the same zone, but each crew only once. INSERT OR
// IGNORE + the UNIQUE(zone_id, crew_id) constraint makes this idempotent and
// race-proof (no check-then-insert window, no duplicate points). created_at is
// stamped with millisecond precision (via the column default) so the
// leaderboard can break ties by who reached their score first.
// Returns { status, first, points } on a fresh claim, or { status: 'already-yours' }
// when the crew had already claimed the zone. `first` is true when this crew was
// the first to solve the puzzle (earning the FIRST_BONUS); `points` is the number
// of points this claim earned.
export function claimZone(zoneId, crewId) {
  const info = db
    .prepare('INSERT OR IGNORE INTO claims (zone_id, crew_id) VALUES (?, ?)')
    .run(zoneId, crewId);
  if (info.changes === 0) return { status: 'already-yours' };
  const firstRow = db
    .prepare('SELECT crew_id FROM claims WHERE zone_id = ? ORDER BY created_at, id LIMIT 1')
    .get(zoneId);
  const first = !!firstRow && firstRow.crew_id === crewId;
  return { status: 'claimed', first, points: SOLVE_POINTS + (first ? FIRST_BONUS : 0) };
}

export function unclaimZone(zoneId, crewId) {
  const info = db
    .prepare('DELETE FROM claims WHERE zone_id = ? AND crew_id = ?')
    .run(zoneId, crewId);
  return { removed: info.changes > 0 };
}

export function leaderboard() {
  // Score = SOLVE_POINTS per puzzle solved + FIRST_BONUS for each puzzle this
  // crew solved first. Rank by score, then by number of puzzles solved (more
  // ranks higher), then break remaining ties by whoever reached that score
  // first: the crew whose most-recent claim (MAX created_at) is earliest ranks
  // higher. Crews with no claims (NULL) fall to the bottom of the tie.
  return db
    .prepare(
      `SELECT cr.id, cr.name,
              COUNT(c.id) AS solved,
              COUNT(c.id) * ${SOLVE_POINTS} + COUNT(f.crew_id) * ${FIRST_BONUS} AS points,
              MAX(c.created_at) AS last_claim_at
         FROM crews cr
         LEFT JOIN claims c ON c.crew_id = cr.id
         LEFT JOIN (
           SELECT c1.zone_id, c1.crew_id
             FROM claims c1
            WHERE c1.created_at = (
              SELECT MIN(c2.created_at) FROM claims c2 WHERE c2.zone_id = c1.zone_id
            )
         ) f ON f.zone_id = c.zone_id AND f.crew_id = cr.id
        GROUP BY cr.id
        ORDER BY points DESC,
                 solved DESC,
                 (last_claim_at IS NULL) ASC,
                 last_claim_at ASC,
                 cr.name ASC`
    )
    .all();
}

// Reset the game. Always clears claims and crews; optionally keeps zones.
export function resetGame({ keepZones = true } = {}) {
  db.exec('DELETE FROM claims');
  db.exec('DELETE FROM crews');
  if (!keepZones) db.exec('DELETE FROM zones');
}

export { db };
