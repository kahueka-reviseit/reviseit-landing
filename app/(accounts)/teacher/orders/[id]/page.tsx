import { notFound } from 'next/navigation';
import { requireTeacher } from '../../../../../lib/auth/access';
import { isUuid } from '../../../../../lib/jobs/contracts';
import OrderView from './view';
export const dynamic='force-dynamic';
export default async function OrderPage({params}:{params:Promise<{id:string}>}){
 const {supabase}=await requireTeacher();const {id}=await params;if(!isUuid(id))notFound();
 const r=await supabase.rpc('teacher_orders',{target:id});if(r.error)throw new Error('Request temporarily unavailable');if(!r.data?.[0])notFound();
 return <OrderView initial={r.data[0]}/>;
}
