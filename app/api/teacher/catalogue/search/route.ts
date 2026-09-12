import { NextRequest, NextResponse } from 'next/server';
import { catalogueAccess,catalogueReply } from '../../../../../lib/workspace/access';
import { thumbnailFor } from '../../../../../lib/workspace/catalogue';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  try {
    const context=await catalogueAccess();if(context instanceof NextResponse) return context;
    const query=(request.nextUrl.searchParams.get('q') || '').trim();
    if(!query || query.length>120) return catalogueReply({error:'Enter between 1 and 120 characters'},400);
    const result=await context.supabase.rpc('search_teacher_catalogue',{search_text:query});
    if(result.error) return catalogueReply({error:'Search is unavailable. Please try again.'},503);
    const rows=result.data || [];
    // Deliberately project a field allowlist. Never return database rows wholesale.
    return catalogueReply({hasMore:rows.length>50,matches:rows.slice(0,50).map((r:{module_id:string;module_name:string;release:string;is_demo:boolean;entry_id:string;title:string;topic:string;description:string;marks_min:number;marks_max:number;thumbnail_alt:string|null})=>({
      module:{id:r.module_id,name:r.module_name,release:r.release,isDemo:r.is_demo},
      entry:{id:r.entry_id,title:r.title,topic:r.topic,description:r.description,marks:{min:r.marks_min,max:r.marks_max},thumbnail:thumbnailFor(r.module_id,r.release,r.entry_id,r.thumbnail_alt)},
    }))});
  } catch { return catalogueReply({error:'Search is unavailable. Please try again.'},503); }
}
