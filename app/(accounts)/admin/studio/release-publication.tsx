'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {ReleasePublicationData,ReleaseCandidate} from '../../../../lib/studio/release-publication';
import type {ReleasePreparationData} from '../../../../lib/studio/release-preparation';
import {stageRelease,reviewRelease,activateRelease} from './publication-actions';
import {moduleLabel} from '../../../../lib/studio/presentation';
import s from './studio.module.css';
export function ReleasePublication({data,preparations}:{data:ReleasePublicationData;preparations:ReleasePreparationData}){
 const router=useRouter(),commands=useRef<Record<string,string>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [notes,setNotes]=useState<Record<string,string>>({}),[confirmed,setConfirmed]=useState<Record<string,boolean>>({});
 async function run(key:string,action:(command:string)=>Promise<{ok:boolean;error?:string}>,success:string){
  commands.current[key]??=crypto.randomUUID();setBusy(true);
  try{const r=await action(commands.current[key]);setMessage(r.ok?success:r.error||'Action not confirmed.');if(r.ok){delete commands.current[key];router.refresh();}}catch{setMessage('Response interrupted. Refresh or retry this exact action to confirm its result.');}finally{setBusy(false);}
 }
 const note=(c:ReleaseCandidate)=>notes[c.id]||'';
 const canAct=(c:ReleaseCandidate)=>!busy&&confirmed[c.id]&&note(c).trim().length>=10;
 return <section aria-label="Release review and activation"><h2>Review and publish</h2><p>Review the retained files, record your content judgement, then wait for the teacher-generation worker to confirm the exact bundle. Publishing switches the teacher catalogue only after those checks pass.</p>
 {message&&<p role="status">{message}</p>}
 {preparations.preparations.filter(p=>p.state==='checked'&&p.current&&p.report&&p.reportSha256&&!data.candidates.some(c=>c.preparationId===p.id)).map(p=><div className={s['studio-panel']} key={p.id}><h3>{moduleLabel(p.moduleId)} · {p.report!.release}</h3><p>File checks passed. Start a review of report <code>{p.reportSha256!.slice(0,12)}</code>. Starting a review reserves this release identity; it does not approve it.</p><button className={s['studio-button']} disabled={busy} onClick={()=>run(`stage:${p.id}`,command=>stageRelease({preparationId:p.id,reportSha256:p.reportSha256!,moduleId:p.moduleId,command}),'Package ready for human review.')}>Start release review</button></div>)}
 {!data.candidates.length&&<p>No release is under review yet. Packages with missing forms or failed checks cannot enter publication.</p>}
 {data.candidates.map(c=>{
  const current=c.currentRelease===c.release,kind=current?'confirm_current':c.previouslyActivated?'rollback':'publish';
  const eligible=c.intact&&(c.inputsCurrent||c.previouslyActivated),fresh=c.worker?.fresh&&Date.now()-Date.parse(c.worker.checkedAt)<120000;
  return <article key={c.id} className={s['studio-panel']}><h3>{moduleLabel(c.moduleId)} · {c.release}</h3><p><strong>{current?'Current teacher release':c.previouslyActivated?'Retained rollback version':'Proposed teacher release'}</strong> · Report <code>{c.reportSha256.slice(0,12)}</code></p>
   <ol><li>Content review: {c.approvalId?'Approved for this exact package':'Awaiting human approval'}</li><li>Teacher-generation worker: {fresh?`Confirmed by ${c.worker!.name}`:c.worker?'Confirmation expired; waiting for the worker':'Waiting for confirmation'}</li><li>Catalogue: {current?'This version is current':`Still using ${c.currentRelease}`}</li></ol>
   {!eligible&&<p role="alert">This package is superseded or its stored files failed integrity checks. Prepare and review a new package.</p>}
   <p><a href={`#${c.preparationId}`}>Inspect retained package and checks</a></p>
   <label className={s['studio-draft-label']}>Review or activation reason<textarea rows={3} value={note(c)} maxLength={2000} onChange={e=>setNotes({...notes,[c.id]:e.target.value})} /></label>
   <label className={s['studio-check-row']}><input type="checkbox" checked={!!confirmed[c.id]} onChange={e=>setConfirmed({...confirmed,[c.id]:e.target.checked})}/> I have reviewed this exact package and the action below.</label>
   <div className={s['studio-toolbar']}>
    {!c.approvalId&&<button className={s['studio-button--primary']} disabled={!canAct(c)||!eligible} onClick={()=>run(`approve:${c.id}:${note(c)}`,command=>reviewRelease({candidateId:c.id,reportSha256:c.reportSha256,decision:'approved',reason:note(c),command}),'Approval recorded. The teacher worker must confirm the bundle before publication.')}>Approve this package</button>}
    {c.approvalId&&<><button className={s['studio-button']} disabled={!canAct(c)} onClick={()=>run(`revoke:${c.id}:${note(c)}`,command=>reviewRelease({candidateId:c.id,reportSha256:c.reportSha256,decision:'revoked',reason:note(c),command}),'Approval revoked. This prevents another activation; the current teacher catalogue is unchanged.')}>Revoke approval</button>
    <button className={s['studio-button--primary']} disabled={!canAct(c)||!eligible||!fresh||(current&&c.previouslyActivated)} onClick={()=>run(`activate:${c.id}:${c.approvalId}:${c.lastActivationId}:${note(c)}`,command=>activateRelease({candidateId:c.id,approvalId:c.approvalId!,expectedRelease:c.currentRelease,expectedActivation:c.lastActivationId,kind,reason:note(c),command}),kind==='rollback'?'Rollback recorded. Existing purchased papers keep their original definitions.':kind==='confirm_current'?'Current release verified and recorded as a rollback baseline.':'Publication and activation confirmed.')}>{kind==='rollback'?'Roll back to this release':kind==='confirm_current'?'Record current release as baseline':'Publish and activate'}</button></>}
   </div><p className={s.note}>Revoking approval stops future activation. It does not withdraw a currently published catalogue. Rollback switches new selections to a previously verified release; existing orders retain their purchased definitions.</p>
   <details><summary>Review history</summary>{c.reviews.map((r,i)=><p key={i}>{r.at} · {r.decision} · {r.reason}<br/>Reviewer: <code>{r.actor}</code></p>)}</details>
  </article>;
 })}
 <h3>Activation history</h3><p className={s.note}>Only switches verified through Studio appear here. Earlier publication records remain above. Rollback requires a retained, approved version with a fresh worker confirmation.</p>
 {!data.activations.length?<p>No Studio activation recorded.</p>:<div className={s['studio-data-table']}><table><thead><tr><th>When</th><th>Change</th><th>Reason</th><th>Confirmed worker</th></tr></thead><tbody>{data.activations.map(a=><tr key={a.id}><td>{a.at}</td><td>{a.kind==='confirm_current'?'Baseline recorded':a.kind==='rollback'?'Rolled back':'Published'}: {a.from} → {a.to}</td><td>{a.reason}</td><td>{a.worker}</td></tr>)}</tbody></table></div>}
 </section>;
}
