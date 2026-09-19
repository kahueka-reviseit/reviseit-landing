import 'server-only';
import { NextResponse } from 'next/server';
import { accountContext } from '../auth/access';
import { canEnterWorkspace } from '../auth/policy';
import { authConfig } from '../supabase/config';
export const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export function reply(value:unknown,status=200){return NextResponse.json(value,{status,headers:privateHeaders});}
export async function access(reviewer=false){
 const c=await accountContext();
 if(c.kind!=='authenticated')return reply({error:c.kind==='anonymous'?'Sign in required':'Account unavailable'},c.kind==='anonymous'?401:503);
 if(reviewer){const r=await c.supabase.rpc('is_paper_reviewer');if(r.error||r.data!==true)return reply({error:'Paper reviewer access required'},403);}
 else if(!canEnterWorkspace(c.account,c.user.email||'',!!c.user.email_confirmed_at))return reply({error:'School verification required'},403);
 return c;
}
export function originError(request:Request){const site=authConfig()?.siteUrl;return !site||request.headers.get('origin')!==site?reply({error:'Request origin rejected'},403):null;}
export async function body(request:Request,max=20000):Promise<unknown>{
 if(Number(request.headers.get('content-length')||0)>max)throw new Error('Too large');
 const reader=request.body?.getReader();if(!reader)throw new Error('Missing body');let size=0;const chunks:Uint8Array[]=[];
 while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max){await reader.cancel();throw new Error('Too large');}chunks.push(r.value);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function rpcError(message:string){
 if(/access required|Independent reviewer/.test(message))return reply({error:'Access denied'},403);
 if(/already submitted|cannot be submitted|Review changed/.test(message))return reply({error:'This request has changed. Refresh to see its current state.'},409);
 if(/Invalid|Review evidence|Four documents/.test(message))return reply({error:'Check the submitted information.'},422);
 return reply({error:'The request could not be completed. Please try again.'},503);
}
