import { notFound } from 'next/navigation';
import { requireTeacher } from '../../../../../lib/auth/access';
import { isUuid } from '../../../../../lib/jobs/contracts';
import OrderView from './view';
export const dynamic='force-dynamic';
export default async function OrderPage({params}:{params:Promise<{id:string}>}){
 const {supabase}=await requireTeacher();const {id}=await params;if(!isUuid(id))notFound();
 const r=await supabase.rpc('teacher_orders',{target:id});if(r.error)throw new Error('Request temporarily unavailable');if(!r.data?.[0])notFound();
 const order=r.data[0];
 // Display-only labels use the teacher's RLS-protected catalogue and the order's
 // exact release. Unavailable historical labels do not block an existing order.
 const catalogue=order.configurable?await supabase.from('teacher_catalogue_summaries').select('entry_id,topic').eq('module_id',order.moduleId).eq('release',order.release):null;
 const topics:Record<string,string>=Object.fromEntries((catalogue?.data??[]).map(c=>[c.entry_id,c.topic]));
 return <OrderView initial={order} topics={topics}/>;
}
