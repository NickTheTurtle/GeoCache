import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// db.js opens its SQLite file at import time using DATA_DIR, so point it at an
// isolated temp directory BEFORE importing the module.
let tmpDir;
let db;

const POLY = [
  [37.77, -122.45],
  [37.771, -122.45],
  [37.771, -122.449],
];

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geocache-test-'));
  process.env.DATA_DIR = tmpDir;
  db = await import('../src/lib/server/db.js');
});

after(() => {
  try {
    db.db.close(); // release the SQLite/WAL file handle (Windows locks open files)
  } catch {
    /* already closed */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

test('createCrew issues a unique token and is retrievable', () => {
  const g = db.createCrew('Alpha');
  assert.ok(g.id);
  assert.ok(g.token);
  assert.equal(db.getCrewByToken(g.token).name, 'Alpha');

  const g2 = db.createCrew('Beta');
  assert.notEqual(g.token, g2.token); // tokens are unique
});

test('createZone stores polygon and a secret; public list never leaks the secret', () => {
  const z = db.createZone({ name: 'Zone A', hint: 'find me', polygon: POLY });
  assert.ok(z.secret);
  assert.equal(db.getZoneBySecret(z.secret).id, z.id);

  const pub = db.listZonesPublic().find((x) => x.id === z.id);
  assert.deepEqual(pub.polygon, POLY);
  assert.equal('secret' in pub, false); // public API must not expose the secret
  assert.deepEqual(pub.claimedBy, []);
});

test('claimZone is idempotent and does not double-count points', () => {
  const g = db.createCrew('Claimers');
  const z = db.createZone({ name: 'Zone B', hint: '', polygon: POLY });

  const first = db.claimZone(z.id, g.id);
  assert.equal(first.status, 'claimed');
  assert.equal(first.first, true);
  assert.equal(first.points, db.SOLVE_POINTS + db.FIRST_BONUS); // base + first-solve bonus
  assert.equal(db.claimZone(z.id, g.id).status, 'already-yours'); // repeat is a no-op

  const row = db.leaderboard().find((r) => r.id === g.id);
  assert.equal(row.points, db.SOLVE_POINTS + db.FIRST_BONUS); // still one claim
});

test('first crew to solve earns the bonus; later crews do not', () => {
  const g1 = db.createCrew('First');
  const g2 = db.createCrew('Second');
  const z = db.createZone({ name: 'Bonus', hint: '', polygon: POLY });

  const r1 = db.claimZone(z.id, g1.id);
  const r2 = db.claimZone(z.id, g2.id);
  assert.equal(r1.first, true);
  assert.equal(r1.points, db.SOLVE_POINTS + db.FIRST_BONUS);
  assert.equal(r2.first, false);
  assert.equal(r2.points, db.SOLVE_POINTS);

  const board = db.leaderboard();
  assert.equal(board.find((r) => r.id === g1.id).points, db.SOLVE_POINTS + db.FIRST_BONUS);
  assert.equal(board.find((r) => r.id === g2.id).points, db.SOLVE_POINTS);
});

test('a zone can be claimed by multiple crews', () => {
  const g1 = db.createCrew('G1');
  const g2 = db.createCrew('G2');
  const z = db.createZone({ name: 'Shared', hint: '', polygon: POLY });

  assert.equal(db.claimZone(z.id, g1.id).status, 'claimed');
  assert.equal(db.claimZone(z.id, g2.id).status, 'claimed');

  const pub = db.listZonesPublic().find((x) => x.id === z.id);
  assert.equal(pub.claimedBy.length, 2);
});

test('getZoneClaimers returns claiming crews for one zone, earliest first', () => {
  const g1 = db.createCrew('First');
  const g2 = db.createCrew('Second');
  const z = db.createZone({ name: 'Claimed Zone', hint: '', polygon: POLY });
  db.db.prepare("INSERT INTO claims (zone_id, crew_id, created_at) VALUES (?, ?, ?)").run(z.id, g1.id, '2026-01-01 10:00:00.000');
  db.db.prepare("INSERT INTO claims (zone_id, crew_id, created_at) VALUES (?, ?, ?)").run(z.id, g2.id, '2026-01-01 10:05:00.000');

  const claimers = db.getZoneClaimers(z.id);
  assert.deepEqual(claimers.map((c) => c.name), ['First', 'Second']);
  assert.deepEqual(claimers.map((c) => c.id), [g1.id, g2.id]);
  assert.equal('at' in claimers[0], true);
  assert.deepEqual(db.getZoneClaimers(z.id + 9999), []); // unknown zone
});

test('zonePublic strips image blob columns and parses the polygon', () => {
  const z = db.createZone({ name: 'Img Zone', hint: '', polygon: POLY });
  const raw = db.getZoneById(z.id);
  const pub = db.zonePublic(raw);
  assert.equal('image' in pub, false);
  assert.equal('image_type' in pub, false);
  assert.deepEqual(pub.polygon, POLY);
  assert.equal(pub.name, 'Img Zone');
});

test('unclaimZone removes a claim', () => {
  const g = db.createCrew('Unclaimer');
  const z = db.createZone({ name: 'Zone C', hint: '', polygon: POLY });
  db.claimZone(z.id, g.id);

  assert.equal(db.unclaimZone(z.id, g.id).removed, true);
  assert.equal(db.unclaimZone(z.id, g.id).removed, false); // already gone
  assert.equal(db.leaderboard().find((r) => r.id === g.id).points, 0);
});

test('deleteZone removes the zone and its claims', () => {
  const g = db.createCrew('Deleter');
  const z = db.createZone({ name: 'Zone D', hint: '', polygon: POLY });
  db.claimZone(z.id, g.id);

  db.deleteZone(z.id);
  assert.equal(db.getZoneById(z.id), undefined);
  assert.equal(db.leaderboard().find((r) => r.id === g.id).points, 0); // claim gone too
});

test('exportZones / importZones round-trips zones and mints fresh secrets', () => {
  db.resetGame({ keepZones: false });
  const a = db.createZone({ name: 'Exp A', hint: 'hint a', polygon: POLY });
  db.createZone({ name: 'Exp B', hint: '', polygon: POLY });

  const dump = db.exportZones();
  assert.equal(dump.length, 2);
  assert.deepEqual(dump[0], { name: 'Exp A', hint: 'hint a', polygon: POLY }); // no secret leaked
  assert.equal('secret' in dump[0], false);

  // Re-import with replace: old zones cleared, new ones created with new secrets.
  const oldSecret = db.getZoneById(a.id).secret;
  const count = db.importZones(
    dump.map((z) => ({ ...z, polygon: z.polygon })),
    { replace: true }
  );
  assert.equal(count, 2);
  const after = db.listZonesAdmin();
  assert.equal(after.length, 2);
  assert.deepEqual(after.map((z) => z.name).sort(), ['Exp A', 'Exp B']);
  assert.equal(db.getZoneById(a.id), undefined); // old row replaced
  assert.equal(db.getZoneBySecret(oldSecret), undefined); // fresh secret minted
});

test('importZones without replace appends to existing zones', () => {
  db.resetGame({ keepZones: false });
  db.createZone({ name: 'Keep', hint: '', polygon: POLY });
  db.importZones([{ name: 'Added', hint: '', polygon: POLY }], { replace: false });
  assert.deepEqual(db.listZonesAdmin().map((z) => z.name).sort(), ['Added', 'Keep']);
});

test('importZones is atomic: a bad zone rolls back the whole batch', () => {
  db.resetGame({ keepZones: false });
  db.createZone({ name: 'Survivor', hint: '', polygon: POLY });
  // Second zone has an invalid polygon (not JSON-stringifiable cleanly is fine,
  // but a null polygon makes JSON.stringify store 'null', so force a throw by
  // passing a value that breaks the insert path). Use a circular reference.
  const bad = {};
  bad.self = bad;
  assert.throws(() =>
    db.importZones(
      [
        { name: 'Ok', hint: '', polygon: POLY },
        { name: 'Bad', hint: '', polygon: bad },
      ],
      { replace: true }
    )
  );
  // Replace should have rolled back, leaving the original zone intact.
  assert.deepEqual(db.listZonesAdmin().map((z) => z.name), ['Survivor']);
});

test('foreign keys are enforced: claiming a non-existent zone throws', () => {
  const g = db.createCrew('FKCrew');
  assert.throws(() => db.claimZone(9999999, g.id));
});

test('resetGame clears crews and claims but keeps zones by default', () => {
  db.createCrew('Temp');
  const z = db.createZone({ name: 'Keeper', hint: '', polygon: POLY });

  db.resetGame(); // keepZones defaults to true
  assert.equal(db.listCrews().length, 0);
  assert.equal(db.leaderboard().length, 0);
  assert.ok(db.getZoneById(z.id)); // zone survives

  db.resetGame({ keepZones: false });
  assert.equal(db.getZoneById(z.id), undefined); // now removed
});

test('leaderboard breaks ties by who reached the score first', () => {
  db.resetGame({ keepZones: false });
  const early = db.createCrew('Early');
  const late = db.createCrew('Late');
  const z1 = db.createZone({ name: 'T1', hint: '', polygon: POLY });
  const z2 = db.createZone({ name: 'T2', hint: '', polygon: POLY });

  const ins = db.db.prepare('INSERT INTO claims (zone_id, crew_id, created_at) VALUES (?,?,?)');
  // Both crews finish with 1 point, but Early's claim is timestamped earlier.
  ins.run(z1.id, early.id, '2026-01-01 10:00:00.000');
  ins.run(z2.id, late.id, '2026-01-01 10:05:00.000');

  const board = db.leaderboard();
  assert.equal(board[0].name, 'Early'); // earlier claim wins the tie
  assert.equal(board[1].name, 'Late');
});

test('leaderboard tie uses the most-recent claim (reaching the score first)', () => {
  db.resetGame({ keepZones: false });
  const a = db.createCrew('A');
  const b = db.createCrew('B');
  const zones = ['X1', 'X2', 'X3', 'X4'].map((n) => db.createZone({ name: n, hint: '', polygon: POLY }));
  const ins = db.db.prepare('INSERT INTO claims (zone_id, crew_id, created_at) VALUES (?,?,?)');
  // A reaches 2 points at 10:10; B reaches 2 points at 10:05 (earlier) -> B first,
  // even though A's first claim (10:00) predates B's first claim (10:01).
  ins.run(zones[0].id, a.id, '2026-02-01 10:00:00.000');
  ins.run(zones[1].id, a.id, '2026-02-01 10:10:00.000');
  ins.run(zones[2].id, b.id, '2026-02-01 10:01:00.000');
  ins.run(zones[3].id, b.id, '2026-02-01 10:05:00.000');

  const board = db.leaderboard();
  assert.equal(board[0].name, 'B');
  assert.equal(board[1].name, 'A');
});

test('more points always outranks an earlier claim time', () => {
  db.resetGame({ keepZones: false });
  const leader = db.createCrew('TwoPts');
  const rival = db.createCrew('OnePtEarly');
  const zones = ['Y1', 'Y2', 'Y3'].map((n) => db.createZone({ name: n, hint: '', polygon: POLY }));
  const ins = db.db.prepare('INSERT INTO claims (zone_id, crew_id, created_at) VALUES (?,?,?)');
  ins.run(zones[0].id, rival.id, '2026-03-01 09:00:00.000'); // earliest, but only 1 point
  ins.run(zones[1].id, leader.id, '2026-03-01 12:00:00.000');
  ins.run(zones[2].id, leader.id, '2026-03-01 12:01:00.000');

  const board = db.leaderboard();
  assert.equal(board[0].name, 'TwoPts'); // points beat time
  assert.equal(board[0].points, 2 * (db.SOLVE_POINTS + db.FIRST_BONUS)); // 2 puzzles, both first-solves
});
