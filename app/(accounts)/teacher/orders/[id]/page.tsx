import { notFound } from 'next/navigation';
import { requireTeacher } from '../../../../../lib/auth/access';
import { isUuid } from '../../../../../lib/jobs/contracts';
import { questionContexts } from '../../../../../lib/workspace/catalogue';
import { TeacherHeader } from '../../../shell';
import ui from '../../../experience.module.css';
import OrderView from './view';
export const dynamic='force-dynamic';
export default async function OrderPage({params}:{params:Promise<{id:string}>}){
 const {supabase,account}=await requireTeacher();const {id}=await params;if(!isUuid(id))notFound();
 const r=await supabase.rpc('teacher_orders',{target:id});if(r.error)throw new Error('Request temporarily unavailable');if(!r.data?.[0])notFound();
 const order=r.data[0];
 // Display-only reminders use the teacher's RLS-protected catalogue and the order's
 // exact release. Unavailable historical entries do not block an existing order.
 const [catalogue,module]=await Promise.all([
  order.configurable?supabase.from('teacher_catalogue_summaries').select('entry_id,topic,description,thumbnail_alt').eq('module_id',order.moduleId).eq('release',order.release):null,
  supabase.from('curriculum_modules').select('name').eq('id',order.moduleId).maybeSingle()]);
 // Promise an email only when completion email is actually on for this teacher.
 const delivery=await supabase.rpc('my_email_delivery');
 const completionEmail=!delivery.error&&delivery.data?.completionEmail===true&&typeof delivery.data.address==='string'?delivery.data.address:null;
 return <><TeacherHeader current="papers" name={account.full_name}/><main className={ui['site-shell__main']}>
  <OrderView initial={order} curriculum={module.data?.name??undefined} catalogue={questionContexts(order.moduleId,order.release,catalogue?.data)} completionEmail={completionEmail}/></main></>;
}
