import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isConfiguration, type Configuration, type ConfigurationView } from './contracts';
import { evaluate, generationPlan, project, readDefinitions, storedEvaluation, type Definitions, type Evaluation } from './engine';

/**
 * Server orchestration for one configured order. The teacher is already
 * authenticated by the route; every database function repeats the identity,
 * school and curriculum checks for that teacher. Private definitions are read
 * with the service client and never returned to the browser.
 */
export type Loaded = {row:Row; defs:Definitions; configuration:Configuration; evaluation:Evaluation; view:ConfigurationView};
type Row = {orderId:string; state:string; paid:boolean; paymentStatus:string; revision:number; configuration:unknown; form:unknown; snapshot:unknown; definitionsSha256:string; submitted:boolean};

export class ConfigurationError extends Error { constructor(message:string, readonly status:number) { super(message); } }

export async function loadConfiguration(service:SupabaseClient, orderId:string, teacherId:string):Promise<Loaded|null> {
  const r=await service.rpc('paper_configuration_for_teacher',{target:orderId,target_teacher:teacherId});
  if(r.error) throw new ConfigurationError('Configuration unavailable',503);
  if(!r.data) return null;
  const row=r.data as Row;
  if(!isConfiguration(row.configuration)) throw new ConfigurationError('Configuration unavailable',503);
  const defs=readDefinitions(row.snapshot,row.form,row.definitionsSha256);
  const paid=row.paid && row.state!=='awaiting_payment';
  const evaluation=evaluate(defs,row.configuration,{paid});
  return {row,defs,configuration:row.configuration,evaluation,
    view:project(defs,row.configuration,evaluation,{orderId:row.orderId,state:row.state,paymentStatus:row.paymentStatus,revision:row.revision,submitted:row.submitted})};
}

function refusal(message:string):ConfigurationError {
  if(/Configuration changed/.test(message)) return new ConfigurationError('This paper changed in another tab or window. Reload to see the latest saved choices; your edits on this page are kept until you reload.',409);
  if(/already submitted/.test(message)) return new ConfigurationError('This paper has already been submitted. Its choices are fixed.',409);
  if(/cannot be configured|cannot be submitted/.test(message)) return new ConfigurationError('This paper can no longer be changed. Refresh to see its current state.',409);
  if(/not ready/.test(message)) return new ConfigurationError('Some details still need attention before you can submit.',422);
  if(/access required/.test(message)) return new ConfigurationError('Request not found',404);
  if(/Invalid/.test(message)) return new ConfigurationError('Check your choices and try again.',422);
  return new ConfigurationError('We could not save this. Your choices are still on this page; try again.',503);
}

/** Validate against the pinned definitions, then save atomically with the expected revision. */
export async function saveConfiguration(service:SupabaseClient, loaded:Loaded, teacherId:string, expected:number, next:Configuration):Promise<Loaded> {
  const paid=loaded.row.paid && loaded.row.state!=='awaiting_payment';
  let evaluation:Evaluation;
  try { evaluation=evaluate(loaded.defs,next,{paid}); } catch { throw new ConfigurationError('Check your choices and try again.',422); }
  const r=await service.rpc('save_paper_configuration',{target:loaded.row.orderId,target_teacher:teacherId,expected_revision:expected,configuration:next,evaluation:storedEvaluation(evaluation)});
  if(r.error) throw refusal(r.error.message);
  const after=await loadConfiguration(service,loaded.row.orderId,teacherId);
  if(!after) throw new ConfigurationError('Request not found',404);
  return after;
}

/** Re-evaluate the current revision and freeze exactly it for generation. A retry
 * with the same key after acceptance rebuilds the same answers and returns the same order. */
export async function submitConfiguration(service:SupabaseClient, loaded:Loaded, teacherId:string, requestKey:string, expected:number):Promise<string> {
  if(expected!==loaded.row.revision) throw refusal('Configuration changed');
  if(!loaded.evaluation.ready) throw refusal(loaded.row.submitted?'Order already submitted':'Configuration is not ready');
  const {plan,answers}=generationPlan(loaded.defs,loaded.configuration,loaded.evaluation,loaded.row.orderId,loaded.row.revision);
  const r=await service.rpc(plan.schema==='reviseit/configured-generation-plan@4'?'submit_configured_paper_v4':'submit_configured_paper_v3',{target:loaded.row.orderId,target_teacher:teacherId,request_key:requestKey,expected_revision:expected,submitted_answers:answers,plan,current_evaluation:storedEvaluation(loaded.evaluation)});
  if(r.error) throw refusal(r.error.message);
  return r.data as string;
}
