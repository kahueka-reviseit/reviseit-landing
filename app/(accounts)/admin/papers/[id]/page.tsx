import { notFound,redirect } from 'next/navigation';
import { requireAccount } from '../../../../../lib/auth/access';
import ReviewView from './view';
export const dynamic='force-dynamic';
export default async function Review({params}:{params:Promise<{id:string}>}){const {supabase}=await requireAccount();const {id}=await params;const r=await supabase.rpc('paper_review_queue',{target:id});if(r.error)redirect('/account');if(!r.data?.[0])notFound();return <ReviewView order={r.data[0]}/>;}
