import Link from 'next/link';
import { requireAccount } from '../../../lib/auth/access';
import { canEnterWorkspace } from '../../../lib/auth/policy';
import { AccountForm, SchoolFields } from '../forms';
import { logout, saveDetails } from '../actions';
import styles from '../accounts.module.css';
const copy = {
  pending: ['Your account is awaiting verification', 'Our team will check your school email and school details. You can return here to check your progress. The teacher workspace becomes available after approval.'],
  approved: ['Your school account is verified', 'Your teacher workspace is ready to access.'],
  rejected: ['We could not verify your account', 'Contact kahueka@reviseit.io if you believe your school details need another review.'],
  suspended: ['Your account access is paused', 'Contact kahueka@reviseit.io for help with your account.'],
};
export default async function Account() {
  const { account, user, supabase } = await requireAccount();
  const confirmed = !!user.email_confirmed_at;
  const approved = canEnterWorkspace(account, user.email || '', confirmed);
  const [heading, description] = !confirmed ? ['Confirm your school email', 'Check your school inbox and follow the confirmation link. Our team will then verify your account.'] : copy[approved ? 'approved' : account.status === 'approved' ? 'pending' : account.status];
  const { data: reviewer } = await supabase.rpc('is_account_reviewer');
  return <section className={styles.card}><span className={styles.eyebrow}>My account</span><h1>{heading}</h1><p>{description}</p><p><strong>{account.full_name}</strong><br />{user.email}<br />{account.requested_school}<br />{account.requested_department}</p>
    {approved && <p><Link href="/teacher">Open teacher workspace</Link></p>}
    {reviewer === true && <p><Link href="/admin/accounts">Review school accounts</Link></p>}
    {['pending','approved'].includes(account.status) && <details className={styles.details}><summary>Update my school details</summary><p>Submitting a change puts your account back into verification. Workspace access pauses until our team approves the new details.</p><AccountForm action={saveDetails} label="Submit for verification"><SchoolFields account={account} /></AccountForm></details>}
    <form action={logout}><button className={styles.button}>Log out</button></form></section>;
}
