import { createHash, createHmac, randomUUID } from 'node:crypto';

/**
 * Cloudflare R2 object storage through its S3-compatible API.
 * Requests are authorised with SigV4 query presigning, so no AWS SDK is needed:
 * the browser uploads straight to R2 and the server streams reads through presigned GETs.
 * Kept free of relative imports so tests and the migration script can load it with Node's type stripping.
 */

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

export interface PresignOptions {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  host: string;
  /** Unencoded absolute path, e.g. /bucket/private/uploads/id */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresSec: number;
  service?: string;
  now?: Date;
}

/** AWS Signature Version 4 query-string presigning with an unsigned payload. */
export function presignUrl(o: PresignOptions): string {
  const service = o.service ?? 's3';
  const amzDate = (o.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${o.region}/${service}/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${o.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(Math.min(604800, Math.max(1, Math.round(o.expiresSec))))],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .sort()
    .join('&');
  const uri = o.path.split('/').map(rfc3986).join('/');
  const canonical = [o.method, uri, query, `host:${o.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${o.secretAccessKey}`, day), o.region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `https://${o.host}${uri}?${query}&X-Amz-Signature=${signature}`;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  privatePrefix: string;
  publicPrefix: string;
}

export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config {
  const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Cloudflare R2 is not configured, missing: ${missing.join(', ')}`);
  const trim = (s: string) => s.replace(/^\/+|\/+$/g, '');
  return {
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: env.R2_BUCKET!,
    privatePrefix: trim(env.R2_PRIVATE_PREFIX ?? 'private'),
    publicPrefix: trim(env.R2_PUBLIC_PREFIX ?? 'public'),
  };
}

/** Object keys are the handle; the interface mirrors the Replit storage service used by the routes. */
export class R2Storage {
  private readonly cfg: R2Config;

  constructor(cfg: R2Config = r2ConfigFromEnv()) {
    this.cfg = cfg;
  }

  get host(): string {
    return `${this.cfg.accountId}.r2.cloudflarestorage.com`;
  }

  presign(method: PresignOptions['method'], key: string, expiresSec: number): string {
    return presignUrl({
      method, host: this.host, path: `/${this.cfg.bucket}/${key}`, region: 'auto',
      accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey, expiresSec,
    });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    return this.presign('PUT', `${this.cfg.privatePrefix}/uploads/${randomUUID()}`, 900);
  }

  normalizeObjectEntityPath(rawPath: string): string {
    let url: URL;
    try { url = new URL(rawPath); } catch { return rawPath; }
    if (url.host !== this.host) return rawPath;
    const prefix = `/${this.cfg.bucket}/${this.cfg.privatePrefix}/`;
    const path = decodeURIComponent(url.pathname);
    return path.startsWith(prefix) ? `/objects/${path.slice(prefix.length)}` : path;
  }

  /** Maps /objects/<id> to its key; throws ObjectNotFoundError when it does not exist. */
  async getObjectEntityFile(objectPath: string): Promise<string> {
    const key = this.privateKey(objectPath);
    if (!key || !(await this.exists(key))) throw new ObjectNotFoundError();
    return key;
  }

  privateKey(objectPath: string): string | null {
    if (!objectPath.startsWith('/objects/')) return null;
    const id = objectPath.slice('/objects/'.length);
    if (!id || id.split('/').some((s) => !s || s === '.' || s === '..')) return null;
    return `${this.cfg.privatePrefix}/${id}`;
  }

  async searchPublicObject(filePath: string): Promise<string | null> {
    if (filePath.split('/').some((s) => !s || s === '.' || s === '..')) return null;
    const key = `${this.cfg.publicPrefix}/${filePath}`;
    return (await this.exists(key)) ? key : null;
  }

  async exists(key: string): Promise<boolean> {
    const res = await fetch(this.presign('HEAD', key, 60), { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`R2 HEAD failed (${res.status})`);
    return true;
  }

  async downloadObject(key: string, cacheTtlSec = 3600): Promise<Response> {
    const res = await fetch(this.presign('GET', key, 300), { signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) throw new ObjectNotFoundError();
    if (!res.ok) throw new Error(`R2 GET failed (${res.status})`);
    const headers: Record<string, string> = {
      'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': `private, max-age=${cacheTtlSec}`,
    };
    const length = res.headers.get('content-length');
    if (length) headers['Content-Length'] = length;
    return new Response(res.body, { headers });
  }
}
