import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = process.env.SMOKE_PORT || '10101';
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['artifacts/api-server/dist/index.mjs'], {
  cwd: root,
  env: {
    ...process.env, NODE_ENV: 'production', PORT: port,
    STATIC_DIR: fileURLToPath(new URL('../artifacts/cut-render/dist/public', import.meta.url)),
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    // Valid development key format for a non-existent instance; no real credentials.
    CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('example.clerk.accounts.dev$').toString('base64').replace(/=+$/, '')}`,
    CLERK_SECRET_KEY: 'sk_test_smoke_not_a_real_key',
    CLERK_TELEMETRY_DISABLED: '1',
    R2_BUCKET: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (data) => { output += data; });
child.stderr.on('data', (data) => { output += data; });

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), 15_000);
    const check = (data) => {
      if (data.toString().includes('Server listening')) { clearTimeout(timeout); resolve(); }
    };
    child.stdout.on('data', check);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Server exited (${code}):\n${output}`)); });
  });
  const health = await fetch(`${origin}/api/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  const html = await home.text();
  assert.match(html, /<div id="root">/);
  const projects = await fetch(`${origin}/projects`);
  assert.equal(projects.status, 200);
  assert.equal(await projects.text(), html);
  const assetPath = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(assetPath, 'Built JS asset is referenced by index.html');
  const asset = await fetch(new URL(assetPath, origin));
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  await asset.body.cancel();
  assert.equal((await fetch(`${origin}/api/not-found`)).status, 404);
  const upload = await fetch(`${origin}/api/storage/uploads/request-url`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'test.png', size: 10, contentType: 'image/png' }),
  });
  assert.equal(upload.status, 401, 'Anonymous users cannot obtain upload URLs');
  console.log('Production smoke test passed: health, static assets, SPA, API 404, upload authentication.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
