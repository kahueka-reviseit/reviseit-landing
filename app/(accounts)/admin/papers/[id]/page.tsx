import { redirect } from 'next/navigation';
import { isUuid } from '../../../../../lib/jobs/contracts';
export const dynamic='force-dynamic';
/** Older links to one paper open its record panel in the Papers queue. */
export default async function Review({params}:{params:Promise<{id:string}>}){const {id}=await params;redirect(isUuid(id)?`/admin/papers?record=${id}`:'/admin/papers');}
