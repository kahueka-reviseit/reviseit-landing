import { isUuid } from '../jobs/contracts';
// Browser-safe checkout request. It carries a selection revision and marks per
// saved item, never a price, entitlement, form, source or readiness claim.
export type CheckoutRequest = { requestKey:string; moduleId:string; selectionRevision:number; allocations:Record<string,number> };
export function isCheckoutRequest(value:unknown):value is CheckoutRequest {
  if(!value||typeof value!=='object'||Array.isArray(value)) return false;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='allocations,moduleId,requestKey,selectionRevision') return false;
  if(!isUuid(v.requestKey)||typeof v.moduleId!=='string'||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.moduleId)||v.moduleId.length>120) return false;
  if(!Number.isSafeInteger(v.selectionRevision)||Number(v.selectionRevision)<1) return false;
  const a=v.allocations;
  if(!a||typeof a!=='object'||Array.isArray(a)) return false;
  const entries=Object.entries(a as Record<string,unknown>);
  return entries.length>=1&&entries.length<=30&&entries.every(([k,m])=>k.length>0&&k.length<=120&&!['__proto__','constructor','prototype'].includes(k)&&Number.isSafeInteger(m)&&Number(m)>=1&&Number(m)<=100);
}
// The configurable path adds the teacher's paper target (and optional section
// targets). Marks must add up to it; nothing is auto-assigned.
export type ConfiguredCheckoutRequest = CheckoutRequest & { targets:{paper:number; sections?:{multiple_choice?:number; structured?:number}} };
export function isConfiguredCheckoutRequest(value:unknown):value is ConfiguredCheckoutRequest {
  if(!value||typeof value!=='object'||Array.isArray(value)) return false;
  const {targets,...rest}=value as Record<string,unknown>;
  if(!isCheckoutRequest(rest)||!targets||typeof targets!=='object'||Array.isArray(targets)) return false;
  const t=targets as Record<string,unknown>;
  const whole=(x:unknown,min:number)=>Number.isSafeInteger(x)&&Number(x)>=min&&Number(x)<=3000;
  if(!Object.keys(t).every(k=>k==='paper'||k==='sections')||!whole(t.paper,1)) return false;
  if(t.sections===undefined) return true;
  if(!t.sections||typeof t.sections!=='object'||Array.isArray(t.sections)) return false;
  return Object.entries(t.sections).every(([k,v])=>(k==='multiple_choice'||k==='structured')&&whole(v,0));
}
export function formatRand(amountMinor:number){return `R${(amountMinor/100).toFixed(amountMinor%100?2:0)}`;}
