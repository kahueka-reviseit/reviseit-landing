'use client';
import {useState} from 'react';
import Link from 'next/link';
import {StudioHeading} from './components';
import {type LibraryData,itemUrl,fileUrl,recordLabel,snapshotLabel,marksLabel} from '../../../../lib/studio/library';
import {moduleLabel} from '../../../../lib/studio/presentation';
import s from './studio.module.css';

export function LibraryView({data,moduleId,initialTab='catalogue'}:{data:LibraryData;moduleId?:string;initialTab?:string}) {
 const [tab,setTab]=useState(['catalogue','tasks','files'].includes(initialTab)?initialTab:'catalogue');
 const [search,setSearch]=useState(''),[availability,setAvailability]=useState('all'),[topic,setTopic]=useState('all');
 const snapshot=data.snapshots.find(x=>x.id===data.selectedSnapshotId);
 const match=(...parts:string[])=>parts.join(' ').toLowerCase().includes(search.trim().toLowerCase());
 const items=data.items.filter(i=>match(i.title,i.entryId,i.topic)&& (topic==='all'||i.topic===topic) && (availability==='all'||(availability==='available')===i.orderable));
 const records=data.records.filter(r=>['task_type','task_variant'].includes(r.kind)&&match(recordLabel(r),r.path));
 const files=data.files.filter(f=>match(f.path));
 const query=moduleId?`?module=${encodeURIComponent(moduleId)}`:'';
 return <><StudioHeading breadcrumb={`Library / ${moduleId?moduleLabel(moduleId):'All modules'}`} title="Question library">
  {data.items.length} catalogue items in the current teacher releases. Bank files are browsed in an explicitly selected snapshot.
 </StudioHeading>
 <div className={s['studio-toolbar']}><div role="group" aria-label="Library views" className={s['studio-toolbar__group']}>
  <button className={s['studio-button']} aria-pressed={tab==='catalogue'} onClick={()=>setTab('catalogue')}>Catalogue items · {data.items.length}</button>
  <button className={s['studio-button']} aria-pressed={tab==='tasks'} onClick={()=>setTab('tasks')}>Task types & variants</button>
  <button className={s['studio-button']} aria-pressed={tab==='files'} onClick={()=>setTab('files')}>Browse files</button>
 </div><div className={s['studio-toolbar__group']}><Link href={`/admin/studio/library/drafts${query}`}>Private drafts →</Link><Link href={`/admin/studio/releases${query}`}>View releases →</Link></div></div>
 <div className={s['studio-toolbar']}><label className={s['studio-search']}>Find an item or file<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title, topic, identifier or path"/></label>
 {tab==='catalogue'&&<><label className={s['studio-search']}>Topic<select value={topic} onChange={e=>setTopic(e.target.value)}><option value="all">All topics</option>{Array.from(new Set(data.items.map(i=>i.topic))).sort().map(t=><option key={t}>{t}</option>)}</select></label><label className={s['studio-search']}>Availability<select value={availability} onChange={e=>setAvailability(e.target.value)}><option value="all">All items</option><option value="available">Available to order</option><option value="unavailable">Not available to order</option></select></label></>}
 </div>
 {tab==='catalogue'?<div className={s['studio-columns']}><div className={s['studio-list']}>
  {!items.length&&<p role="status">No catalogue items match this view.</p>}
  {items.map(i=><article className={s['studio-library-row']} key={`${i.moduleId}:${i.entryId}`}><div><h2><Link href={itemUrl(i)}>{i.title}</Link></h2><p className={s.note}>{i.entryId} · {marksLabel(i.marksMin,i.marksMax)} · {i.topic}</p><p className={s.note}>{moduleLabel(i.moduleId)} · Release {i.release}</p></div><div className={s['studio-library-row__status']}><span className={i.orderable?s['state--done']:s['state--attention']}>{i.orderable?'Available':'Not available to order'}</span><Link href={itemUrl(i)}>Open item →</Link></div></article>)}
 </div><aside className={s['studio-panel']}><h2>Make an item usable</h2><p>Content → Teacher questions → Catalogue copy and illustration → Checks → Release.</p><p>A “no input needed” form is complete. An absent form is not.</p><p className={s.note}>This view shows registered teacher definitions. Bank snapshots are separate; an unpublished edit is not inferred from a different file or release.</p></aside></div>:
 <><section className={s['studio-panel']}><h2>Bank snapshot</h2>
 {!moduleId?<p>Choose a curriculum module to browse its bank files.</p>:<form action="/admin/studio/library" className={s.form}><input type="hidden" name="module" value={moduleId}/><input type="hidden" name="tab" value={tab}/><label>Snapshot<select name="snapshot" defaultValue={data.selectedSnapshotId||''}><option value="">Current accepted bank</option>{data.snapshots.map(x=><option value={x.id} key={x.id}>{snapshotLabel(x)}</option>)}</select></label><button className={s['studio-button']} type="submit">Open snapshot</button></form>}
 {!snapshot?<p className={s.note}>No accepted bank is selected. A rehearsal copy must be chosen explicitly and cannot be published.</p>:<><p><strong>{snapshotLabel(snapshot)}</strong> · {snapshot.fileCount} files</p>{!snapshot.accepted&&<p className={s.note}>{snapshot.purpose==='rehearsal'?'This is an isolated rehearsal copy, not the accepted bank or a teacher release.':'This is a retained historical copy, not the current accepted bank.'}</p>}</>}
 </section>
 {snapshot&&<div className={s['studio-data-table']}><table><caption>{tab==='tasks'?`${records.length} matching task records. Variants share their parent’s file.`:`${files.length} matching files in this snapshot.`}</caption><thead><tr>{(tab==='tasks'?['Identifier','Kind','Source file','State']:['File','Size','Integrity']).map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
 {tab==='tasks'?records.map(r=><tr key={`${r.kind}:${r.parentId}:${r.id}`}><td><Link href={fileUrl(snapshot.id,r.path)}>{recordLabel(r)}</Link></td><td>{r.kind==='task_variant'?'Variant':'Task type'}</td><td className={s['studio-path']}>{r.path}</td><td>{r.status}</td></tr>):files.map(f=><tr key={f.path}><td className={s['studio-path']}><Link href={fileUrl(snapshot.id,f.path)}>{f.path}</Link></td><td>{Math.ceil(f.size/1024)} KB</td><td>{f.integrity}</td></tr>)}
 </tbody></table>{(tab==='tasks'?records:files).length===0&&<p role="status">No matching records in this snapshot.</p>}</div>}
 </>}
 </>;
}
