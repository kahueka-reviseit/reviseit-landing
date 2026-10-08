import { serviceClient } from '../../../../lib/supabase/service';
import { handleStudioGateway } from '../../../../lib/studio/gateway';
import { studioStorage } from '../../../../lib/studio/storage';
export const dynamic='force-dynamic';
// Studio worker gateway: its own token and Studio-only functions. Never accepts CONTENT_WORKER_TOKEN.
export async function POST(request:Request){
 const client=serviceClient();
 return handleStudioGateway(request,{token:process.env.STUDIO_WORKER_TOKEN,otherTokens:[process.env.CONTENT_WORKER_TOKEN],
  rpc:client?((name,args)=>client.rpc(name,args)):null,storage:studioStorage()});
}
