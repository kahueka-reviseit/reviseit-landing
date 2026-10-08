import 'server-only';
import { redirect } from 'next/navigation';
import { requireReviewer } from '../auth/access';
import type { Rpc } from './contracts';

/**
 * Every Studio page, action and file read calls this. Existing administrator access (a confirmed
 * account reviewer) plus explicit Studio editor provisioning; the database functions repeat the
 * check on every command, so a parent layout is never the only boundary.
 */
export async function requireStudioEditor() {
  const context = await requireReviewer();
  const { data, error } = await context.supabase.rpc('studio_is_editor');
  if (error || data !== true) redirect('/admin');
  const rpc: Rpc = (name, args) => context.supabase.rpc(name, args);
  return { ...context, rpc };
}
