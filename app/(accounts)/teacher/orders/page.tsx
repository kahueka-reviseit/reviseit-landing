import { requireTeacher } from '../../../../lib/auth/access';
import type { Order } from '../../../../lib/jobs/contracts';
import { TeacherHeader } from '../../shell';
import PaperList from './list';
import ui from '../../experience.module.css';
export const dynamic='force-dynamic';
export default async function Orders(){
 const {supabase,account}=await requireTeacher();
 const [result,modules,school,department]=await Promise.all([supabase.rpc('teacher_orders'),supabase.from('curriculum_modules').select('id,name'),supabase.from('schools').select('name').eq('id',account.school_id!).maybeSingle(),supabase.from('departments').select('name').eq('id',account.department_id!).maybeSingle()]);
 const curricula=Object.fromEntries((modules.data||[]).map(m=>[m.id,m.name]));
 return <><TeacherHeader current="papers" name={account.full_name}/><main className={ui['site-shell__main']}>
  <PaperList orders={(result.data||[]) as Order[]} failed={!!result.error} curricula={curricula} school={[school.data?.name,department.data?.name].filter(Boolean).join(' · ')||undefined}/></main></>;
}
