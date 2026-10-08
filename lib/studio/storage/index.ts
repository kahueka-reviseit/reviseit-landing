import 'server-only';
import { LocalStudioStorage } from './local';
import { R2StudioStorage } from './r2';
import type { StudioStorage } from './types';

/**
 * Server-only storage selection. R2 credentials are read from server environment variables and are
 * never exposed through NEXT_PUBLIC_ variables. Local storage is refused in production builds.
 */
let cached: StudioStorage | null | undefined;
export function studioStorage(): StudioStorage | null {
  if (cached !== undefined) return cached;
  const mode = process.env.STUDIO_STORAGE;
  if (mode === 'r2') {
    const endpoint = process.env.STUDIO_R2_ENDPOINT, bucket = process.env.STUDIO_R2_BUCKET, accessKeyId = process.env.STUDIO_R2_ACCESS_KEY_ID, secretAccessKey = process.env.STUDIO_R2_SECRET_ACCESS_KEY;
    cached = endpoint && bucket && accessKeyId && secretAccessKey ? new R2StudioStorage({ endpoint, bucket, accessKeyId, secretAccessKey }) : null;
  } else if (mode === 'local' && process.env.NODE_ENV !== 'production' && process.env.STUDIO_LOCAL_STORAGE_DIR && process.env.STUDIO_LOCAL_SIGNING_SECRET) {
    cached = new LocalStudioStorage(process.env.STUDIO_LOCAL_STORAGE_DIR, Buffer.from(process.env.STUDIO_LOCAL_SIGNING_SECRET));
  } else cached = null;
  return cached;
}
