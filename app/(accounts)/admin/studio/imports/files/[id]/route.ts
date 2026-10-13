import {accountContext} from '../../../../../../../lib/auth/access';
import {isUuid} from '../../../../../../../lib/studio/contracts';
import {studioStorage} from '../../../../../../../lib/studio/storage';
import {readImportedFile} from '../../../../../../../lib/studio/imported-analysis';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))return new Response('Not found',{status:404,headers});
 const c=await accountContext();if(c.kind!=='authenticated')return new Response('Sign in required',{status:401,headers});
 const editor=await c.supabase.rpc('studio_is_editor');if(editor.error||editor.data!==true)return new Response('Access denied',{status:403,headers});
 const storage=studioStorage();if(!storage)return new Response('Studio storage is not configured',{status:503,headers});
 try{const {info,bytes}=await readImportedFile((n,a)=>c.supabase.rpc(n,a),storage,id);
 const filename=String(info.filename).split('/').at(-1)||'imported-file';
 return new Response(Buffer.from(bytes),{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${filename.replace(/[^A-Za-z0-9_.-]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'X-Studio-Sha256':info.sha256}});
 }catch{return new Response('This file is unavailable or failed its integrity check.',{status:409,headers});}
}
