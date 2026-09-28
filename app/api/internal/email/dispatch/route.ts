import { timingSafeEqual } from 'node:crypto';
import { dispatchOnce, emailConfig } from '../../../../../lib/email/delivery';
import { reply } from '../../../../../lib/jobs/server';
import { serviceClient } from '../../../../../lib/supabase/service';
export const dynamic='force-dynamic';
// Called every minute by the database scheduler (see EMAIL.md) and optionally
// nudged after an event. Every call is idempotent: rows are claimed under a
// lease in the database, so overlapping or repeated calls cannot double-send.
export async function POST(request:Request){
 const secret=process.env.EMAIL_DISPATCH_TOKEN;
 if(!secret||secret.length<32)return reply({error:'Dispatch not configured'},503);
 const got=Buffer.from(request.headers.get('authorization')||''),wanted=Buffer.from('Bearer '+secret);
 if(got.length!==wanted.length||!timingSafeEqual(got,wanted))return reply({error:'Dispatch authentication required'},401);
 const config=emailConfig(),service=serviceClient();
 if(!config||!service)return reply({error:'Email delivery not configured'},503);
 try{return reply({report:await dispatchOnce(service,config)});}
 catch{return reply({error:'Dispatch temporarily unavailable'},503);}
}
