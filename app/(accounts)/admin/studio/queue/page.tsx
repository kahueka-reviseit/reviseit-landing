import {requireStudioEditor} from '../../../../../lib/studio/server';
import {call,GATES} from '../../../../../lib/studio/contracts';
import {StaffHeader} from '../../../staff-header';
import {StudioShell} from '../components';
import {QueueView} from '../queue-view';
export const dynamic='force-dynamic';
export default async function Queue({searchParams}:{searchParams:Promise<{module?:string}>}) {
  const {rpc,account}=await requireStudioEditor(),query=await searchParams;
  const data=await call<any>(rpc,'studio_overview',{}),modules=data.modules.map((m:any)=>m.moduleId);
  const moduleId=modules.includes(query.module)?query.module:undefined;
  const runs=await Promise.all(data.runs.filter((r:any)=>!moduleId||r.moduleId===moduleId).map(async(r:any)=>({ ...r,title:data.sources.find((s:any)=>s.id===r.sourceId)?.title||`Analysis ${r.id.slice(0,8)}`, views:await Promise.all(GATES.map(g=>call(rpc,'studio_gate_view',{p_run:r.id,p_gate:g}).catch(()=>null))) })));
  return <><StaffHeader current="studio" studioEnabled signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="queue" modules={modules} moduleId={moduleId}><QueueView runs={runs}/></StudioShell></>;
}
