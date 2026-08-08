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

test('createGroup issues a unique token and is retrievable', () => {
  const g = db.createGroup('Alpha');
  assert.ok(g.id);
  assert.ok(g.token);
  assert.equal(db.getGroupByToken(g.token).name, 'Alpha');

  const g2 = db.createGroup('Beta');
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
  const g = db.createGroup('Claimers');
  const z = db.createZone({ name: 'Zone B', hint: '', polygon: POLY });

  assert.equal(db.claimZone(z.id, g.id).status, 'claimed');
  assert.equal(db.claimZone(z.id, g.id).status, 'already-yours'); // repeat is a no-op

  const row = db.leaderboard().find((r) => r.id === g.id);
  assert.equal(row.points, 1); // still only one point
});

test('a zone can be claimed by multiple groups', () => {
  const g1 = db.createGroup('G1');
  const g2 = db.createGroup('G2');
  const z = db.createZone({ name: 'Shared', hint: '', polygon: POLY });

  assert.equal(db.claimZone(z.id, g1.id).status, 'claimed');
  assert.equal(db.claimZone(z.id, g2.id).status, 'claimed');

  const pub = db.listZonesPublic().find((x) => x.id === z.id);
  assert.equal(pub.claimedBy.length, 2);
});

test('getZoneClaimers returns claiming crews for one zone, earliest first', () => {
  const g1 = db.createGroup('First');
  const g2 = db.createGroup('Second');
  const z = db.createZone({ name: 'Claimed Zone', hint: '', polygon: POLY });
  db.db.prepare("INSERT INTO claims (zone_id, group_id, created_at) VALUES (?, ?, ?)").run(z.id, g1.id, '2026-01-01 10:00:00.000');
  db.db.prepare("INSERT INTO claims (zone_id, group_id, created_at) VALUES (?, ?, ?)").run(z.id, g2.id, '2026-01-01 10:05:00.000');

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
  const g = db.createGroup('Unclaimer');
  const z = db.createZone({ name: 'Zone C', hint: '', polygon: POLY });
  db.claimZone(z.id, g.id);

  assert.equal(db.unclaimZone(z.id, g.id).removed, true);
  assert.equal(db.unclaimZone(z.id, g.id).removed, false); // already gone
  assert.equal(db.leaderboard().find((r) => r.id === g.id).points, 0);
});

test('deleteZone removes the zone and its claims', () => {
  const g = db.createGroup('Deleter');
  const z = db.createZone({ name: 'Zone D', hint: '', polygon: POLY });
  db.claimZone(z.id, g.id);

  db.deleteZone(z.id);
  assert.equal(db.getZoneById(z.id), undefined);
  assert.equal(db.leaderboard().find((r) => r.id === g.id).points, 0); // claim gone too
});

test('foreign keys are enforced: claiming a non-existent zone throws', () => {
  const g = db.createGroup('FKGroup');
  assert.throws(() => db.claimZone(9999999, g.id));
});

test('resetGame clears groups and claims but keeps zones by default', () => {
  db.createGroup('Temp');
  const z = db.createZone({ name: 'Keeper', hint: '', polygon: POLY });

  db.resetGame(); // keepZones defaults to true
  assert.equal(db.listGroups().length, 0);
  assert.equal(db.leaderboard().length, 0);
  assert.ok(db.getZoneById(z.id)); // zone survives

  db.resetGame({ keepZones: false });
  assert.equal(db.getZoneById(z.id), undefined); // now removed
});

test('leaderboard breaks ties by who reached the score first', () => {
  db.resetGame({ keepZones: false });
  const early = db.createGroup('Early');
  const late = db.createGroup('Late');
  const z1 = db.createZone({ name: 'T1', hint: '', polygon: POLY });
  const z2 = db.createZone({ name: 'T2', hint: '', polygon: POLY });

  const ins = db.db.prepare('INSERT INTO claims (zone_id, group_id, created_at) VALUES (?,?,?)');
  // Both crews finish with 1 point, but Early's claim is timestamped earlier.
  ins.run(z1.id, early.id, '2026-01-01 10:00:00.000');
  ins.run(z2.id, late.id, '2026-01-01 10:05:00.000');

  const board = db.leaderboard();
  assert.equal(board[0].name, 'Early'); // earlier claim wins the tie
  assert.equal(board[1].name, 'Late');
});

test('leaderboard tie uses the most-recent claim (reaching the score first)', () => {
  db.resetGame({ keepZones: false });
  const a = db.createGroup('A');
  const b = db.createGroup('B');
  const zones = ['X1', 'X2', 'X3', 'X4'].map((n) => db.createZone({ name: n, hint: '', polygon: POLY }));
  const ins = db.db.prepare('INSERT INTO claims (zone_id, group_id, created_at) VALUES (?,?,?)');
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
  const leader = db.createGroup('TwoPts');
  const rival = db.createGroup('OnePtEarly');
  const zones = ['Y1', 'Y2', 'Y3'].map((n) => db.createZone({ name: n, hint: '', polygon: POLY }));
  const ins = db.db.prepare('INSERT INTO claims (zone_id, group_id, created_at) VALUES (?,?,?)');
  ins.run(zones[0].id, rival.id, '2026-03-01 09:00:00.000'); // earliest, but only 1 point
  ins.run(zones[1].id, leader.id, '2026-03-01 12:00:00.000');
  ins.run(zones[2].id, leader.id, '2026-03-01 12:01:00.000');

  const board = db.leaderboard();
  assert.equal(board[0].name, 'TwoPts'); // points beat time
  assert.equal(board[0].points, 2);
});
