import { NextResponse } from 'next/server';
import { access,reply } from '../../../../lib/jobs/server';
export const dynamic='force-dynamic';
export async function GET(){const c=await access();if(c instanceof NextResponse)return c;const r=await c.supabase.rpc('teacher_orders');return r.error?reply({error:'Requests unavailable'},503):reply(r.data);}
