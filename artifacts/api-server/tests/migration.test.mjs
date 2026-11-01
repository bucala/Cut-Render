import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateDatabase } from '../../../scripts/migrate-database.mjs';

function clients({ nonempty = false, failInsert = false } = {}) {
  const sourceQueries = [];
  const targetQueries = [];
  let closed = 0;
  const source = {
    async connect() {},
    async end() { closed++; },
    async query(sql, values) {
      sourceQueries.push({ sql, values });
      if (sql.startsWith('SELECT count')) return { rows: [{ count: '1' }] };
      if (sql.startsWith('SELECT last_value')) return { rows: [{ last_value: '99', is_called: true }] };
      if (sql.startsWith('SELECT *')) return {
        fields: [
          { name: 'id', dataTypeID: 23 }, { name: 'parameters', dataTypeID: 3802 },
          { name: 'created_at', dataTypeID: 1184 },
        ],
        rows: values[0] > 0 ? [] : [{ id: 7, parameters: [{ text: 'Artwork' }], created_at: '2026-01-01 12:00:00.123456+00' }],
      };
      return { rows: [] };
    },
  };
  const target = {
    async connect() {},
    async end() { closed++; },
    async query(sql, values) {
      targetQueries.push({ sql, values });
      if (sql.startsWith('SELECT count')) return { rows: [{ count: nonempty ? '1' : '0' }] };
      if (sql.startsWith('INSERT') && failInsert) throw new Error('Simulated write failure');
      return { rows: [] };
    },
  };
  return { source, target, sourceQueries, targetQueries, closed: () => closed };
}

test('migration dry run never inserts, changes sequences or commits', async () => {
  const db = clients();
  await migrateDatabase({ ...db, log() {} });
  assert.ok(!db.targetQueries.some(({ sql }) => /^(INSERT|ALTER|COMMIT|LOCK)/.test(sql)));
  assert.equal(db.closed(), 2);
});

test('migration refuses nonempty destinations before any write', async () => {
  const db = clients({ nonempty: true });
  await assert.rejects(migrateDatabase({ ...db, apply: true, log() {} }), /not empty/);
  assert.ok(!db.targetQueries.some(({ sql }) => /^(INSERT|ALTER|COMMIT)/.test(sql)));
  assert.ok(db.targetQueries.some(({ sql }) => sql === 'ROLLBACK'));
});

test('migration preserves IDs, JSON arrays, precise timestamps and sequence high-water marks', async () => {
  const db = clients();
  await migrateDatabase({ ...db, apply: true, log() {} });
  const inserts = db.targetQueries.filter(({ sql }) => sql.startsWith('INSERT'));
  assert.equal(inserts.length, 3);
  assert.deepEqual(inserts[0].values, [7, '[{"text":"Artwork"}]', '2026-01-01 12:00:00.123456+00']);
  assert.ok(db.targetQueries.some(({ sql }) => sql === 'ALTER SEQUENCE public.projects_id_seq RESTART WITH 100'));
  assert.ok(db.targetQueries.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(db.sourceQueries.some(({ sql }) => sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.ok(!db.sourceQueries.some(({ sql }) => /^(INSERT|UPDATE|DELETE|ALTER)/.test(sql)));
});

test('migration rolls back the destination when copying fails', async () => {
  const db = clients({ failInsert: true });
  await assert.rejects(migrateDatabase({ ...db, apply: true, log() {} }), /Simulated write failure/);
  assert.ok(!db.targetQueries.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(db.targetQueries.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(db.closed(), 2);
});

test('migration does not queue rollback queries on clients that never connected', async () => {
  const db = clients();
  db.target.connect = async () => { throw new Error('Cannot connect'); };
  await assert.rejects(migrateDatabase({ ...db, apply: true, log() {} }), /Cannot connect/);
  assert.equal(db.targetQueries.length, 0);
  assert.equal(db.closed(), 2);
});
