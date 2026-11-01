/**
 * One-time copy from Replit to an EMPTY, already provisioned Neon schema.
 * Run without --apply first. URLs are read from environment variables, never CLI arguments.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../lib/db/package.json', import.meta.url));
const { Client, types } = require('pg');
const tables = ['projects', 'project_exports', 'activity'];

export async function migrateDatabase({ source, target, apply = false, log = console.log }) {
  let sourceConnected = false;
  let targetConnected = false;
  try {
    await source.connect();
    sourceConnected = true;
    await target.connect();
    targetConnected = true;
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await target.query('BEGIN');
    await source.query("SET LOCAL statement_timeout = '60s'");
    await target.query("SET LOCAL lock_timeout = '15s'");
    await target.query("SET LOCAL statement_timeout = '60s'");
    // No application writes may race with the empty-target check.
    if (apply) await target.query('LOCK TABLE public.projects, public.project_exports, public.activity IN ACCESS EXCLUSIVE MODE');
    for (const table of tables) {
      const from = await source.query(`SELECT count(*)::text AS count FROM public.${table}`);
      const to = await target.query(`SELECT count(*)::text AS count FROM public.${table}`);
      if (to.rows[0].count !== '0') throw new Error(`Target table ${table} is not empty. Nothing will be overwritten.`);
      log(`${table}: ${from.rows[0].count} rows to copy`);
    }
    if (!apply) {
      log('Dry run complete. Stop writes on Replit, then rerun with --apply.');
      return;
    }
    for (const table of tables) {
      let lastId = 0;
      let copied = 0;
      while (true) {
        const batch = await source.query(`SELECT * FROM public.${table} WHERE id > $1 ORDER BY id LIMIT 100`, [lastId]);
        if (!batch.rows.length) break;
        const columns = batch.fields.map((field) => `"${field.name.replaceAll('"', '""')}"`).join(', ');
        const placeholders = batch.fields.map((_, i) => `$${i + 1}`).join(', ');
        for (const row of batch.rows) {
          const values = batch.fields.map((field) => {
            const value = row[field.name];
            // node-postgres otherwise serializes JSON arrays as PostgreSQL arrays.
            return value != null && [114, 3802].includes(field.dataTypeID) ? JSON.stringify(value) : value;
          });
          await target.query(`INSERT INTO public.${table} (${columns}) VALUES (${placeholders})`, values);
          lastId = row.id;
          copied++;
        }
      }
      // ALTER SEQUENCE is transactional, unlike setval. IDs are preserved without collisions.
      const { rows: [sequence] } = await source.query(`SELECT last_value::text, is_called FROM public.${table}_id_seq`);
      const sourceNext = BigInt(sequence.last_value) + (sequence.is_called ? 1n : 0n);
      const nextId = sourceNext > BigInt(lastId) ? sourceNext : BigInt(lastId) + 1n;
      await target.query(`ALTER SEQUENCE public.${table}_id_seq RESTART WITH ${nextId}`);
      log(`${table}: copied ${copied} rows`);
    }
    await target.query('COMMIT');
    log('Database copy committed. Source database was not modified.');
  } finally {
    await Promise.allSettled([
      ...(sourceConnected ? [source.query('ROLLBACK')] : []),
      ...(targetConnected ? [target.query('ROLLBACK')] : []),
    ]);
    await Promise.allSettled([source.end(), target.end()]);
  }
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (!sourceUrl || !targetUrl) throw new Error('Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL.');
  if (sourceUrl === targetUrl) throw new Error('Source and target must be different databases.');
  const source = new Client({
    connectionString: sourceUrl,
    connectionTimeoutMillis: 15_000,
    types: {
      // Keep PostgreSQL microseconds instead of rounding timestamps through JS Date.
      getTypeParser: (oid, format) => [1114, 1184].includes(oid) ? (value) => value : types.getTypeParser(oid, format),
    },
  });
  const target = new Client({ connectionString: targetUrl, connectionTimeoutMillis: 15_000 });
  await migrateDatabase({ source, target, apply: process.argv.includes('--apply') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // pg errors can contain row data or credentials. Do not print the full error.
    console.error(error.code ? `Database migration failed (${error.code}). Transaction rolled back.` : error.message);
    process.exitCode = 1;
  });
}
