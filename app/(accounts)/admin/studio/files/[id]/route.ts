import { accountContext } from '../../../../../../lib/auth/access';
import { isUuid } from '../../../../../../lib/studio/contracts';
import { studioStorage } from '../../../../../../lib/studio/storage';
import { readArtifact } from '../../../../../../lib/studio/uploads';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
// Controlled read of one exact revision. The editor's own session decides access and the bytes are
// digest-checked on every read; uploaded content is served as an attachment, never rendered inline.
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return new Response('Not found',{status:404,headers});
 const c=await accountContext();if(c.kind!=='authenticated')return new Response('Sign in required',{status:401,headers});
 const editor=await c.supabase.rpc('studio_is_editor');if(editor.error||editor.data!==true)return new Response('Access denied',{status:403,headers});
 const storage=studioStorage();if(!storage)return new Response('Studio storage is not configured',{status:503,headers});
 try{const {info,bytes}=await readArtifact((n,a)=>c.supabase.rpc(n,a),storage,id);
  return new Response(Buffer.from(bytes),{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${String(info.logicalKey).replace(/[^A-Za-z0-9_.-]/g,'_')}-r${info.revision}"`,'X-Studio-Sha256':info.sha256}});}
 catch(e){return new Response(e instanceof Error&&/Integrity blocked/.test(e.message)?'These bytes failed their integrity check and are blocked.':'Not available',{status:409,headers});}
}
