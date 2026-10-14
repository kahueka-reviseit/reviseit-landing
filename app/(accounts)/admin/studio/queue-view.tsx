'use client';
import Link from 'next/link';
import {useState} from 'react';
import {Checkpoints,StudioHeading} from './components';
import {queueStatus} from '../../../../lib/studio/presentation';
import s from './studio.module.css';
export function QueueView({runs}:{runs:any[]}) {
  const [filter,setFilter]=useState('All runs');
  const options=['All runs','Running','Blocked','Needs review'];
  const items=runs.filter(r=>filter==='All runs'||queueStatus(r.stages,r.views,r.state)===filter);
  return <><StudioHeading title="Work queue" breadcrumb="Curriculum Studio / Work queue" action={<Link href="/admin/studio" className={s['studio-button--primary']}>Choose a source</Link>}>Current analysis, retained history and human checkpoints</StudioHeading>
    <div className={s['studio-toolbar__group']} role="group" aria-label="Run filter">{options.map(label=><button className={s['studio-button']} aria-pressed={filter===label} key={label} onClick={()=>setFilter(label)}>{label} · {label==='All runs'?runs.length:runs.filter(r=>queueStatus(r.stages,r.views,r.state)===label).length}</button>)}</div>
    {!items.length&&<section className={s['studio-panel']}><h2>No runs in this view</h2><p>Choose another filter or open a source to set up an analysis.</p></section>}
    {items.map(r=><article key={r.id} className={s['studio-list']}><div className={s['studio-panel']}><div className={s['studio-toolbar']}><div><h2>{r.title}</h2><p className={s.note}>{r.purpose} · {r.state} · run {r.id.slice(0,8)}</p></div><span className={s['state--attention']}>{queueStatus(r.stages,r.views,r.state)}</span></div><div className={s['studio-toolbar__group']}><Link className={s['studio-button']} href={`/admin/studio/runs/${r.id}`}>Open analysis</Link><Link href={`/admin/studio/runs/${r.id}/execution`}>View execution history →</Link></div></div>
      {r.state==='active'&&<Checkpoints runId={r.id} views={r.views} decisions={r.decisions}/>}</article>)}
    <p className={s.note}>Approvals apply to exact revisions. A replacement or correction requires fresh review. Catalogue publication is separate from bank integration.</p>
  </>;
}
