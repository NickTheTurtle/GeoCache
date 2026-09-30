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

test('createEmployee issues a unique token and is retrievable', () => {
  const g = db.createEmployee('Alpha');
  assert.ok(g.id);
  assert.ok(g.token);
  assert.equal(db.getEmployeeByToken(g.token).name, 'Alpha');

  const g2 = db.createEmployee('Beta');
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
  const g = db.createEmployee('Claimers');
  const z = db.createZone({ name: 'Zone B', hint: '', polygon: POLY });

  const first = db.claimZone(z.id, g.id);
  assert.equal(first.status, 'claimed');
  assert.equal(first.first, true);
  assert.equal(first.points, db.SOLVE_POINTS + db.FIRST_BONUS); // base + first-solve bonus
  assert.equal(db.claimZone(z.id, g.id).status, 'already-yours'); // repeat is a no-op

  const row = db.leaderboard().find((r) => r.id === g.id);
  assert.equal(row.points, db.SOLVE_POINTS + db.FIRST_BONUS); // still one claim
});

test('first employee to solve earns the bonus; later employees do not', () => {
  const g1 = db.createEmployee('First');
  const g2 = db.createEmployee('Second');
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

test('a zone can be claimed by multiple employees', () => {
  const g1 = db.createEmployee('G1');
  const g2 = db.createEmployee('G2');
  const z = db.createZone({ name: 'Shared', hint: '', polygon: POLY });

  assert.equal(db.claimZone(z.id, g1.id).status, 'claimed');
  assert.equal(db.claimZone(z.id, g2.id).status, 'claimed');

  const pub = db.listZonesPublic().find((x) => x.id === z.id);
  assert.equal(pub.claimedBy.length, 2);
});

test('getZoneClaimers returns claiming employees for one zone, earliest first', () => {
  const g1 = db.createEmployee('First');
  const g2 = db.createEmployee('Second');
  const z = db.createZone({ name: 'Claimed Zone', hint: '', polygon: POLY });
  db.db.prepare("INSERT INTO claims (zone_id, employee_id, created_at) VALUES (?, ?, ?)").run(z.id, g1.id, '2026-01-01 10:00:00.000');
  db.db.prepare("INSERT INTO claims (zone_id, employee_id, created_at) VALUES (?, ?, ?)").run(z.id, g2.id, '2026-01-01 10:05:00.000');

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
  const g = db.createEmployee('Unclaimer');
  const z = db.createZone({ name: 'Zone C', hint: '', polygon: POLY });
  db.claimZone(z.id, g.id);

  assert.equal(db.unclaimZone(z.id, g.id).removed, true);
  assert.equal(db.unclaimZone(z.id, g.id).removed, false); // already gone
  assert.equal(db.leaderboard().find((r) => r.id === g.id).points, 0);
});

test('deleteZone removes the zone and its claims', () => {
  const g = db.createEmployee('Deleter');
  const z = db.createZone({ name: 'Zone D', hint: '', polygon: POLY });
  db.claimZone(z.id, g.id);

  db.deleteZone(z.id);
  assert.equal(db.getZoneById(z.id), undefined);
  assert.equal(db.leaderboard().find((r) => r.id === g.id).points, 0); // claim gone too
});

test('exportZones includes each secret, and a replace re-import keeps every QR code working', () => {
  db.resetGame({ keepZones: false });
  const a = db.createZone({ name: 'Exp A', hint: 'hint a', polygon: POLY });
  const b = db.createZone({ name: 'Exp B', hint: '', polygon: POLY });

  const dump = db.exportZones();
  assert.equal(dump.length, 2);
  assert.deepEqual(dump[0], { name: 'Exp A', hint: 'hint a', polygon: POLY, secret: a.secret });
  assert.equal(dump[1].secret, b.secret);

  // Round-trip through JSON, as the downloaded file does, then replace-import.
  const file = JSON.parse(JSON.stringify({ zones: dump }));
  assert.equal(db.importZones(file.zones, { replace: true }), 2);
  assert.equal(db.getZoneById(a.id), undefined); // old rows were replaced...
  for (const [old, name] of [[a, 'Exp A'], [b, 'Exp B']]) {
    const now = db.getZoneBySecret(old.secret); // ...but each QR code still resolves
    assert.ok(now, `${name}'s QR secret survives the re-import`);
    assert.equal(now.name, name);
    assert.notEqual(now.id, old.id);
  }
  assert.deepEqual(db.listZonesAdmin().map((z) => z.secret).sort(), [a.secret, b.secret].sort());
});

test('importZones mints a fresh secret for zones without one', () => {
  db.resetGame({ keepZones: false });
  db.importZones([{ name: 'No secret', hint: '', polygon: POLY }], { replace: true });
  const [z] = db.listZonesAdmin();
  assert.match(z.secret, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(db.getZoneBySecret(z.secret).name, 'No secret');
});

test('appending a zone whose secret is already in use is rejected and rolled back', () => {
  db.resetGame({ keepZones: false });
  const keep = db.createZone({ name: 'Keep', hint: '', polygon: POLY });
  assert.throws(
    () =>
      db.importZones(
        [
          { name: 'Fresh', hint: '', polygon: POLY, secret: 'brandNewSecret123' },
          { name: 'Clash', hint: '', polygon: POLY, secret: keep.secret },
        ],
        { replace: false }
      ),
    (e) => e instanceof db.SecretTakenError && /Zone #2 \("Clash"\).*"Keep"/.test(e.message)
  );
  // All-or-nothing: the first zone wasn't added either, and "Keep" still owns its QR.
  assert.deepEqual(db.listZonesAdmin().map((z) => z.name), ['Keep']);
  assert.equal(db.getZoneBySecret('brandNewSecret123'), undefined);
  assert.equal(db.getZoneBySecret(keep.secret).id, keep.id);
});

test('importZones reuses a given secret when appending, too', () => {
  db.resetGame({ keepZones: false });
  db.createZone({ name: 'Existing', hint: '', polygon: POLY });
  db.importZones([{ name: 'Custom', hint: '', polygon: POLY, secret: 'XQJCGx_vUTJF-6Ec' }], { replace: false });
  assert.equal(db.getZoneBySecret('XQJCGx_vUTJF-6Ec').name, 'Custom');
  assert.equal(db.listZonesAdmin().length, 2);
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
  const g = db.createEmployee('FKEmployee');
  assert.throws(() => db.claimZone(9999999, g.id));
});

test('resetGame clears employees and claims but keeps zones by default', () => {
  db.createEmployee('Temp');
  const z = db.createZone({ name: 'Keeper', hint: '', polygon: POLY });

  db.resetGame(); // keepZones defaults to true
  assert.equal(db.listEmployees().length, 0);
  assert.equal(db.leaderboard().length, 0);
  assert.ok(db.getZoneById(z.id)); // zone survives

  db.resetGame({ keepZones: false });
  assert.equal(db.getZoneById(z.id), undefined); // now removed
});

test('leaderboard breaks ties by who reached the score first', () => {
  db.resetGame({ keepZones: false });
  const early = db.createEmployee('Early');
  const late = db.createEmployee('Late');
  const z1 = db.createZone({ name: 'T1', hint: '', polygon: POLY });
  const z2 = db.createZone({ name: 'T2', hint: '', polygon: POLY });

  const ins = db.db.prepare('INSERT INTO claims (zone_id, employee_id, created_at) VALUES (?,?,?)');
  // Both employees finish with 1 point, but Early's claim is timestamped earlier.
  ins.run(z1.id, early.id, '2026-01-01 10:00:00.000');
  ins.run(z2.id, late.id, '2026-01-01 10:05:00.000');

  const board = db.leaderboard();
  assert.equal(board[0].name, 'Early'); // earlier claim wins the tie
  assert.equal(board[1].name, 'Late');
});

test('leaderboard tie uses the most-recent claim (reaching the score first)', () => {
  db.resetGame({ keepZones: false });
  const a = db.createEmployee('A');
  const b = db.createEmployee('B');
  const zones = ['X1', 'X2', 'X3', 'X4'].map((n) => db.createZone({ name: n, hint: '', polygon: POLY }));
  const ins = db.db.prepare('INSERT INTO claims (zone_id, employee_id, created_at) VALUES (?,?,?)');
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
  const leader = db.createEmployee('TwoPts');
  const rival = db.createEmployee('OnePtEarly');
  const zones = ['Y1', 'Y2', 'Y3'].map((n) => db.createZone({ name: n, hint: '', polygon: POLY }));
  const ins = db.db.prepare('INSERT INTO claims (zone_id, employee_id, created_at) VALUES (?,?,?)');
  ins.run(zones[0].id, rival.id, '2026-03-01 09:00:00.000'); // earliest, but only 1 point
  ins.run(zones[1].id, leader.id, '2026-03-01 12:00:00.000');
  ins.run(zones[2].id, leader.id, '2026-03-01 12:01:00.000');

  const board = db.leaderboard();
  assert.equal(board[0].name, 'TwoPts'); // points beat time
  assert.equal(board[0].points, 2 * (db.SOLVE_POINTS + db.FIRST_BONUS)); // 2 puzzles, both first-solves
});

test('adjustPoints adds and subtracts on top of claim points, and stacks', () => {
  db.resetGame({ keepZones: false });
  const e = db.createEmployee('Adjusted');
  const z = db.createZone({ name: 'Adj', hint: '', polygon: POLY });
  db.claimZone(z.id, e.id);
  const earned = db.SOLVE_POINTS + db.FIRST_BONUS;
  const points = () => db.leaderboard().find((r) => r.id === e.id).points;

  db.adjustPoints(e.id, 5);
  assert.equal(points(), earned + 5);
  db.adjustPoints(e.id, -3);
  assert.equal(points(), earned + 2); // adjustments accumulate
  assert.equal(db.listEmployees().find((r) => r.id === e.id).adjustment, 2);

  // Later claims still add on top of the adjustment.
  const z2 = db.createZone({ name: 'Adj2', hint: '', polygon: POLY });
  db.claimZone(z2.id, e.id);
  assert.equal(points(), 2 * earned + 2);
});

test('an adjustment counts for an employee with no claims and can reorder the board', () => {
  db.resetGame({ keepZones: false });
  const claimer = db.createEmployee('Claimer');
  const bonus = db.createEmployee('Bonus');
  assert.equal(db.listEmployees().find((r) => r.id === bonus.id).adjustment, 0); // 0, not null, when none
  const z = db.createZone({ name: 'Board', hint: '', polygon: POLY });
  db.claimZone(z.id, claimer.id);

  db.adjustPoints(bonus.id, db.SOLVE_POINTS + db.FIRST_BONUS + 1);
  const board = db.leaderboard();
  assert.equal(board[0].name, 'Bonus');
  assert.equal(board[0].solved, 0);
});

test('deleteEmployee removes the employee, their claims and adjustments, and passes on the first-solve bonus', () => {
  db.resetGame({ keepZones: false });
  const first = db.createEmployee('Gone');
  const second = db.createEmployee('Stays');
  const z = db.createZone({ name: 'Del', hint: '', polygon: POLY });
  db.claimZone(z.id, first.id);
  db.claimZone(z.id, second.id);
  db.adjustPoints(first.id, 7);

  assert.equal(db.deleteEmployee(first.id), true);
  assert.equal(db.getEmployeeByToken(first.token), undefined);
  assert.deepEqual(db.getZoneClaimers(z.id).map((c) => c.id), [second.id]);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM point_adjustments').get().n, 0);
  // The remaining solver is now first.
  assert.equal(db.leaderboard()[0].points, db.SOLVE_POINTS + db.FIRST_BONUS);

  assert.equal(db.deleteEmployee(first.id), false); // already gone
});

test('resetGame also clears point adjustments', () => {
  const e = db.createEmployee('ResetMe');
  db.adjustPoints(e.id, 3);
  db.resetGame();
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM point_adjustments').get().n, 0);
});
