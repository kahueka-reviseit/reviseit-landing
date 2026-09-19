import { NextResponse } from 'next/server';
import { access,body,originError,reply,rpcError } from '../../../../../../lib/jobs/server';
import { isSubmission,isUuid } from '../../../../../../lib/jobs/contracts';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const origin=originError(request);if(origin)return origin;const c=await access();if(c instanceof NextResponse)return c;
 const {id}=await params;if(!isUuid(id))return reply({error:'Request not found'},404);
 let value;try{value=await body(request);}catch{return reply({error:'Invalid request'},400);}if(!isSubmission(value))return reply({error:'Check your answers'},422);
 const r=await c.supabase.rpc('submit_paper_answers',{target:id,request_key:value.requestKey,submitted_answers:value.answers});
 return r.error?rpcError(r.error.message):reply({id:r.data},202);
}
