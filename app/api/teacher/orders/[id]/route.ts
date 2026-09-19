import { NextResponse } from 'next/server';
import { access,reply } from '../../../../../lib/jobs/server';
import { isUuid } from '../../../../../lib/jobs/contracts';
export const dynamic='force-dynamic';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const c=await access();if(c instanceof NextResponse)return c;const {id}=await params;if(!isUuid(id))return reply({error:'Request not found'},404);const r=await c.supabase.rpc('teacher_orders',{target:id});if(r.error)return reply({error:'Request unavailable'},503);return r.data?.[0]?reply(r.data[0]):reply({error:'Request not found'},404);}
