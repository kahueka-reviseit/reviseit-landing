import 'server-only';
import { NextResponse } from 'next/server';
import { accountContext } from '../auth/access';
import { canEnterWorkspace } from '../auth/policy';
export const catalogueHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export function catalogueReply(data:unknown,status=200) { return NextResponse.json(data,{status,headers:catalogueHeaders}); }
export async function catalogueAccess() {
  const context=await accountContext();
  if(context.kind!=='authenticated') return catalogueReply({error:context.kind==='anonymous'?'Sign in required':'Catalogue unavailable'},context.kind==='anonymous'?401:503);
  if(!canEnterWorkspace(context.account,context.user.email || '',!!context.user.email_confirmed_at)) return catalogueReply({error:'School verification required'},403);
  return context;
}
