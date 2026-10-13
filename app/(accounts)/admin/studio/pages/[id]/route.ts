import { accountContext } from '../../../../../../lib/auth/access';
import { isUuid } from '../../../../../../lib/studio/contracts';
import { studioStorage } from '../../../../../../lib/studio/storage';
import { readArtifact } from '../../../../../../lib/studio/uploads';
import { sourcePagePng } from '../../../../../../lib/studio/inventory-review';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!isUuid(id)) return new Response('Not found', { status: 404, headers });
  const context = await accountContext();
  if (context.kind !== 'authenticated') return new Response('Sign in required', { status: 401, headers });
  const editor = await context.supabase.rpc('studio_is_editor');
  if (editor.error || editor.data !== true) return new Response('Access denied', { status: 403, headers });
  const storage = studioStorage(); if (!storage) return new Response('Storage unavailable', { status: 503, headers });
  try {
    const { info, bytes } = await readArtifact((n, a) => context.supabase.rpc(n, a), storage, id);
    return new Response(sourcePagePng(info, bytes), { headers: { ...headers, 'Content-Type': 'image/png' } });
  } catch { return new Response('Source image unavailable or failed verification', { status: 409, headers }); }
}
