import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfiguredCheckoutRequest } from '../payments/contracts';
import { evaluate, readDefinitions } from './engine';
import type { Configuration } from './contracts';

/**
 * Before payment: compile the definitions a checkout would pin and check the
 * teacher's marks with the same engine used after payment. Only marks and
 * targets exist at this point; no private question is shown or answered.
 */
export async function configuredCheckout(service:SupabaseClient, teacherId:string, request:ConfiguredCheckoutRequest):Promise<{definitionsSha256:string}|{error:string; problems?:string[]}> {
  const r=await service.rpc('configured_checkout_candidate',{target_teacher:teacherId,target_module:request.moduleId,selection_revision:request.selectionRevision,allocations:request.allocations,targets:request.targets});
  if(r.error) return {error:r.error.message};
  const candidate=r.data as {definitionsSha256:string; form:unknown; snapshot:{lines:{id:string; entryId:string}[]}};
  try {
    const defs=readDefinitions(candidate.snapshot,candidate.form,candidate.definitionsSha256);
    const cfg:Configuration={schemaVersion:1,targets:request.targets,answers:{items:{},paper:{}},
      lines:Object.fromEntries(candidate.snapshot.lines.map(l=>[l.id,{marks:request.allocations[l.entryId]??null,parts:null,facets:{}}]))};
    const e=evaluate(defs,cfg,{paid:false});
    const lineIssues=e.lines.flatMap(l=>l.issues);
    if(e.status!=='ready_for_payment'||lineIssues.length) return {error:'Check the marks for each question.',problems:[...e.totals.problems,...e.lines.flatMap(l=>l.marksProblem?[l.marksProblem]:[]),...lineIssues]};
    return {definitionsSha256:candidate.definitionsSha256};
  } catch { return {error:'Checkout could not be started.'}; }
}
