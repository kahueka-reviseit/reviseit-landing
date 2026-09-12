import { NextRequest, NextResponse } from 'next/server';
import { catalogueAccess,catalogueReply,catalogueHeaders } from '../../../../../lib/workspace/access';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  try {
    const context=await catalogueAccess();if(context instanceof NextResponse) return context;
    const q=request.nextUrl.searchParams, moduleId=q.get('curriculum'),release=q.get('release'),entry=q.get('entry');
    if(!moduleId || !release || !entry || moduleId.length>120 || release.length>100 || entry.length>120) return catalogueReply({error:'Invalid diagram request'},400);
    // The user's own client enforces school access, approval and current-release row policies.
    const result=await context.supabase.from('catalogue_summaries').select('thumbnail_png').eq('module_id',moduleId).eq('release',release).eq('entry_id',entry).maybeSingle();
    if(result.error) return catalogueReply({error:'Diagram unavailable'},503);
    const encoded=result.data?.thumbnail_png;
    if(!encoded) return catalogueReply({error:'Diagram not found'},404);
    if(typeof encoded!=='string' || encoded.length>350000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return catalogueReply({error:'Diagram unavailable'},503);
    const png=Buffer.from(encoded,'base64');
    if(!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return catalogueReply({error:'Diagram unavailable'},503);
    return new NextResponse(new Uint8Array(png),{headers:{...catalogueHeaders,'Content-Type':'image/png','Content-Security-Policy':"default-src 'none'; sandbox"}});
  } catch { return catalogueReply({error:'Diagram unavailable'},503); }
}
