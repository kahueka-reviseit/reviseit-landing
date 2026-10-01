import {creditsEnabled} from '../../../lib/credits/server';
import { requireTeacher } from '../../../lib/auth/access';
import { readWorkspace } from '../../../lib/workspace/server';
import { TeacherHeader } from '../shell';
import WorkspaceView from './workspace';
import ui from '../experience.module.css';
import { Notice } from '../system/notice';
import { button } from '../system/button';
export const dynamic='force-dynamic';
export default async function Teacher() {
  const {supabase,account}=await requireTeacher();
  let initial;
  try { initial=await readWorkspace(supabase,account.school_id!); }
  catch { return <><TeacherHeader departmentEnabled={creditsEnabled()} current="curricula" name={account.full_name}/><main className={ui['site-shell__main']}><div className={ui['page']}><header className={ui['page-header']}><div className={ui['page-header__titles']}><h1 className={ui['page-header__title']}>My curricula</h1></div></header>
    <Notice tone="problem" role="alert" prominent title="Your workspace is temporarily unavailable" actions={<a className={button('secondary')} href="/teacher">Try again</a>}>We could not load your curricula. Your saved work is safe. Please try again shortly.</Notice></div></main></>; }
  return <><TeacherHeader departmentEnabled={creditsEnabled()} current="curricula" name={account.full_name}/><main className={ui['site-shell__main']}><WorkspaceView initial={initial}/></main></>;
}
