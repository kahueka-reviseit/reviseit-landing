import { requireTeacher } from '../../../lib/auth/access';
import { readWorkspace } from '../../../lib/workspace/server';
import { TeacherHeader } from '../shell';
import WorkspaceView from './workspace';
import ui from '../experience.module.css';
export const dynamic='force-dynamic';
export default async function Teacher() {
  const {supabase,account}=await requireTeacher();
  let initial;
  try { initial=await readWorkspace(supabase,account.school_id!); }
  catch { return <><TeacherHeader current="curricula" name={account.full_name}/><main className={ui['site-shell__main']}><div className={ui['page']}><header className={ui['page-header']}><div className={ui['page-header__titles']}><h1 className={ui['page-header__title']}>My curricula</h1></div></header>
    <div className={ui['notice--problem']} role="alert"><p className={ui['notice__title']}>Your workspace is temporarily unavailable</p><p className={ui['notice__body']}>We could not load your curricula. Your saved work is safe. Please try again shortly.</p><div className={ui['notice__actions']}><a className={ui['button--secondary']} href="/teacher">Try again</a></div></div></div></main></>; }
  return <><TeacherHeader current="curricula" name={account.full_name}/><main className={ui['site-shell__main']}><WorkspaceView initial={initial}/></main></>;
}
