import {NextResponse} from 'next/server';
import {access,body,originError,reply} from '../../../../lib/jobs/server';
import {isUuid} from '../../../../lib/jobs/contracts';
import {creditsEnabled} from '../../../../lib/credits/server';
export async function POST(request:Request){
 const origin=originError(request);if(origin)return origin;
 if(!creditsEnabled())return reply({error:'Department credit is not open yet.'},503);
 const c=await access();if(c instanceof NextResponse)return c;
 let v;try{v=await body(request,1000);}catch{return reply({error:'Invalid request'},400);}
 const x=v as Record<string,unknown>;
 if(!x||!isUuid(x.quoteId)||!isUuid(x.requestKey))return reply({error:'Invalid request'},400);
 const r=await c.supabase.rpc('create_department_paper',{quote_id:x.quoteId,request_key:x.requestKey});
 if(r.error){const m=r.error.message;
 if(/Quote changed/.test(m))return reply({error:'The quote expired or changed. Review the current price before accepting it.',code:'quote_changed'},409);
 if(/Insufficient/.test(m))return reply({error:'Your department balance changed and no longer covers this paper. Nothing was charged.',code:'balance_changed'},409);
 if(/capacity|purchasing|unavailable/.test(m))return reply({error:'Paper creation is not available at the moment. Your selection is saved.'},503);
 if(/spending access/.test(m))return reply({error:'Your department spending access has changed.'},403);
 return reply({error:'Creation could not be confirmed. Retry this request to check its outcome.'},503);
 }
 return reply({orderId:r.data});
}
