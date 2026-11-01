/**
 * Run in the original Replit workspace (its storage sidecar must be available).
 * Dry run by default; --apply copies artwork to R2 without changing project paths.
 */
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { R2Storage, r2ConfigFromEnv } from '../artifacts/api-server/src/lib/r2Storage.ts';

const require = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { Storage } = require('@google-cloud/storage');
const apply = process.argv.includes('--apply');

function parseDir(dir) {
  const parts = dir.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length < 2 || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid Replit object directory.');
  }
  return { bucket: parts[0], prefix: `${parts.slice(1).join('/')}/` };
}

async function main() {
  if (!process.env.PRIVATE_OBJECT_DIR) throw new Error('PRIVATE_OBJECT_DIR is required. Run this in the original Replit workspace.');
  const cfg = r2ConfigFromEnv();
  const r2 = new R2Storage(cfg);
  const storage = new Storage({
    projectId: '',
    credentials: {
      audience: 'replit', subject_token_type: 'access_token', type: 'external_account',
      token_url: 'http://127.0.0.1:1106/token',
      credential_source: {
        url: 'http://127.0.0.1:1106/credential',
        format: { type: 'json', subject_token_field_name: 'access_token' },
      },
      universe_domain: 'googleapis.com',
    },
  });
  const dirs = [
    { dir: process.env.PRIVATE_OBJECT_DIR, target: cfg.privatePrefix },
    ...(process.env.PUBLIC_OBJECT_SEARCH_PATHS || '').split(',').map((dir) => dir.trim()).filter(Boolean)
      .map((dir) => ({ dir, target: cfg.publicPrefix })),
  ];
  let count = 0;
  let skipped = 0;
  const seen = new Set();
  for (const { dir, target } of dirs) {
    const { bucket, prefix } = parseDir(dir);
    let query = { prefix, autoPaginate: false, maxResults: 100 };
    do {
      const [files, nextQuery] = await storage.bucket(bucket).getFiles(query);
      for (const file of files) {
        if (file.name.endsWith('/')) continue;
        const key = `${target}/${file.name.slice(prefix.length)}`;
        // Public search paths are ordered; the first match wins in the original service.
        if (seen.has(key)) continue;
        seen.add(key);
        count++;
        if (!apply) continue;
        const [metadata] = await file.getMetadata();
        const existing = await fetch(r2.presign('HEAD', key, 60), { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
        if (existing.ok) {
          if (existing.headers.get('content-length') !== String(metadata.size)) {
            throw new Error('R2 already contains an object with a different size. Refusing to overwrite it.');
          }
          skipped++;
          continue;
        }
        if (existing.status !== 404) throw new Error(`R2 existence check failed (${existing.status}).`);
        const response = await fetch(r2.presign('PUT', key, 900), {
          method: 'PUT',
          headers: {
            'Content-Type': metadata.contentType || 'application/octet-stream',
            'Content-Length': String(metadata.size),
            'If-None-Match': '*',
          },
          body: Readable.toWeb(file.createReadStream()),
          duplex: 'half',
          signal: AbortSignal.timeout(300_000),
        });
        if (!response.ok) throw new Error(`R2 upload failed (${response.status}).`);
        await response.body?.cancel();
        const check = await fetch(r2.presign('HEAD', key, 60), { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
        if (!check.ok || check.headers.get('content-length') !== String(metadata.size)) {
          throw new Error('Uploaded object failed size verification.');
        }
        if (count % 25 === 0) console.log(`Processed ${count} objects.`);
      }
      query = nextQuery;
    } while (query);
  }
  console.log(apply
    ? `Finished: ${count - skipped} copied, ${skipped} existing objects skipped (same size).`
    : `Dry run: ${count} objects found. Rerun with --apply to copy them.`);
  console.log('Source objects were not modified. Project /objects/... paths remain unchanged.');
}

main().catch(() => {
  // SDK errors can contain signed URLs. Keep credentials and private object names out of logs.
  console.error('Object migration failed. Check Replit storage access, R2 configuration and target object sizes. No source objects were changed.');
  process.exitCode = 1;
});
