'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createClient } from '../../lib/supabase/server';
import { authConfig } from '../../lib/supabase/config';
import { requireAccount, requireReviewer } from '../../lib/auth/access';
import { ACCOUNT_UNAVAILABLE, schoolEmailError, passwordError } from '../../lib/auth/policy';
/** `field` marks the input the message belongs to; `title` heads a notice; `attempt` lets a refused form reset its password. */
export type FormState = { message: string; success?: boolean; title?: string; field?: string; email?: string; attempt?: number };
const text = (form: FormData, name: string) => String(form.get(name) || '').trim();
const password = (form: FormData) => String(form.get('password') || '');
// Email links return to the origin the person is using when it is one of our
// exact configured origins (teacher or administration); otherwise SITE_URL.
async function linkOrigin(config: NonNullable<ReturnType<typeof authConfig>>) {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host'), proto = h.get('x-forwarded-proto') || 'https';
    const origin = host ? `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}` : '';
    return config.trustedOrigins.includes(origin) ? origin : config.siteUrl;
  } catch { return config.siteUrl; }
}
export async function register(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, 'email').toLowerCase();
  const emailProblem = schoolEmailError(email);
  if (emailProblem) return { message: emailProblem, field: 'email' };
  const passwordProblem = passwordError(password(form));
  if (passwordProblem) return { message: passwordProblem, field: 'password' };
  const full_name = text(form, 'full_name'), school = text(form, 'school'), department = text(form, 'department');
  if ([full_name, school, department].some(value => value.length < 2 || value.length > 160)) return { message: 'Complete your name, school and department using 2 to 160 characters each.', field: 'details' };
  const supabase = await createClient(), config = authConfig();
  if (!supabase || !config) return { message: ACCOUNT_UNAVAILABLE };
  const { error } = await supabase.auth.signUp({ email, password: password(form), options: {
    emailRedirectTo: `${config.siteUrl}/auth/confirm`, data: { full_name, school, department },
  } });
  if (error) return { message: 'We could not create your account. Please try again later or contact kahueka@reviseit.io.' };
  return { success: true, email, message: 'Check your school email for a confirmation link. If you already have an account, sign in or reset your password. Our team will verify your school details before you can use the teacher workspace.' };
}
export async function login(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  if (!supabase) return { message: ACCOUNT_UNAVAILABLE };
  const { error } = await supabase.auth.signInWithPassword({ email: text(form, 'email').toLowerCase(), password: password(form) });
  if (error) return { title: 'We could not sign you in', message: 'Check your email and password. If you have just registered, confirm your school email first.', attempt: Date.now() };
  redirect('/account');
}
export async function forgotPassword(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await createClient(), config = authConfig();
  if (!supabase || !config) return { message: ACCOUNT_UNAVAILABLE };
  const { error } = await supabase.auth.resetPasswordForEmail(text(form, 'email'), { redirectTo: `${await linkOrigin(config)}/auth/confirm` });
  if (error && error.status && error.status >= 500) return { message: 'Email delivery is temporarily unavailable. Please try again later.' };
  return { success: true, message: 'If an account exists for that email, you will receive a password reset link. Check your inbox and spam folder.' };
}
export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const invalid = passwordError(password(form));
  if (invalid) return { message: invalid, field: 'password' };
  if (password(form) !== String(form.get('confirm_password') || '')) return { message: 'The passwords do not match.', field: 'confirm_password' };
  const { supabase } = await requireAccount();
  const { error } = await supabase.auth.updateUser({ password: password(form) });
  if (error) return { message: 'Your password could not be changed. Request a new reset link and try again.' };
  await supabase.auth.signOut();
  redirect('/login?message=password-updated');
}
export async function logout(): Promise<void> {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect('/login');
}
export async function saveDetails(_: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAccount();
  const { error } = await supabase.rpc('submit_school_details', { full_name: text(form, 'full_name'), school: text(form, 'school'), department: text(form, 'department') });
  if (error) return { message: 'We could not save these details. Check every field, or contact kahueka@reviseit.io if your account is restricted.' };
  revalidatePath('/account');
  return { success: true, message: 'Your details have been submitted for team verification.' };
}
export async function reviewAccount(_: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireReviewer();
  const { error } = await supabase.rpc('review_teacher_account', {
    target_user: text(form, 'user_id'), expected_revision: Number(text(form, 'revision')),
    decision: text(form, 'decision'), selected_department: text(form, 'department_id') || null, review_note: text(form, 'note'),
  });
  if (error) return { title: 'The decision was not saved', message: 'Refresh the page, confirm the teacher has verified their email, and check the school department and evidence. You cannot review your own account. Your choices in the panel are kept.' };
  revalidatePath('/admin/accounts');
  return { success: true, title: 'Decision saved', message: 'The account permission takes effect on its next request.' };
}
export async function registerDepartment(_: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireReviewer();
  const { error } = await supabase.rpc('register_school_department', { school_slug: text(form, 'slug'), school_name: text(form, 'school'), department_name: text(form, 'department') });
  if (error) return { message: 'Check the full school name, its lowercase hyphen-separated identifier, and the department name.' };
  revalidatePath('/admin/accounts');
  return { success: true, message: 'School department is available for verification decisions.' };
}
export async function confirmEmail(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await createClient();
  if (!supabase) return { message: ACCOUNT_UNAVAILABLE };
  const type = text(form, 'type');
  if (!['email', 'signup', 'recovery', 'email_change'].includes(type)) return { message: 'This link is invalid. Request a new confirmation or password reset link.' };
  const { error } = await supabase.auth.verifyOtp({ token_hash: text(form, 'token_hash'), type: type as 'email' | 'signup' | 'recovery' | 'email_change' });
  if (error) return { message: 'It has expired or has already been used. If you already confirmed, simply sign in.', field: 'expired' };
  redirect(type === 'recovery' ? '/reset-password' : '/account');
}
export async function resendConfirmation(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await createClient(), config = authConfig();
  if (!supabase || !config) return { message: ACCOUNT_UNAVAILABLE };
  await supabase.auth.resend({ type: 'signup', email: text(form, 'email'), options: { emailRedirectTo: `${await linkOrigin(config)}/auth/confirm` } });
  return { success: true, message: 'If your account is awaiting confirmation, a new link will be sent to your school email. Please allow a few minutes between requests.' };
}
