export const SCHOOL_EMAIL_NOTICE = 'Create your account using your school email address. Our team will verify your account before you can use the teacher platform.';
export const ACCOUNT_UNAVAILABLE = 'Account services are not available yet. Please try again later.';
// This catches common personal providers only. Human review establishes school affiliation.
const personalDomains = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com']);
export function schoolEmailError(email: string): string | null {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid school email address.';
  if (personalDomains.has(email.split('@')[1].toLowerCase())) return 'Use your school-issued email address. If your school uses a personal email provider, contact kahueka@reviseit.io for help.';
  return null;
}
export function passwordError(password: string): string | null {
  return password.length < 12 || password.length > 128 ? 'Use a password between 12 and 128 characters.' : null;
}
export type TeacherAccount = {
  user_id: string; email: string; full_name: string; requested_school: string; requested_department: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended'; school_id: string | null;
  department_id: string | null; revision: number; reviewed_at: string | null;
};
export function canEnterWorkspace(account: TeacherAccount | null, email: string, confirmed: boolean): boolean {
  return !!(confirmed && account?.status === 'approved' && account.school_id && account.department_id && account.email.toLowerCase() === email.toLowerCase());
}
