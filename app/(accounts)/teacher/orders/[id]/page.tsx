import { notFound } from 'next/navigation';
import { requireTeacher } from '../../../../../lib/auth/access';
import { isUuid } from '../../../../../lib/jobs/contracts';
import { questionContexts } from '../../../../../lib/workspace/catalogue';
import OrderView from './view';
export const dynamic='force-dynamic';
export default async function OrderPage({params}:{params:Promise<{id:string}>}){
 const {supabase}=await requireTeacher();const {id}=await params;if(!isUuid(id))notFound();
 const r=await supabase.rpc('teacher_orders',{target:id});if(r.error)throw new Error('Request temporarily unavailable');if(!r.data?.[0])notFound();
 const order=r.data[0];
 // Display-only reminders use the teacher's RLS-protected catalogue and the order's
 // exact release. Unavailable historical entries do not block an existing order.
 const catalogue=order.configurable?await supabase.from('teacher_catalogue_summaries').select('entry_id,topic,description,thumbnail_alt').eq('module_id',order.moduleId).eq('release',order.release):null;
 return <OrderView initial={order} catalogue={questionContexts(order.moduleId,order.release,catalogue?.data)}/>;
}
