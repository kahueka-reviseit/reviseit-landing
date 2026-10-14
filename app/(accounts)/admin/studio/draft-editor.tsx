'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {impactUrl} from '../../../../lib/studio/dependencies';
import {StudioHeading} from './components';
import {saveDraftAction,saveFormDraftAction,discardDraftAction} from './draft-actions';
import {parseAuthoredForm,formEditProblem,type FormSource} from '../../../../lib/studio/form-authoring';
import {FormFields,FormPreview,FormEvidence} from './form-fields';
import {changedSpan,draftTextProblem,draftUrl,type MaintenanceDraft,type SaveDraftInput} from '../../../../lib/studio/maintenance-drafts';
import {fileUrl,type FileDetail} from '../../../../lib/studio/library';
import s from './studio.module.css';

export function DraftEditor({file,draft,baseText,currentText,selectedText,selectedRevision,viewerId,asOf,sources=[]}:{file:FileDetail;draft:MaintenanceDraft|null;baseText:string;currentText:string;selectedText:string;selectedRevision:number;viewerId:string;asOf?:string;sources?:FormSource[]}) {
 const router=useRouter();
 const authored=useMemo(()=>parseAuthoredForm(file,currentText),[file,currentText]);
 const [text,setText]=useState(currentText),[reason,setReason]=useState(''),[discardReason,setDiscardReason]=useState('');
 const [tab,setTab]=useState<'edit'|'difference'|'history'|'preview'|'evidence'>('edit'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [restore,setRestore]=useState<number|null>(null);
 const submission=useRef<{key:string;command:string}|null>(null);
 const revision=draft?.revision||0,current=draft?.revisions.find(r=>r.revision===revision),expectedSha256=current?.sha256||file.sha256;
 const editable=!draft||draft.state==='draft',dirty=text!==currentText;
 const proposedFields=authored?JSON.parse(text).fields:[];
 const problem=(authored?formEditProblem(authored,proposedFields):null)||draftTextProblem(file.path,text),diff=changedSpan(baseText,text);
 useEffect(()=>{
  if(!dirty)return;
  const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();};
  const navigation=(e:MouseEvent)=>{const a=(e.target as Element).closest?.('a[href]');if(a instanceof HTMLAnchorElement&&a.target!=='_blank'&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&a.href!==location.href&&!window.confirm('Leave this editor and discard your unsaved text?')){e.preventDefault();e.stopPropagation();}};
  window.addEventListener('beforeunload',guard);document.addEventListener('click',navigation,true);
  return()=>{window.removeEventListener('beforeunload',guard);document.removeEventListener('click',navigation,true);};
 },[dirty]);
 // Keep the key for an uncertain network response. Changed input is a different command.
 const command=(value:unknown)=>{const key=JSON.stringify(value);if(submission.current?.key!==key)submission.current={key,command:crypto.randomUUID()};return submission.current!.command;};
 async function save() {
  setBusy(true);setError('');
  const payload:Omit<SaveDraftInput,'command'>={draftId:draft?.id||null,snapshotId:file.snapshotId,path:file.path,expectedRevision:revision,expectedSha256,text,reason,restoredFrom:restore};
  try {const result=authored&&restore===null?await saveFormDraftAction({draftId:payload.draftId,snapshotId:file.snapshotId,path:file.path,expectedRevision:revision,expectedSha256,fields:proposedFields,reason,asOf:asOf||new Date().toISOString().slice(0,10),command:command({...payload,asOf})}):await saveDraftAction({...payload,command:command(payload)});if(!result.ok)setError(result.error);else {router.push(draftUrl(result.draftId));router.refresh();}}
  catch{setError('The connection interrupted the save. Your text is retained. Retry the same save to check its result.');}
  finally{setBusy(false);}
 }
 async function discard() {
  if(!draft)return;setBusy(true);setError('');
  const payload={draftId:draft.id,expectedRevision:revision,expectedSha256,reason:discardReason};
  try{const result=await discardDraftAction({...payload,command:command({discard:payload})});if(!result.ok)setError(result.error);else router.refresh();}
  catch{setError('The connection interrupted the discard. Retry explicitly to check its result.');}finally{setBusy(false);}
 }
 const date=(v:string)=>v.slice(0,16).replace('T',' ')+' UTC';
 return <><StudioHeading title={editable?authored?'Edit teacher form':'Edit bank file':'Draft history'} breadcrumb={<><Link href={fileUrl(file.snapshotId,file.path)}>Library / Source file</Link> / {file.path}</>}>
  {draft?`Private revision ${revision}`:'New private draft'} · {file.purpose==='rehearsal'?'Rehearsal copy':file.accepted?'Based on the accepted bank':'Based on a historical bank copy'}
 </StudioHeading>
 <section className={s['studio-panel--caution']}><p>Saving retains a private revision. Bank integration and teacher publication require their own checks and approval.</p>{file.purpose==='rehearsal'&&<p>This rehearsal draft cannot become an accepted bank change.</p>}{draft?.state==='discarded'&&<p><strong>Discarded:</strong> {draft.discardedReason}. Every saved revision remains inspectable.</p>}</section>
 <div className={s['studio-toolbar']}><div role="group" aria-label="Draft views" className={s['studio-toolbar__group']}>
  <button className={s['studio-button']} aria-pressed={tab==='edit'} onClick={()=>setTab('edit')}>{authored?'Fields & settings':'Source'}</button>{authored&&<><button className={s['studio-button']} aria-pressed={tab==='preview'} onClick={()=>setTab('preview')}>Teacher preview</button><button className={s['studio-button']} aria-pressed={tab==='evidence'} onClick={()=>setTab('evidence')}>Source evidence</button></>}<button className={s['studio-button']} aria-pressed={tab==='difference'} onClick={()=>setTab('difference')}>Difference</button><button className={s['studio-button']} aria-pressed={tab==='history'} onClick={()=>setTab('history')}>History</button>
 </div><span className={s.note}>{dirty?'Unsaved changes':draft?'Saved revision':'Starting file'}{restore!==null?` · restoring revision ${restore}`:''}</span></div>
 {error&&<div role="alert" className={s['studio-panel--caution']}><p>{error}</p><p>Your text has not been replaced.</p>{draft&&<a href={draftUrl(draft.id)} target="_blank" rel="noopener noreferrer">Compare the current saved revision in another tab →</a>}</div>}
 <div className={s['studio-columns']}><section className={s['studio-panel']}>
 {tab==='edit'&&authored?<FormFields form={authored} fields={proposedFields} disabled={!editable||busy} onChange={fields=>{setText(JSON.stringify(fields)===JSON.stringify(authored.fields)?currentText:JSON.stringify({...authored,fields},null,2)+'\n');setRestore(null);}}/>:
 tab==='preview'&&authored?<FormPreview key={JSON.stringify(proposedFields)} fields={proposedFields}/>:
 tab==='evidence'&&authored?<FormEvidence form={authored} sources={sources}/>:
 tab==='edit'?<><h2>Source text</h2><label className={s['studio-draft-label']}>Markdown or JSON source<textarea aria-label="Source text" className={s['studio-draft-text']} value={text} readOnly={!editable} disabled={busy} spellCheck={false} onChange={e=>{setText(e.target.value);setRestore(null);}}/></label><p className={s.note}>Text is shown exactly as stored. Source content is never executed here.</p></>:
 tab==='difference'?<><h2>Difference from the starting file</h2>{!diff.changed?<p>No text changes.</p>:<><p className={s.note}>Changed span from line {diff.startLine}. Unchanged lines between edits are retained for context.</p><h3>Before</h3><pre className={s['studio-diff-before']}>{diff.before||'(No text)'}</pre><h3>Draft</h3><pre className={s['studio-diff-after']}>{diff.after||'(No text)'}</pre></>}</>:
 <><h2>Revision history</h2><p className={s.note}>Restoring copies retained text into a new draft revision. It never changes an earlier revision.</p><div className={s['studio-list']}>
 {draft?.revisions.map(r=><article key={r.revision} className={s['studio-revision']}><h3>Revision {r.revision}{r.revision===revision?' · current':''}</h3><p>{r.reason}</p><p className={s.note}>{r.createdBy===viewerId?'You':'Studio editor'} · {date(r.createdAt)}{r.restoredFrom!==null?` · restored from ${r.restoredFrom===0?'starting file':`revision ${r.restoredFrom}`}`:''}</p><Link href={`${draftUrl(draft.id)}?revision=${r.revision}`} target="_blank">Inspect revision {r.revision} ↗</Link></article>)}
 <article className={s['studio-revision']}><h3>Starting file · revision 0</h3><code>{file.sha256}</code>{draft&&<Link href={`${draftUrl(draft.id)}?revision=0`} target="_blank">Inspect starting file ↗</Link>}</article>
 </div>{!draft&&<p>No revisions saved yet.</p>}</>}
 </section><aside className={s['studio-list']}><section className={s['studio-panel']}><h2>Save a private revision</h2><div className={s['studio-draft-form']}><label>Reason for change<textarea value={reason} disabled={!editable||busy} minLength={10} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="What changed, and why?"/></label><button className={s['studio-button--primary']} disabled={!editable||busy||!dirty||!!problem||reason.trim().length<10} onClick={save}>{busy?'Saving…':'Save draft'}</button></div><p className={s.note} role="status">{problem||(authored?'Field format and stable identifiers checked. Source consistency, cross-field rules and generation still require review.':'Text format checked. Content, dependencies, teacher-form compatibility and generation have not been validated.')}</p>{authored&&<p className={s.note}>Saving updates the form fingerprint and records your reason on each changed field. Source quotations and unresolved findings are retained.</p>}</section>
 <section className={s['studio-panel']}><h2>Bank checks & review</h2><Link href={`/admin/studio/library/checks/new?snapshot=${file.snapshotId}`} target="_blank" rel="noopener noreferrer">Select saved drafts for checking ↗</Link><p className={s.note}>Only saved revisions are included. Human content review follows the worker’s structural report.</p></section>
 <section className={s['studio-panel']}><h2>Dependency impact</h2>{draft?.state!=='discarded'&&<Link href={impactUrl(file,draft?.id,revision,expectedSha256)} target="_blank" rel="noopener noreferrer">Inspect recorded dependencies ↗</Link>}<p className={s.note}>{dirty?'Unsaved edits are not included. Save a revision before opening its report.':'Checks retained bank links and exact source reuse. This is not approval of the proposed change.'}</p></section>
 <section className={s['studio-panel']}><h2>Starting point</h2><dl className={s['studio-facts']}><dt>Bank manifest</dt><dd><code>{file.manifestSha256}</code></dd><dt>Current revision fingerprint</dt><dd><code>{expectedSha256}</code></dd></dl><p className={s.note}>{authored?'Changes to answer settings or option wording require compatibility and generation review before a release.':'Variants share their parent task-type file. Editing this source may affect several catalogue items. Impact review is still required.'}</p></section>
 {draft&&editable&&<details className={s['studio-panel']}><summary>Discard this draft</summary><p>Retains the revision history and removes this draft from active editing.</p><label className={s['studio-draft-label']}>Reason for discarding<textarea value={discardReason} maxLength={2000} onChange={e=>setDiscardReason(e.target.value)}/></label><button className={s['studio-button']} disabled={busy||dirty||discardReason.trim().length<10} onClick={discard}>Discard saved draft</button>{dirty&&<p>Save or undo your unsaved text before discarding.</p>}</details>}
 </aside></div>
 {draft&&selectedRevision!==revision&&<section className={s['studio-panel']}><h2>Inspecting {selectedRevision===0?'the starting file':`revision ${selectedRevision}`}</h2><pre className={s['studio-source-code']}>{selectedText}</pre>{editable&&<button className={s['studio-button']} disabled={busy||dirty||selectedText===currentText||!!(authored&&!parseAuthoredForm(file,selectedText))} onClick={()=>{setText(selectedText);setRestore(selectedRevision);setTab('difference');setReason('');}}>Restore this text as a new revision</button>}{dirty&&<p>Review your unsaved changes before selecting a different revision to restore.</p>}</section>}
 </>;
}
