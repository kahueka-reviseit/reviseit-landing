import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { access,privateHeaders,reply } from '../../../../../../../lib/jobs/server';
import { documents,isUuid,type DocumentName } from '../../../../../../../lib/jobs/contracts';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string;name:string}>}){
 const review=new URL(request.url).searchParams.get('review')==='true';const c=await access(review);if(c instanceof NextResponse)return c;
 const {id,name}=await params;if(!isUuid(id)||!documents.includes(name as DocumentName))return reply({error:'Document not found'},404);
 const r=await c.supabase.rpc('paper_document',{target:id,document_name:name,for_review:review});
 if(r.error||!r.data)return reply({error:'Document unavailable'},404);
 const bytes=Buffer.from(r.data.base64,'base64');if(createHash('sha256').update(bytes).digest('hex')!==r.data.sha256)return reply({error:'Document unavailable'},503);
 return new Response(bytes,{headers:{...privateHeaders,'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="${name}.docx"`,'Content-Length':String(bytes.length)}});
}
