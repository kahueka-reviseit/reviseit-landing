import { accountContext } from '../../../../../lib/auth/access';
import { studioStorage } from '../../../../../lib/studio/storage';
import { LocalStudioStorage } from '../../../../../lib/studio/storage/local';
export const dynamic='force-dynamic';
// Local rehearsal only: receives a browser PUT for a locally signed provisional key. Refused unless
// local storage is configured (never in production) and the caller is a Studio editor.
export async function PUT(request:Request){
 const storage=studioStorage();if(!(storage instanceof LocalStudioStorage))return new Response('Not found',{status:404});
 const c=await accountContext();if(c.kind!=='authenticated')return new Response('Sign in required',{status:401});
 const editor=await c.supabase.rpc('studio_is_editor');if(editor.error||editor.data!==true)return new Response('Access denied',{status:403});
 const url=new URL(request.url).searchParams.get('url')||'';
 const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length>52428800)return new Response('Too large',{status:413});
 try{await storage.acceptSignedPut(url,bytes);return new Response(null,{status:204});}catch{return new Response('Upload refused',{status:403});}
}
