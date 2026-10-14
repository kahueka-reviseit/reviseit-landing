'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {ReleasePreparationData} from '../../../../lib/studio/release-preparation';
import {moduleLabel} from '../../../../lib/studio/presentation';
import {requestReleasePreparation,cancelReleasePreparation} from './release-actions';
import s from './studio.module.css';
export function ReleasePreparations({data}:{data:ReleasePreparationData}) {
 const router=useRouter(),commands=useRef<Record<string,string>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function request(bank:ReleasePreparationData['banks'][number]) {setBusy(true);setMessage('');const key=bank.snapshotId+':'+bank.currentRelease;commands.current[key]??=crypto.randomUUID();const r=await requestReleasePreparation({snapshotId:bank.snapshotId,expectedCurrent:bank.currentRelease,command:commands.current[key]});setBusy(false);if(r.ok){delete commands.current[key];setMessage('Build requested. The content operator runs the pinned producer on the authoring machine. Refresh to see the retained result.');router.refresh();}else setMessage(r.error);}
 async function cancel(id:string){setBusy(true);const r=await cancelReleasePreparation(id);setBusy(false);setMessage(r.ok?'Preparation cancelled. Any late build result will be refused.':r.error);router.refresh();}
 return <section aria-label="Release preparation"><h2>Prepare from the accepted bank</h2><p>Build the catalogue, teacher questionnaires and generation instructions together. Reviewed classification rules are reused only when their bindings match exactly. Changes are held for review.</p>
 <p className={s.note}>Preparation runs through the existing content operator on the authoring machine. It creates a private package in storage. It does not approve content, register a worker bundle or publish a catalogue.</p>
 {!data.banks.length&&<p>No accepted bank is available. Finish bank integration first.</p>}
 {data.banks.map(bank=><div className={s['studio-panel']} key={bank.moduleId}><h3>{moduleLabel(bank.moduleId)}</h3><p>Accepted bank <code>{bank.manifestSha256.slice(0,12)}</code> · Teacher release {bank.currentRelease||'none'}</p><button className={s['studio-button--primary']} disabled={busy||data.preparations.some(p=>p.snapshotId===bank.snapshotId&&p.current&&['queued','building'].includes(p.state))} onClick={()=>request(bank)}>Prepare release files</button></div>)}
 {message&&<p role="status">{message}</p>}
 <h3>Preparation history</h3>{!data.preparations.length&&<p>No release files have been prepared in Studio yet.</p>}
 {data.preparations.map(p=><article className={s['studio-panel']} key={p.id} id={p.id}><div className={s['studio-toolbar']}><h3>{moduleLabel(p.moduleId)}{p.report?` · ${p.report.release}`:''}</h3><strong>{p.state==='checked'?'File checks passed':p.state==='blocked'?'Review needed':p.state==='building'?'Building':p.state==='queued'?'Awaiting operator':p.state==='cancelled'?'Cancelled':'Build failed'}</strong></div>
 <p className={s.note}>{p.createdAt.slice(0,10)} · {p.createdBy} · {p.current?'Inputs still current':'Superseded inputs; prepare again'}</p>
 {['queued','building'].includes(p.state)&&<><p>{p.state==='queued'?'Waiting for the content operator to run this build.':'The operator is building or recovering this preparation. It is not retried automatically.'}</p><button className={s['studio-button']} disabled={busy} onClick={()=>cancel(p.id)}>Cancel preparation</button></>}
 {p.report&&<><div className={s['studio-data-table']}><table><thead><tr><th>Check</th><th>Result</th><th>Evidence</th></tr></thead><tbody>{p.report.checks.map(c=><tr key={c.name}><td>{({catalogue:'Catalogue',forms:'Teacher questionnaires',workflow:'Generation instructions',classifications:'Reviewed classifications',registration:'Database rehearsal',orderCompilation:'Order compilation'})[c.name]||c.name}</td><td>{c.status==='passed'?'Passed':'Needs review'}</td><td>{c.detail}</td></tr>)}</tbody></table></div>
 <p>{p.report.items.length} catalogue items · {p.report.items.filter(i=>i.form==='authored').length} questionnaires with inputs · {p.report.items.filter(i=>i.form==='no-input').length} explicit no-input forms · {p.report.items.filter(i=>i.form==='missing').length} missing forms</p>
 {p.report.items.some(i=>i.reasons.length>0)&&<details><summary>Items requiring review</summary><ul>{p.report.items.filter(i=>i.reasons.length).map(i=><li key={i.id}><strong>{i.id}</strong>: {i.reasons.join('; ')}</li>)}</ul></details>}
 <details><summary>What still needs to happen before publication</summary><ul>{p.report.notChecked.map(x=><li key={x}>{x}</li>)}</ul></details>
 <details><summary>Retained package · {p.report.files.length} files</summary><p className={s.note}>Private files are saved under immutable fingerprints. This list is build evidence, not a worker registration receipt.</p><div className={s['studio-data-table']}><table><thead><tr><th>File</th><th>Bytes</th><th>Fingerprint</th></tr></thead><tbody>{p.report.files.map(f=><tr key={f.path}><td><a href={`/admin/studio/releases/${p.id}/files?path=${encodeURIComponent(f.path)}`} download><code className={s['studio-path']}>{f.path}</code></a></td><td>{f.size}</td><td><code>{f.sha256.slice(0,12)}</code></td></tr>)}</tbody></table></div></details>
 <details><summary>Build identity</summary><p>Accepted bank: <code className={s['studio-path']}>{p.report.bankManifestSha256}</code></p><p>Producer and consumer code: <code className={s['studio-path']}>{p.report.toolchainSha256}</code></p><p>Report: <code className={s['studio-path']}>{p.reportSha256}</code></p><p>Preparation: <code>{p.id}</code></p></details>
 <p><a href={`/admin/studio/releases/${p.id}/files?path=report.json`} download>Download preparation report</a></p><p><strong>Not published.</strong> File checks do not constitute human content approval.</p></>}
 </article>)}
 </section>;
}
