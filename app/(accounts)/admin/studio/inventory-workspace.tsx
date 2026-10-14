'use client';
import Link from 'next/link';
import { useState } from 'react';
import { StudioHeading, Stats } from './components';
import { MarkCorrectionForm, CognitiveCorrectionForm, InventoryDecisionForm } from './inventory-forms';
import { COGNITIVE_CATEGORIES } from '../../../../lib/studio/cognitive-classification';
import s from './studio.module.css';
export type InventoryWorkspaceProps = {
  runId:string; inventory:any; totals:{questions:number;parts:number;marks:number;unknownMarks:number;unresolvedClassifications:number;printedTotal:number|null};
  artifact:{id:string;sha256:string;revision:number}; gate:any; editable:boolean; rehearsal:boolean;
  pageLinks:Record<string,string>; commands:Record<string,{marks:string;cognition:string}>; decisionCommand:string; asOf:string; revisions:any[];
};
const needsAttention=(p:any)=>p.marks==null || !(COGNITIVE_CATEGORIES as readonly string[]).includes(p.taxonomy_description) || (p.flags||[]).length>0 || (p.source_observations||[]).some((o:any)=>o.content?.notes);
export function InventoryWorkspace({runId,inventory,totals,artifact,gate,editable,rehearsal,pageLinks,commands,decisionCommand,asOf,revisions}:InventoryWorkspaceProps) {
  const [questionIndex,setQuestionIndex]=useState(0),[partId,setPartId]=useState<string|null>(null),[filter,setFilter]=useState('all'),[showBlooms,setShowBlooms]=useState(false),[pageKey,setPageKey]=useState<string|null>(null);
  const questions=inventory.questions||[],q=questions[questionIndex];
  const allParts=questions.flatMap((x:any)=>x.sub_questions||[]);
  const visibleParts=(q?.sub_questions||[]).filter((p:any)=>filter==='all'||needsAttention(p));
  const part=visibleParts.find((p:any)=>p.id===partId)||visibleParts[0];
  const fragments=q?.source_content?.fragments||[];
  const pageRefs=new Map<string,{sourceId:string;page:number}>();
  for(const f of fragments)pageRefs.set(JSON.stringify([f.source_id,f.file_page]),{sourceId:f.source_id,page:f.file_page});
  for(const p of q?.sub_questions||[]) if(p.source_id&&p.source_page)pageRefs.set(JSON.stringify([p.source_id,p.source_page]),{sourceId:p.source_id,page:p.source_page});
  const selectedKey=pageKey&&pageRefs.has(pageKey)?pageKey:part?JSON.stringify([part.source_id,part.source_page]):pageRefs.keys().next().value;
  const sourcePage=selectedKey?pageRefs.get(selectedKey):undefined,url=selectedKey?pageLinks[selectedKey]:undefined;
  const corrections=inventory.human_mark_corrections||[],cognitiveCorrections=inventory.human_cognitive_corrections||[];
  const reconcile=totals.unknownMarks===0&&totals.printedTotal!==null&&totals.marks===totals.printedTotal;
  const bound=(gate.binding?.artifacts||[]).map((a:any)=>a.id);
  function chooseQuestion(index:number){setQuestionIndex(index);setPartId(null);setPageKey(null);}
  return <><StudioHeading breadcrumb={<><Link href="/admin/studio">Sources</Link> / <Link href={`/admin/studio/runs/${runId}`}>Analysis</Link> / Inventory</>} title="Review the paper inventory">
    <p>{inventory.source_identity?.year} · {inventory.source_identity?.period} · Grade {inventory.source_identity?.grade} · {inventory.source_identity?.paper_designation}</p><p>Revision {artifact.revision} · {gate.live?'Approved for matching':'Awaiting your decision · G1'}{rehearsal?' · Isolated rehearsal':''}</p>
  </StudioHeading>
  <Stats items={[{value:`${totals.parts} assessed parts`,label:`Across ${totals.questions} questions`},{value:`${totals.marks} / ${totals.printedTotal??'?'}`,label:'Recorded marks / printed paper total'},{value:totals.unresolvedClassifications,label:'Unresolved Bloom’s classifications'},{value:totals.unknownMarks,label:'Parts with unknown marks'}]}/>
  {!reconcile&&<section className={s['studio-panel--caution']} role="note"><h2>Marks need review</h2><p>The assessed marks do not yet reconcile to the printed paper total. Check the original source and record the reason for any correction.</p>{inventory.paper_total_evidence?.requires_review&&<details><summary>Conflicting paper-total observations</summary><p>The proposed total does not resolve or approve the discrepancy.</p><ul>{inventory.paper_total_evidence.observations.map((o:any)=><li key={`${o.source_id}:${o.file_page}`}>Page {o.file_page}: {o.printed_total_marks} marks · {o.disposition}. {o.notes}</li>)}</ul></details>}</section>}
  <div className={s['studio-toolbar']}><div className={s['studio-toolbar__group']} role="group" aria-label="Inventory views"><button className={s['studio-button']} aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All parts · {totals.parts}</button><button className={s['studio-button']} aria-pressed={filter==='attention'} onClick={()=>setFilter('attention')}>Needs attention · {allParts.filter(needsAttention).length}</button><button className={s['studio-button']} aria-pressed={showBlooms} onClick={()=>setShowBlooms(!showBlooms)}>Bloom’s overview</button></div>
    <div className={s['studio-toolbar__group']}><button className={s['studio-button']} disabled={questionIndex===0} onClick={()=>chooseQuestion(questionIndex-1)}>Previous</button><label className={s['studio-search']}>Question<select value={questionIndex} onChange={e=>chooseQuestion(Number(e.target.value))}>{questions.map((x:any,i:number)=><option key={x.number} value={i}>Question {x.number} of {questions.length}</option>)}</select></label><button className={s['studio-button']} disabled={questionIndex>=questions.length-1} onClick={()=>chooseQuestion(questionIndex+1)}>Next</button></div>
  </div>
  {showBlooms&&<section className={s['studio-panel']}><h2>Bloom’s overview</h2><p className={s.note}>Counts of assessed parts in this revision, not percentages of marks.</p><dl className={s['studio-blooms']}>{[...COGNITIVE_CATEGORIES,'Unresolved'].map(level=><div key={level}><dt>{level}</dt><dd>{allParts.filter((p:any)=>level==='Unresolved'?!(COGNITIVE_CATEGORIES as readonly string[]).includes(p.taxonomy_description):p.taxonomy_description===level).length}</dd></div>)}</dl></section>}
  {q&&<section className={s['studio-inventory']} aria-label={`Question ${q.number} review`}><aside className={s['studio-inventory__source']}>
    <div className={s['studio-toolbar']}><h2>Original source</h2><label className={s['studio-search']}>Source page<select value={selectedKey||''} onChange={e=>setPageKey(e.target.value)}>{[...pageRefs].map(([key,p])=><option key={key} value={key}>Page {p.page} · {p.sourceId}</option>)}</select></label></div>
    {url?<figure><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Original source page ${sourcePage?.page} for question ${q.number}`}/></a><figcaption>Page {sourcePage?.page} · select image to enlarge</figcaption></figure>:<div className={s['studio-panel--caution']}>A source image is not available for this part. Check the retained original before deciding.</div>}
    {fragments.filter((f:any)=>JSON.stringify([f.source_id,f.file_page])===selectedKey).map((f:any)=><details key={`${f.source_id}:${f.file_page}`}><summary>Shared wording and figure notes</summary><p className={s['source-text']}>{f.question?.content?.shared_stem}</p>{(f.question?.content?.figures||[]).map((figure:any)=><p key={figure.id}>{figure.description} {figure.notes}</p>)}<p>{f.page_notes}</p></details>)}
  </aside><div className={s['studio-inventory__parts']}><h2>Question {q.number} · {q.marks??'Unknown'} printed marks</h2>
    <div className={s['studio-inventory__table']}><table><thead><tr><th>Part</th><th>Task</th><th>Marks</th><th>Bloom’s level</th></tr></thead><tbody>{visibleParts.map((p:any)=><tr key={p.id} aria-selected={p.id===part?.id}><td><button onClick={()=>{setPartId(p.id);setPageKey(null);}} aria-label={`Review part ${p.id}`}>{p.id}</button></td><td>{p.task}</td><td>{p.marks??'Unknown'}{needsAttention(p)?' · review':''}</td><td>{p.taxonomy_description||'Unresolved'}</td></tr>)}</tbody></table></div>
    {!visibleParts.length&&<p className={s['studio-panel']}>No flagged parts in this question. Check all parts before approving.</p>}
    {part&&<article className={s['studio-inventory__editor']} key={`${artifact.id}:${part.id}`}><h3>Review part {part.id}</h3>
      {(part.source_observations||[]).map((o:any,n:number)=><div key={n}><p className={s['source-text']}>{o.content?.source_text||o.task}</p>{(o.content?.answer_choices||[]).map((c:any)=><p key={c.label}>{c.label}. {c.text}</p>)}{o.content?.notes&&<p className={s.note}>Source reading note · {o.content.notes}</p>}</div>)}
      {!part.source_observations?.length&&<p className={s['source-text']}>{part.transcription||part.task}</p>}
      {!!part.flags?.length&&<p className={s.note}>Flags: {part.flags.map((f:any)=>typeof f==='string'?f:JSON.stringify(f)).join('; ')}</p>}
      <p><strong>Bloom’s level: {part.taxonomy_description||'Unresolved'}</strong></p><p>{part.classification_reason}</p><p className={s.note}>Classification from {String(part.classification_provenance||'unresolved').replaceAll('_',' ')}.</p>
      {editable&&<><details><summary>Correct marks</summary><MarkCorrectionForm runId={runId} artifactId={artifact.id} expectedSha256={artifact.sha256} partId={part.id} marks={part.marks} command={commands[part.id].marks} asOf={asOf}/></details><details><summary>Correct Bloom’s level</summary><CognitiveCorrectionForm runId={runId} artifactId={artifact.id} expectedSha256={artifact.sha256} partId={part.id} category={part.taxonomy_description} reason={part.classification_provenance==='reviewer_judgement'?part.classification_reason:''} command={commands[part.id].cognition} asOf={asOf}/></details><p className={s.note}>Each save creates a new inventory revision. Save one correction and let the page refresh before the next. Original observations remain available; earlier approvals require review.</p></>}
    </article>}
  </div></section>}
  <section className={s['studio-panel']}><h2>G1 · Inventory decision</h2><p>Review all {totals.parts} assessed parts, the source evidence and open issues. Approving permits matching; it does not approve drafted content, bank integration or publication.</p><p className={s.note}>Memorandum comparison: {String(inventory.memorandum?.comparison_status||'not available').replaceAll('_',' ')}.</p>
    {gate.live?<p className={s['state--done']}>Approved for matching. Any subsequent correction requires a fresh review.</p>:editable&&gate.previousApproved?<InventoryDecisionForm key={`${gate.version}:${artifact.id}`} runId={runId} version={gate.version} bound={bound} command={decisionCommand}/>:<p className={s.note}>This run is not currently accepting an inventory decision.</p>}
  </section>
  <section className={`${s['studio-panel']} ${s['studio-history']}`}><h2>Correction and revision history</h2><details><summary>Recorded corrections · {corrections.length+cognitiveCorrections.length}</summary>{!corrections.length&&!cognitiveCorrections.length&&<p>No corrections recorded.</p>}{corrections.map((c:any)=><p key={c.command}>Part {c.part_id}: {c.previous_marks??'unknown'} → {c.corrected_marks??'unknown'} marks. {c.reason} · {c.date}</p>)}{cognitiveCorrections.map((c:any)=><p key={c.command}>Part {c.part_id}: {c.previous.taxonomy_description??'unresolved'} → {c.corrected.taxonomy_description??'unresolved'}. {c.reason} · {c.date}</p>)}</details><details><summary>Inventory revisions · {revisions.length}</summary>{revisions.map((a:any)=><p key={a.id}><Link href={`/admin/studio/files/${a.id}`}>Download revision {a.revision}</Link> · {a.state} · {a.author} · {a.createdAt}</p>)}</details><Link href={`/admin/studio/runs/${runId}/execution`}>Open execution history →</Link></section>
  </>;
}
