import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'geocache.db'));

// Scoring: solving any puzzle is worth SOLVE_POINTS; the first employee to solve a
// given puzzle earns an extra FIRST_BONUS on top.
export const SOLVE_POINTS = 4;
export const FIRST_BONUS = 1;

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS employees (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    token      TEXT NOT NULL UNIQUE,    -- the secret in the employee's personal link
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A hint image is stored as a BLOB, so there is no file/disk to manage;
  -- image_ver changes on every upload so cached <img> URLs bust automatically.
  -- When require_presence is 1, the zone can only be claimed near the
  -- admin-placed spot (presence_lat / presence_lng), checked server-side against
  -- the device's reported GPS position. The spot is never sent to players.
  CREATE TABLE IF NOT EXISTS zones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    hint             TEXT NOT NULL DEFAULT '',
    polygon          TEXT NOT NULL,           -- JSON: [[lat,lng], ...]
    secret           TEXT NOT NULL UNIQUE,    -- encoded in the QR code
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    image            BLOB,
    image_type       TEXT,
    image_ver        TEXT,
    require_presence INTEGER NOT NULL DEFAULT 0,
    presence_lat     REAL,
    presence_lng     REAL
  );

  CREATE TABLE IF NOT EXISTS claims (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id     INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (zone_id, employee_id)   -- an employee can claim a given zone only once
  );

  -- Admin-granted points on top of what an employee earned from claims (can be
  -- negative). One running total per employee.
  CREATE TABLE IF NOT EXISTS point_adjustments (
    employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
    points      INTEGER NOT NULL
  );
`);

function newToken(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ---------- Employees ----------
export function createEmployee(name) {
  const token = newToken();
  const info = db.prepare('INSERT INTO employees (name, token) VALUES (?, ?)').run(name, token);
  return getEmployeeById(info.lastInsertRowid);
}

export function getEmployeeById(id) {
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
}

export function getEmployeeByToken(token) {
  return db.prepare('SELECT * FROM employees WHERE token = ?').get(token);
}

export function listEmployees() {
  return db.prepare('SELECT id, name, token, created_at FROM employees ORDER BY name').all();
}

// Deleting an employee also removes their claims and point adjustments (ON DELETE
// CASCADE). Where they solved a zone first, the next employee to solve it now
// holds the first-solve bonus.
export function deleteEmployee(id) {
  return db.prepare('DELETE FROM employees WHERE id = ?').run(id).changes > 0;
}

// Add `delta` (positive or negative) to an employee's admin adjustment.
export function adjustPoints(employeeId, delta) {
  db.prepare(
    `INSERT INTO point_adjustments (employee_id, points) VALUES (?, ?)
     ON CONFLICT (employee_id) DO UPDATE SET points = points + excluded.points`
  ).run(employeeId, delta);
}

// ---------- Zones ----------
// requirePresence gates claiming on being near presenceLat/presenceLng (a
// specific admin-placed spot). The spot is stored only when requirePresence.
export function createZone({
  name,
  hint,
  polygon,
  image,
  imageType,
  requirePresence = false,
  presenceLat = null,
  presenceLng = null,
  secret = null,
}) {
  // Reuse a given secret (e.g. from an exported file) so existing QR codes keep
  // working; otherwise mint a fresh one.
  secret = secret || newToken(12);
  const hasImg = image && imageType;
  const rp = requirePresence ? 1 : 0;
  const pLat = rp && Number.isFinite(presenceLat) ? presenceLat : null;
  const pLng = rp && Number.isFinite(presenceLng) ? presenceLng : null;
  const info = db
    .prepare(
      'INSERT INTO zones (name, hint, polygon, secret, image, image_type, image_ver, require_presence, presence_lat, presence_lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      name,
      hint || '',
      JSON.stringify(polygon),
      secret,
      hasImg ? image : null,
      hasImg ? imageType : null,
      hasImg ? newToken(4) : null,
      rp,
      pLat,
      pLng
    );
  return getZoneById(info.lastInsertRowid);
}

// image handling: pass a Buffer + imageType to replace the image, removeImage
// to clear it, or neither to leave the existing image untouched.
export function updateZone(id, {
  name,
  hint,
  polygon,
  image,
  imageType,
  removeImage,
  requirePresence = false,
  presenceLat = null,
  presenceLng = null,
}) {
  const rp = requirePresence ? 1 : 0;
  const pLat = rp && Number.isFinite(presenceLat) ? presenceLat : null;
  const pLng = rp && Number.isFinite(presenceLng) ? presenceLng : null;
  db.prepare(
    'UPDATE zones SET name = ?, hint = ?, polygon = ?, require_presence = ?, presence_lat = ?, presence_lng = ? WHERE id = ?'
  ).run(name, hint || '', JSON.stringify(polygon), rp, pLat, pLng, id);
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
// accepts, including each zone's QR secret so a re-import keeps existing QR
// codes working.
export function exportZones() {
  const rows = db
    .prepare('SELECT name, hint, polygon, secret, image, image_type, require_presence, presence_lat, presence_lng FROM zones ORDER BY id')
    .all();
  return rows.map((r) => {
    const zone = { name: r.name, hint: r.hint, polygon: JSON.parse(r.polygon), secret: r.secret };
    if (r.require_presence) {
      zone.requirePresence = true;
      zone.presenceLat = r.presence_lat;
      zone.presenceLng = r.presence_lng;
    }
    if (r.image && r.image_type) {
      zone.imageData = `data:${r.image_type};base64,${Buffer.from(r.image).toString('base64')}`;
    }
    return zone;
  });
}

// Thrown when an imported zone's secret already belongs to a zone that is being
// kept (an append import), since two zones can't share a QR code.
export class SecretTakenError extends Error {}

// Insert pre-validated zones in one transaction (all-or-nothing). When replace
// is true, existing zones (and their claims, via cascade) are cleared first.
// A zone's `secret`, if given, is reused so its QR code keeps working.
export function importZones(zones, { replace = false } = {}) {
  db.exec('BEGIN');
  try {
    if (replace) db.exec('DELETE FROM zones');
    zones.forEach((z, i) => {
      const taken = z.secret && getZoneBySecret(z.secret);
      if (taken) {
        throw new SecretTakenError(
          `Zone #${i + 1} ("${z.name}"): its QR secret already belongs to the zone "${taken.name}". ` +
            'Tick "Replace existing zones", or remove its "secret" to give it a new QR code.'
        );
      }
      createZone(z);
    });
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
  const { image, image_type, require_presence, presence_lat, presence_lng, ...rest } = zone;
  return {
    ...rest,
    requirePresence: !!require_presence,
    presenceLat: presence_lat ?? null,
    presenceLng: presence_lng ?? null,
    polygon: JSON.parse(rest.polygon),
  };
}

