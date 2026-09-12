import { NextRequest, NextResponse } from 'next/server';
import { accountContext } from '../../../../lib/auth/access';
import { canEnterWorkspace } from '../../../../lib/auth/policy';
import { isWorkspaceWrite } from '../../../../lib/workspace/contracts';
import { readWorkspace } from '../../../../lib/workspace/server';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function reply(data:unknown,status=200) { return NextResponse.json(data,{status,headers}); }
async function access() {
  const c=await accountContext();
  if(c.kind!=='authenticated') return reply({error:c.kind==='anonymous'?'Sign in required':'Workspace unavailable'},c.kind==='anonymous'?401:503);
  if(!canEnterWorkspace(c.account,c.user.email || '',!!c.user.email_confirmed_at)) return reply({error:'School verification required'},403);
  return c;
}
export async function GET(request:NextRequest) {
  const c=await access(); if(c instanceof NextResponse) return c;
  try { return reply(await readWorkspace(c.supabase,c.account.school_id!,request.nextUrl.searchParams.get('curriculum') || undefined)); }
  catch(e) { return reply({error:e instanceof Error ? e.message : 'Workspace unavailable'},e instanceof Error && e.message==='Curriculum access required'?403:503); }
}
export async function PUT(request:NextRequest) {
  // Cookie-authenticated mutations require a same-origin browser request.
  if(request.headers.get('origin')!==request.nextUrl.origin) return reply({error:'Request origin rejected'},403);
  const c=await access(); if(c instanceof NextResponse) return c;
  const raw=await request.text(); if(raw.length>8192) return reply({error:'Request too large'},413);
  let body:unknown; try { body=JSON.parse(raw); } catch { return reply({error:'Invalid request'},400); }
  if(!isWorkspaceWrite(body)) return reply({error:'Check your formatting or question selection'},400);
  const result=body.kind==='formatting' ? await c.supabase.rpc('save_school_formatting',{target_module:body.moduleId,expected_revision:body.revision,settings:body.preferences}) :
    await c.supabase.rpc('save_paper_selection',{target_module:body.moduleId,target_release:body.release,expected_revision:body.revision,selected_ids:body.entryIds});
  if(result.error) {
    const message=result.error.message;
    if(/changed|Refresh/.test(message)) return reply({error:'This has changed since you opened it. Reload the workspace before saving.'},409);
    if(/access required/.test(message)) return reply({error:'Your curriculum access has changed. Return to your account.'},403);
    if(/Invalid/.test(message)) return reply({error:'Check your formatting or question selection'},400);
    return reply({error:'We could not save this. Your changes are still on this page; try again.'},503);
  }
  return reply({revision:result.data});
}
