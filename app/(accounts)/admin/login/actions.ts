'use server';
import { redirect } from 'next/navigation';
import { createClient } from '../../../../lib/supabase/server';
import { ACCOUNT_UNAVAILABLE } from '../../../../lib/auth/policy';
import type { FormState } from '../../actions';

export async function adminLogin(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  if (!supabase) return { message: ACCOUNT_UNAVAILABLE };
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(form.get('email') || '').trim().toLowerCase(),
    password: String(form.get('password') || ''),
  });
  if (error || !data.user) return { message: 'Unable to sign in to administration. Check your email and password.' };
  const role = await supabase.rpc('is_account_reviewer');
  if (!data.user.email_confirmed_at || role.error || role.data !== true) {
    await supabase.auth.signOut();
    return { message: 'This account does not have administration access. Teachers use pilot.reviseit.io.' };
  }
  redirect('/admin');
}
