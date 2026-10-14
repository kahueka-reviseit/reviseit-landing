import {requireStudioEditor} from '../../../../../../../../lib/studio/server';
import {call,isUuid} from '../../../../../../../../lib/studio/contracts';
import {studioStorage} from '../../../../../../../../lib/studio/storage';
import {readBlob} from '../../../../../../../../lib/studio/uploads';
import type {MaintenanceCheck} from '../../../../../../../../lib/studio/maintenance-checks';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 const {rpc}=await requireStudioEditor(),{id}=await params,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 try {if(!isUuid(id))throw new Error('Invalid check');const c=await call<MaintenanceCheck>(rpc,'studio_maintenance_check_view',{p_check:id});const storage=studioStorage();if(!storage||!c.reportBlobId)throw new Error('Unavailable');const b=await readBlob(rpc,storage,c.reportBlobId);if(b.info.sha256!==c.reportSha256)throw new Error('Integrity');return new Response(Buffer.from(b.bytes),{headers:{...headers,'Content-Type':'application/json','Content-Disposition':`attachment; filename="bank-check-${id}.json"`}});}catch{return new Response('Report unavailable or failed integrity.',{status:409,headers});}
}
