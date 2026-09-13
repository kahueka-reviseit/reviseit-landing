import { NextRequest, NextResponse } from 'next/server';
import { accountContext } from '../../../../lib/auth/access';
import { canEnterWorkspace } from '../../../../lib/auth/policy';
import { readRenderFormatting } from '../../../../lib/workspace/render-formatting';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers});
export async function GET(request:NextRequest) {
  const c=await accountContext();
  if(c.kind!=='authenticated') return reply({error:c.kind==='anonymous'?'Sign in required':'Formatting unavailable'},c.kind==='anonymous'?401:503);
  if(!canEnterWorkspace(c.account,c.user.email || '',!!c.user.email_confirmed_at)) return reply({error:'School verification required'},403);
  const moduleId=request.nextUrl.searchParams.get('curriculum') || '',raw=request.nextUrl.searchParams.get('revision');
  if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(moduleId) || moduleId.length>120 || raw===null || !/^(0|[1-9][0-9]*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) return reply({error:'Choose a curriculum and its saved formatting revision'},400);
  try { return reply(await readRenderFormatting(c.supabase,c.account.school_id!,moduleId,Number(raw))); }
  catch(e) {
    const m=e instanceof Error?e.message:'';
    if(m==='Formatting changed') return reply({error:'Formatting changed. Reload the workspace before continuing.'},409);
    if(m==='Curriculum access required') return reply({error:m},403);
    if(m==='Unsupported formatting') return reply({error:'These saved formatting settings are unsupported. Review and save them again.'},422);
    return reply({error:'Formatting unavailable'},503);
  }
}