export function getZoneById(id) {
  return db.prepare('SELECT * FROM zones WHERE id = ?').get(id);
}

export function getZoneBySecret(secret) {
  return db.prepare('SELECT * FROM zones WHERE secret = ?').get(secret);
}

// Employees that have claimed a single zone, earliest first (used by the claim page).
export function getZoneClaimers(zoneId) {
  return db
    .prepare(
      `SELECT c.employee_id AS id, emp.name AS name, c.created_at AS at
         FROM claims c
         JOIN employees emp ON emp.id = c.employee_id
        WHERE c.zone_id = ?
        ORDER BY c.id`
    )
    .all(zoneId);
}

// Group flat zone+claim rows (one per claim) into zones with a claimedBy array.
// With includeSecret, each zone also carries its QR secret (admin only).
function groupZoneRows(rows, { includeSecret = false, includePresence = false } = {}) {
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
        requirePresence: !!r.require_presence,
        claimedBy: [],
      };
      if (includeSecret) zone.secret = r.secret;
      // The claim spot is the answer, so it is only ever exposed to admins.
      if (includePresence) {
        zone.presenceLat = r.presence_lat ?? null;
        zone.presenceLng = r.presence_lng ?? null;
      }
      byId.set(r.id, zone);
    }
    if (r.claimed_employee_id) {
      zone.claimedBy.push({ id: r.claimed_employee_id, name: r.claimed_employee_name, at: r.claimed_at });
    }
  }
  return [...byId.values()];
}

// Public zone list with claim info (never leaks the secret). Each zone can be
// claimed by multiple employees; claimedBy is an array.
export function listZonesPublic() {
  const rows = db
    .prepare(
      `SELECT z.id, z.name, z.hint, z.polygon, z.image_ver, z.require_presence,
              c.employee_id AS claimed_employee_id,
              emp.name      AS claimed_employee_name,
              c.created_at AS claimed_at
         FROM zones z
         LEFT JOIN claims c ON c.zone_id = z.id
         LEFT JOIN employees emp ON emp.id = c.employee_id
        ORDER BY z.id, c.created_at`
    )
    .all();
  return groupZoneRows(rows);
}

