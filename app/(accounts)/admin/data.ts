import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Staff reads (Paper S2 to S8p). Everything goes through the reviewer's own session,
 * so the existing row-level security and reviewer checks still decide what is visible.
 * Counts and filters are ordinary reads over the same lists; there is no new write.
 */
export type AccountStatus = 'pending'|'approved'|'rejected'|'suspended';
export const accountFilters = [
  {key:'pending',label:'Needs a decision'},{key:'approved',label:'Verified'},{key:'rejected',label:'Not verified'},{key:'suspended',label:'Paused'},{key:'all',label:'All statuses'},
] as const;
export type AccountFilter = typeof accountFilters[number]['key'];
export const statusLabels:Record<AccountStatus,{label:string;tone:'attention'|'done'|'problem'}> = {
  pending:{label:'Pending',tone:'attention'},approved:{label:'Verified',tone:'done'},rejected:{label:'Not verified',tone:'problem'},suspended:{label:'Paused',tone:'problem'},
};
export type Attention = {orderId:string; state:string; mode:string; paidAt:string|null; paymentIntent:string|null; school:string; teacherEmail:string; reason:string};
export type ReviewItem = {id:string; title:string; state:string};

/** A search term safe to place inside a PostgREST `or` filter: letters, digits, spaces and simple punctuation only. */
export function searchTerm(q:string|undefined):string {
  return (q??'').normalize('NFKC').replace(/[^\p{L}\p{N}@.\- ']/gu,' ').replace(/\s+/g,' ').trim().slice(0,80);
}
export function isFilter(value:unknown):value is AccountFilter { return accountFilters.some(f=>f.key===value); }

export async function accountCounts(supabase:SupabaseClient, self:string) {
  const count=(status:AccountStatus)=>supabase.from('teacher_accounts').select('user_id',{count:'exact',head:true}).neq('user_id',self).eq('status',status);
  const results=await Promise.all((['pending','approved','rejected','suspended'] as const).map(count));
  if(results.some(r=>r.error)) return null;
  const [pending,approved,rejected,suspended]=results.map(r=>r.count??0);
  return {pending,approved,rejected,suspended,all:pending+approved+rejected+suspended};
}

/** Paid orders needing attention plus, for paper reviewers, held or checking requests. Either read may be unavailable. */
export async function papersNeedingAttention(supabase:SupabaseClient) {
  const [attention,review]=await Promise.all([supabase.rpc('paid_orders_needing_attention'),supabase.rpc('paper_review_queue')]);
  const paid=(attention.error?null:(attention.data||[])) as Attention[]|null;
  const queue=(review.error?null:(review.data||[])) as ReviewItem[]|null;
  return {paid,queue};
}
export const reasonTone=(reason:string)=>/held/i.test(reason)?'problem' as const:'attention' as const;
