import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';

// A database in the exact shape the app used before players were renamed to
// "employees": a `crews` table and a `claims.crew_id` column. db.js migrates it
// when it opens, so build the old file first, then import the module.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'care-migration-'));
const legacy = 'crews'; // the old table name the migration renames
const legacyCol = `${legacy.slice(0, -1)}_id`;

let db;
let old;

before(async () => {
  const raw = new DatabaseSync(path.join(dir, 'geocache.db'));
  raw.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE ${legacy} (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      token      TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE zones (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      hint       TEXT NOT NULL DEFAULT '',
      polygon    TEXT NOT NULL,
      secret     TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE claims (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id    INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
      ${legacyCol}    INTEGER NOT NULL REFERENCES ${legacy}(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
      UNIQUE (zone_id, ${legacyCol})   -- a ${legacy.slice(0, -1)} can claim a given zone only once
    );
    INSERT INTO ${legacy} (name, token) VALUES ('Fog Chasers', 'tok-fog-123'), ('Bridge Trolls', 'tok-troll-456');
    INSERT INTO zones (name, polygon, secret) VALUES ('Time Machine', '[[37.77,-122.45],[37.771,-122.45],[37.771,-122.449]]', 'XQJCGx_vUTJF-6Ec');
    INSERT INTO claims (zone_id, ${legacyCol}, created_at) VALUES (1, 1, '2026-09-28 10:00:00.000'), (1, 2, '2026-09-28 11:00:00.000');
  `);
  // A claim that was later removed: its id must never be handed out again.
  raw.exec(`INSERT INTO ${legacy} (name, token) VALUES ('Gone', 'tok-gone'); INSERT INTO claims (zone_id, ${legacyCol}) VALUES (1, 3); DELETE FROM claims WHERE id = 3; DELETE FROM ${legacy} WHERE id = 3;`);
  old = {
    claims: raw.prepare(`SELECT id, zone_id, ${legacyCol} AS who, created_at FROM claims ORDER BY id`).all(),
    seq: raw.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'claims'").get().seq,
  };
  raw.close();

  process.env.DATA_DIR = dir;
  db = await import('../src/lib/server/db.js');
});

const raw = () => new DatabaseSync(path.join(dir, 'geocache.db'));

test('the player table and claim column are renamed to employees / employee_id', () => {
  const r = raw();
  const tables = r.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  assert.ok(tables.includes('employees'));
  assert.ok(!tables.includes(legacy));
  assert.deepEqual(r.prepare('PRAGMA table_info(claims)').all().map((c) => c.name), ['id', 'zone_id', 'employee_id', 'created_at']);
  assert.deepEqual(
    r.prepare('PRAGMA foreign_key_list(claims)').all().map((f) => `${f.from}->${f.table}.${f.to}`).sort(),
    ['employee_id->employees.id', 'zone_id->zones.id']
  );
  // No stored definition mentions the old name, not even in a comment.
  const leftovers = r.prepare('SELECT name FROM sqlite_master WHERE sql LIKE ?').all(`%${legacy.slice(0, -1)}%`);
  assert.deepEqual(leftovers, []);
});

test('every employee, token, claim and timestamp survives unchanged', () => {
  assert.deepEqual(db.listEmployees().map((e) => [e.id, e.name, e.token]).sort(), [
    [1, 'Fog Chasers', 'tok-fog-123'],
    [2, 'Bridge Trolls', 'tok-troll-456'],
  ]);
  const claims = raw().prepare('SELECT id, zone_id, employee_id AS who, created_at FROM claims ORDER BY id').all();
  assert.deepEqual(claims, old.claims);
  // Old personal links keep working, and the leaderboard is intact.
  assert.equal(db.getEmployeeByToken('tok-fog-123').name, 'Fog Chasers');
  assert.equal(db.getZoneBySecret('XQJCGx_vUTJF-6Ec').name, 'Time Machine');
  assert.deepEqual(db.leaderboard().map((r) => [r.name, r.points]), [['Fog Chasers', 5], ['Bridge Trolls', 4]]);
});

test('constraints still hold after the rebuild', () => {
  assert.equal(db.claimZone(1, 1).status, 'already-yours'); // UNIQUE (zone_id, employee_id)
  assert.throws(() => db.claimZone(1, 999)); // foreign key to employees
  const fresh = db.createEmployee('New Hire');
  const c = db.claimZone(1, fresh.id);
  assert.equal(c.status, 'claimed');
  const newest = raw().prepare('SELECT max(id) AS id FROM claims').get().id;
  assert.ok(newest > old.seq, `new claim id ${newest} doesn't reuse an old id (<= ${old.seq})`);
});

test('a backup of the pre-migration database is kept', () => {
  const backup = new DatabaseSync(path.join(dir, 'geocache.before-employees.db'));
  assert.equal(backup.prepare(`SELECT count(*) AS n FROM ${legacy}`).get().n, 2);
  assert.equal(backup.prepare('SELECT count(*) AS n FROM claims').get().n, old.claims.length);
  backup.close();
});

test('starting again on the migrated database changes nothing', () => {
  const before = raw().prepare('SELECT * FROM claims ORDER BY id').all();
  const run = spawnSync(process.execPath, ['-e', "import('./src/lib/server/db.js').then((db) => console.log(db.listEmployees().length))"], {
    env: { ...process.env, DATA_DIR: dir },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), '3'); // Fog Chasers, Bridge Trolls, New Hire
  assert.deepEqual(raw().prepare('SELECT * FROM claims ORDER BY id').all(), before);
});
