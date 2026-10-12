import { StudioDb, sha, ok, key } from './studio-fixture';
export const CONTRACT='recorded-budget-test-v1';
export const contract = (bundle=sha('synthetic-execution')) => ({id:CONTRACT,profile_id:'mock-v0',bundle_sha256:bundle,
 capability_sha256:sha('synthetic-capability'),pricing_sha256:sha('synthetic-pricing'),model:'recorded-only',endpoint:'recorded/local',mode:'recorded',
 input_micro_per_million:1000000,output_micro_per_million:1000000,max_input_tokens:10000000,max_output_tokens:32768,max_request_bytes:1500000,image_token_ceiling:1000,max_images:100});
export async function installBudgetContract(db:StudioDb,bundle?:string){
 const c=contract(bundle);const keys=Object.keys(c);
 await db.sql(`insert into private.studio_budget_contracts(${keys.join(',')},evidence) values(${keys.map((_,i)=>'$'+(i+1)).join(',')},'{"synthetic":true}')`,Object.values(c));
}
export const grantArgs=(run:string,limit=1000000000,trial:string=key())=>({p_run:run,p_trial:trial,p_trial_limit:limit,p_run_limit:limit,p_stage_limit:limit,p_operation_limit:limit,p_contract:CONTRACT,p_authorisation:{reference:'Synthetic offline allowance'}});
export const grantBudget=(db:StudioDb,run:string,limit?:number,trial?:string)=>ok(db.rpc({kind:'operator'}),'studio_budget_grant',grantArgs(run,limit,trial));
export const manifest=(digest:string,extra:Record<string,unknown>={})=>({requestDigest:digest,contractId:CONTRACT,bundleDigest:contract().bundle_sha256,
 capabilityDigest:contract().capability_sha256,pricingDigest:contract().pricing_sha256,model:'recorded-only',endpoint:'recorded/local',requestBytes:100,imageCount:0,inputTokenBound:100,outputTokens:100,...extra});