// Admin list (includes secret so QR codes can be generated, and current claimers).
export function listZonesAdmin() {
  const rows = db
    .prepare(
      `SELECT z.id, z.name, z.hint, z.polygon, z.secret, z.image_ver, z.require_presence,
              z.presence_lat, z.presence_lng,
              c.employee_id AS claimed_employee_id,
              emp.name      AS claimed_employee_name,
              c.created_at AS claimed_at
         FROM zones z
         LEFT JOIN claims c ON c.zone_id = z.id
         LEFT JOIN employees emp ON emp.id = c.employee_id
        ORDER BY z.id, c.created_at`
    )
    .all();
  return groupZoneRows(rows, { includeSecret: true, includePresence: true });
}

// ---------- Claims ----------
// Multiple employees may claim the same zone, but each employee only once. INSERT OR
// IGNORE + the UNIQUE(zone_id, employee_id) constraint makes this idempotent and
// race-proof (no check-then-insert window, no duplicate points). created_at is
// stamped with millisecond precision (via the column default) so the
// leaderboard can break ties by who reached their score first.
// Returns { status, first, points } on a fresh claim, or { status: 'already-yours' }
// when the employee had already claimed the zone. `first` is true when this employee was
// the first to solve the puzzle (earning the FIRST_BONUS); `points` is the number
// of points this claim earned.
export function claimZone(zoneId, employeeId) {
  const info = db
    .prepare('INSERT OR IGNORE INTO claims (zone_id, employee_id) VALUES (?, ?)')
    .run(zoneId, employeeId);
  if (info.changes === 0) return { status: 'already-yours' };
  // First solver = the earliest-inserted claim. Order by the AUTOINCREMENT id
  // (strict insertion order) rather than created_at: the wall clock isn't
  // guaranteed monotonic between two rapid claims (notably on Windows), so a
  // created_at sort can occasionally mis-credit the bonus to the later claim.
  const firstRow = db
    .prepare('SELECT employee_id FROM claims WHERE zone_id = ? ORDER BY id LIMIT 1')
    .get(zoneId);
  const first = !!firstRow && firstRow.employee_id === employeeId;
  return { status: 'claimed', first, points: SOLVE_POINTS + (first ? FIRST_BONUS : 0) };
}

export function unclaimZone(zoneId, employeeId) {
  const info = db
    .prepare('DELETE FROM claims WHERE zone_id = ? AND employee_id = ?')
    .run(zoneId, employeeId);
  return { removed: info.changes > 0 };
}

export function leaderboard() {
  // Score = SOLVE_POINTS per puzzle solved + FIRST_BONUS for each puzzle this
  // employee solved first + any admin adjustment. Rank by score, then by number of puzzles solved (more
  // ranks higher), then break remaining ties by whoever reached that score
  // first: the employee whose most-recent claim (MAX created_at) is earliest ranks
  // higher. Employees with no claims (NULL) fall to the bottom of the tie.
  return db
    .prepare(
      `SELECT emp.id, emp.name,
              COUNT(c.id) AS solved,
              COUNT(c.id) * ${SOLVE_POINTS} + COUNT(f.employee_id) * ${FIRST_BONUS}
                + COALESCE((SELECT a.points FROM point_adjustments a WHERE a.employee_id = emp.id), 0) AS points,
              MAX(c.created_at) AS last_claim_at
         FROM employees emp
         LEFT JOIN claims c ON c.employee_id = emp.id
         LEFT JOIN (
           SELECT c1.zone_id, c1.employee_id
             FROM claims c1
            WHERE c1.id = (
              SELECT MIN(c2.id) FROM claims c2 WHERE c2.zone_id = c1.zone_id
            )
         ) f ON f.zone_id = c.zone_id AND f.employee_id = emp.id
        GROUP BY emp.id
        ORDER BY points DESC,
                 solved DESC,
                 (last_claim_at IS NULL) ASC,
                 last_claim_at ASC,
                 emp.name ASC`
    )
    .all();
}

// Reset the game. Always clears claims and employees; optionally keeps zones.
export function resetGame({ keepZones = true } = {}) {
  db.exec('DELETE FROM claims');
  db.exec('DELETE FROM employees');
  if (!keepZones) db.exec('DELETE FROM zones');
}

export { db };
