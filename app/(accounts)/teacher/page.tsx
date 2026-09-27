import { requireTeacher } from '../../../lib/auth/access';
import { readWorkspace } from '../../../lib/workspace/server';
import WorkspaceView from './workspace';
import styles from '../accounts.module.css';
export const dynamic='force-dynamic';
export default async function Teacher() {
  const {supabase,account}=await requireTeacher();
  let initial;
  try { initial=await readWorkspace(supabase,account.school_id!); }
  catch { return <section className={styles.card}><h1>Your workspace is temporarily unavailable</h1><p>We could not load your curricula. Your saved work is safe. Please try again shortly.</p><a href="/teacher">Try again</a></section>; }
  return <WorkspaceView initial={initial}/>;
}
