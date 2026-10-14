import {timingSafeEqual} from 'node:crypto';
import {body,reply} from '../../../../lib/jobs/server';
import {serviceClient} from '../../../../lib/supabase/service';
import {studioStorage} from '../../../../lib/studio/storage';
import {releaseWorkerOperation} from '../../../../lib/studio/release-worker-gateway';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const secret=process.env.CONTENT_WORKER_TOKEN,got=Buffer.from(request.headers.get('authorization')||'');
 if(!secret||secret.length<32)return reply({error:'Release worker gateway not configured'},503);
 const wanted=Buffer.from('Bearer '+secret);if(got.length!==wanted.length||!timingSafeEqual(got,wanted))return reply({error:'Teacher worker authentication required'},401);
 const client=serviceClient(),storage=studioStorage();if(!client||!storage)return reply({error:'Release storage unavailable'},503);
 try{const v=await body(request,10000);return reply({result:await releaseWorkerOperation(v,(n,a)=>client.rpc(n,a),storage)});}
 catch{return reply({error:'Release worker operation refused'},409);}
}
