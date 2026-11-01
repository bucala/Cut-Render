import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presignUrl, R2Storage, r2ConfigFromEnv, ObjectNotFoundError } from '../src/lib/r2Storage.ts';

const cfg = {
  accountId: 'example', accessKeyId: 'test-access', secretAccessKey: 'test-secret',
  bucket: 'artwork', privatePrefix: 'private', publicPrefix: 'public',
};

test('SigV4 matches the AWS S3 query authentication reference vector', () => {
  // Public example credentials from the AWS documentation, not real credentials.
  const url = new URL(presignUrl({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt',
    region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expiresSec: 86400, now: new Date('2013-05-24T00:00:00Z'),
  }));
  assert.equal(url.searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('R2 upload URL normalizes to the existing portable artwork path', async () => {
  const store = new R2Storage(cfg);
  const url = await store.getObjectEntityUploadURL();
  assert.match(store.normalizeObjectEntityPath(url), /^\/objects\/uploads\/[0-9a-f-]{36}$/);
  assert.equal(new URL(url).searchParams.get('X-Amz-Expires'), '900');
  assert.equal(store.normalizeObjectEntityPath('/objects/uploads/existing'), '/objects/uploads/existing');
  assert.equal(store.normalizeObjectEntityPath('https://other.test/image'), 'https://other.test/image');
});

test('SigV4 encodes object keys and limits expiry', () => {
  const url = new URL(presignUrl({
    method: 'PUT', host: 'example.r2.cloudflarestorage.com', path: "/bucket/a b/č!*.png",
    region: 'auto', accessKeyId: 'key', secretAccessKey: 'secret', expiresSec: 9999999,
  }));
  assert.equal(url.pathname, '/bucket/a%20b/%C4%8D%21%2A.png');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '604800');
});

test('configuration requires all R2 credentials and trims prefixes', () => {
  assert.throws(() => r2ConfigFromEnv({ R2_BUCKET: 'artwork' }), /R2_ACCOUNT_ID/);
  assert.equal(r2ConfigFromEnv({
    R2_ACCOUNT_ID: 'example', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'artwork', R2_PRIVATE_PREFIX: '/private/',
  }).privatePrefix, 'private');
});

test('object paths cannot escape the private namespace', async () => {
  const store = new R2Storage(cfg);
  for (const path of ['/other/key', '/objects/', '/objects/../public/key', '/objects/a//b']) {
    await assert.rejects(store.getObjectEntityFile(path), ObjectNotFoundError);
  }
  assert.equal(await store.searchPublicObject('../private/key'), null);
});

test('R2 reads stream content and distinguish missing objects from service failures', async (t) => {
  const store = new R2Storage(cfg);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.method, 'HEAD');
    return new Response(null, { status: 404 });
  });
  await assert.rejects(store.getObjectEntityFile('/objects/uploads/missing'), ObjectNotFoundError);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response('image-data', {
    headers: { 'Content-Type': 'image/png', 'Content-Length': '10' },
  }));
  const response = await store.downloadObject('private/uploads/id', 60);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'private, max-age=60');
  assert.equal(await response.text(), 'image-data');
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  await assert.rejects(store.exists('private/uploads/id'), /R2 HEAD failed \(403\)/);
});
