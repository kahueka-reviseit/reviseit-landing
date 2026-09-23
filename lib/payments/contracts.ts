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
export function formatRand(amountMinor:number){return `R${(amountMinor/100).toFixed(amountMinor%100?2:0)}`;}
