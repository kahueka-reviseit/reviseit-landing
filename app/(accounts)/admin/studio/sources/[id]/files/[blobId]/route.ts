import {accountContext} from '../../../../../../../../lib/auth/access';
import {call,isUuid} from '../../../../../../../../lib/studio/contracts';
import {studioStorage} from '../../../../../../../../lib/studio/storage';
import {readBlob} from '../../../../../../../../lib/studio/uploads';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(_request:Request,{params}:{params:Promise<{id:string;blobId:string}>}) {
  const {id,blobId}=await params;if(!isUuid(id)||!isUuid(blobId))return new Response('Not found',{status:404,headers});
  const c=await accountContext();if(c.kind!=='authenticated')return new Response('Sign in required',{status:401,headers});
  const editor=await c.supabase.rpc('studio_is_editor');if(editor.error||editor.data!==true)return new Response('Access denied',{status:403,headers});
  const storage=studioStorage();if(!storage)return new Response('Studio storage is not configured',{status:503,headers});
  try {
    const rpc=(n:string,a:Record<string,unknown>)=>c.supabase.rpc(n,a);
    const source=await call<any>(rpc,'studio_source_view',{p_source:id});
    const file=source.revisions.flatMap((r:any)=>r.files).find((f:any)=>f.blobId===blobId);
    if(!file)return new Response('Not found',{status:404,headers});
    const {info,bytes}=await readBlob(rpc,storage,blobId);
    return new Response(Buffer.from(bytes),{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${file.filename.replace(/[^A-Za-z0-9_.-]/g,'_')}"`,'X-Studio-Sha256':info.sha256}});
  } catch {return new Response('This file is unavailable or failed its integrity check.',{status:409,headers});}
}
