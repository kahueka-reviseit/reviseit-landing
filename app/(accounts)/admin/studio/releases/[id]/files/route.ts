import {accountContext} from '../../../../../../../lib/auth/access';
import {call,isUuid} from '../../../../../../../lib/studio/contracts';
import {studioStorage} from '../../../../../../../lib/studio/storage';
import {readBlob} from '../../../../../../../lib/studio/uploads';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params,path=new URL(request.url).searchParams.get('path');if(!isUuid(id)||!path)return new Response('Not found',{status:404,headers});
 const c=await accountContext();if(c.kind!=='authenticated')return new Response('Sign in required',{status:401,headers});
 const editor=await c.supabase.rpc('studio_is_editor');if(editor.error||editor.data!==true)return new Response('Access denied',{status:403,headers});
 const storage=studioStorage();if(!storage)return new Response('Studio storage is unavailable',{status:503,headers});
 try {
  const rpc=(n:string,a:Record<string,unknown>)=>c.supabase.rpc(n,a);
  const file=await call<{blobId:string;path:string}>(rpc,'studio_release_preparation_file',{p_preparation:id,p_path:path});
  const {info,bytes}=await readBlob(rpc,storage,file.blobId);
  return new Response(Buffer.from(bytes),{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${file.path.split('/').at(-1)!.replace(/[^A-Za-z0-9_.-]/g,'_')}"`,'X-Studio-Sha256':info.sha256}});
 }catch{return new Response('This retained file is unavailable or failed its integrity check.',{status:409,headers});}
}
