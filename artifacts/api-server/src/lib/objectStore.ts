import { ObjectStorageService } from './objectStorage';
import { R2Storage, r2ConfigFromEnv } from './r2Storage';

export { ObjectNotFoundError } from './r2Storage';

/** Common surface of the Replit App Storage service and Cloudflare R2. */
export interface ObjectStore {
  getObjectEntityUploadURL(): Promise<string>;
  normalizeObjectEntityPath(rawPath: string): string;
  getObjectEntityFile(objectPath: string): Promise<unknown>;
  searchPublicObject(filePath: string): Promise<unknown | null>;
  downloadObject(handle: unknown, cacheTtlSec?: number): Promise<Response>;
}

/** R2 when it is configured (Render), otherwise Replit App Storage. */
export function createObjectStore(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  return env.R2_BUCKET ? new R2Storage(r2ConfigFromEnv(env)) : (new ObjectStorageService() as ObjectStore);
}
