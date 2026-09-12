import Link from 'next/link';
import { requireReviewer } from '../../../../lib/auth/access';
import { AccountForm } from '../../forms';
import { reviewAccount, registerDepartment } from '../../actions';
import styles from '../../accounts.module.css';
export default async function ReviewAccounts({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const requested = Number((await searchParams).page || 1);
  const currentPage = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const offset = (currentPage - 1) * 50;
  const { supabase, user } = await requireReviewer();
  const [accountsResult, departmentsResult, schoolsResult] = await Promise.all([
    supabase.from('teacher_accounts').select('*', { count: 'exact' }).neq('user_id',user.id).order('created_at', { ascending: false }).order('user_id').range(offset, offset + 49),
    supabase.from('departments').select('id,school_id,name').order('name'),
    supabase.from('schools').select('id,name').order('name'),
  ]);
  if (accountsResult.error || departmentsResult.error || schoolsResult.error) throw new Error('Account review is temporarily unavailable');
  const schools = new Map(schoolsResult.data.map(s => [s.id, s.name]));
  return <section className={`${styles.card} ${styles.wide}`}><span className={styles.eyebrow}>Internal team</span><h1>Verify school accounts</h1><p>Check the teacher’s school affiliation independently before approval. An email domain alone is insufficient. Every decision records your identity, time and evidence. Accounts are shown in pages of 50.</p>
    <details className={styles.details}><summary>Add a verified school department</summary><AccountForm action={registerDepartment} label="Save school department"><label>Full school name<input name="school" required minLength={2} maxLength={160} /></label><label>School identifier<input name="slug" placeholder="full-canonical-school-name" pattern="[a-z0-9]+(-[a-z0-9]+)*" required maxLength={160} /></label><label>Department<input name="department" required minLength={2} maxLength={160} /></label></AccountForm></details>
    {accountsResult.data.length === 0 && <p>No school accounts are awaiting review.</p>}
    {accountsResult.data.filter(a => a.user_id !== user.id).map(a => <article className={styles.review} key={a.user_id}><h2>{a.full_name || 'School details incomplete'}</h2><p>{a.email}<br />{a.requested_school} · {a.requested_department}<br /><strong>Status: {a.status}</strong><br />Email: {a.email_confirmed_at ? 'Confirmed' : 'Awaiting confirmation'}</p>
      <AccountForm action={reviewAccount} label="Save verification decision"><input type="hidden" name="user_id" value={a.user_id} /><input type="hidden" name="revision" value={a.revision} />
        <label>Decision<select name="decision" required defaultValue=""><option value="" disabled>Choose a decision</option><option value="approved" disabled={!a.email_confirmed_at}>Approve</option><option value="rejected">Reject</option><option value="suspended">Suspend access</option></select></label>
        <label>Verified school and department<select name="department_id" defaultValue={a.department_id || ''}><option value="">Required for approval</option>{departmentsResult.data.map(d => <option key={d.id} value={d.id}>{schools.get(d.school_id)} · {d.name}</option>)}</select></label>
        <label>Verification evidence or reason<textarea name="note" required minLength={3} maxLength={2000} /></label>
      </AccountForm></article>)}
    <nav className={styles.links} aria-label="Account review pages">{currentPage > 1 && <Link href={`/admin/accounts?page=${currentPage - 1}`}>Previous page</Link>}{(accountsResult.count || 0) > offset + 50 && <Link href={`/admin/accounts?page=${currentPage + 1}`}>Next page</Link>}</nav>
  </section>;
}
