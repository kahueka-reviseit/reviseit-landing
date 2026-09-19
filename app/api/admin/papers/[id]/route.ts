import { NextResponse } from 'next/server';
import { access,body,originError,reply,rpcError } from '../../../../../lib/jobs/server';
import { isUuid } from '../../../../../lib/jobs/contracts';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const o=originError(request);if(o)return o;const c=await access(true);if(c instanceof NextResponse)return c;const {id}=await params;
 let v:any;try{v=await body(request);}catch{return reply({error:'Invalid request'},400);}
 if(!isUuid(id)||!v||!['memo','release'].includes(v.stage)||typeof v.approve!=='boolean'||typeof v.hash!=='string'||!/^[a-f0-9]{64}$/.test(v.hash)||typeof v.note!=='string'||v.note.trim().length<10||v.note.length>2000)return reply({error:'Review evidence required'},422);
 const r=await c.supabase.rpc('review_paper_job',{target:id,stage:v.stage,expected_hash:v.hash,approve:v.approve,note:v.note});return r.error?rpcError(r.error.message):reply({saved:true});
}
