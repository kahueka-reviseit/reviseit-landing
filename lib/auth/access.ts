import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '../supabase/server';
import { canEnterWorkspace, type TeacherAccount } from './policy';
export async function accountContext() {
  const supabase = await createClient();
  if (!supabase) return { kind: 'unavailable' as const };
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { kind: 'anonymous' as const };
  const { data: account, error: accountError } = await supabase.from('teacher_accounts').select('*').eq('user_id', user.id).maybeSingle();
  if (accountError || !account) return { kind: 'unavailable' as const };
  return { kind: 'authenticated' as const, supabase, user, account: account as TeacherAccount };
}
export async function requireAccount() {
  const context = await accountContext();
  if (context.kind === 'unavailable') redirect('/login?message=unavailable');
  if (context.kind === 'anonymous') redirect('/login');
  return context;
}
export async function requireTeacher() {
  const context = await requireAccount();
  if (!canEnterWorkspace(context.account, context.user.email || '', !!context.user.email_confirmed_at)) redirect('/account');
  return context;
}
export async function requireReviewer() {
  const context = await requireAccount();
  const { data, error } = await context.supabase.rpc('is_account_reviewer');
  if (error || data !== true) redirect('/account');
  return context;
}
