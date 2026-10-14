import Link from 'next/link';
import {Stats} from './components';
import {money} from '../../../../lib/studio/presentation';
import s from './studio.module.css';
export function ExecutionSummary({runId,view,execution}:{runId:string;view:any;execution:any}) {
  const attempts=view.providerOperations.flatMap((o:any)=>o.attempts||[]);
  const sent=attempts.filter((p:any)=>!['prepared','failed_before_dispatch'].includes(p.dispatch_state));
  const uncertain=attempts.filter((p:any)=>p.dispatch_state==='uncertain');
  const running=view.stages.some((st:any)=>execution.currentStages.includes(st.id)&&st.state==='running');
  const b=execution.budget, recorded=b?.mode==='recorded';
  return <><Stats items={[{value:sent.length,label:recorded?'Recorded exchanges':'Dispatched model calls'},{value:b?money(b.settledMicro):'Not bound',label:recorded?'Settled simulated cost':'Settled cost for this run'},{value:view.artifacts.filter((a:any)=>a.integrity==='verified').length,label:'Verified retained artifacts'},{value:b?money(b.heldMicro):'—',label:'Outstanding cost reservation'}]}/>
    <section className={s['studio-panel']}><h2>{running?'Analysis is running':'Retained execution record'}</h2><p>{running?'The worker records each turn and its evidence before completing the stage.':'No stage is currently running. The record below retains earlier attempts and their evidence.'}</p><div className={s['studio-toolbar__group']}><Link href={`/admin/studio/runs/${runId}`}>Review progress →</Link><a href="#evidence">View retained files →</a><a href="#provider-attempts">View provider attempts →</a></div></section>
    {(uncertain.length>0||b?.heldMicro>0)&&<section className={s['studio-panel--caution']}><h2>Reconcile outstanding execution before retrying</h2><p>{uncertain.length>0?`${uncertain.length} provider outcome(s) are uncertain. `:''}An operator must check the provider outcome and settle or reconcile held cost. An uncertain request is never silently sent again.</p><p>Any permitted retry is explicit and separately numbered. A retry does not erase earlier costs or evidence.</p></section>}
    <p className={s.note}>All counts refer to this run. A bounded correction permits at most three submissions with two retained rejections. Each new model turn is a separately admitted call.</p>
  </>;
}
