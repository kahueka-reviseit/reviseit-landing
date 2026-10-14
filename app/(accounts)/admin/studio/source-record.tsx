import Link from 'next/link';
import {StudioHeading} from './components';
import {moduleLabel} from '../../../../lib/studio/presentation';
import s from './studio.module.css';
export function SourceRecord({source,runs,analysis}:{source:any;runs:any[];analysis?:any}) {
 const id=source.id;
 return <>
    <StudioHeading breadcrumb={<><Link href={`/admin/studio?module=${encodeURIComponent(source.moduleId)}`}>Sources</Link> / Past paper</>} title={source.title}>{moduleLabel(source.moduleId)} · source revision {source.revision}</StudioHeading>
    {analysis && <section className={s['studio-panel']}><h2>Extracted question inventory</h2>{analysis.unavailable?<p>The inventory summary could not be loaded. Open its analysis run to check the retained evidence.</p>:<><p>{analysis.totals.parts} assessed parts across {analysis.totals.questions} questions · {analysis.totals.marks} recorded / {analysis.totals.printedTotal??'unknown'} printed marks</p><p className={s.note}>Inventory revision {analysis.revision}. These are extraction results; review the original before approving.</p><Link className={s['studio-button']} href={`/admin/studio/runs/${analysis.runId}/inventory`}>Review inventory</Link></>}</section>}
    <div className={s['studio-columns']}><section className={s['studio-panel']}><h2>Retained source files</h2><p>Each analysis keeps the source revision it began with. Downloads check the bytes against their saved fingerprint.</p>
      {source.revisions.map((revision:any)=><section key={revision.id} className={s['studio-list']}><h3>Revision {revision.revision}{revision.revision===source.revision?' · current':''}</h3><p className={s.note}>{revision.reason} · {revision.createdAt.slice(0,10)}</p>
        {revision.files.map((f:any)=><div key={`${f.blobId}:${f.role}`} className={s['studio-panel']}><strong>{f.filename}</strong><p className={s.note}>{f.role.replaceAll('_',' ')} · {Math.ceil(f.size/1024)} KB · {f.integrity}</p><Link href={`/admin/studio/sources/${id}/files/${f.blobId}`}>Download original →</Link></div>)}
        {Object.keys(revision.identity||{}).length>0 && <details><summary>Recorded source identity</summary><pre className={s['source-text']}>{JSON.stringify(revision.identity,null,2)}</pre></details>}
      </section>)}
    </section><aside className={s['studio-panel']}><h2>Analysis history</h2>{runs.length ? runs.map((r:any)=><div key={r.id} className={s['studio-list']}><Link href={`/admin/studio/runs/${r.id}`}>Open run {r.id.slice(0,8)} →</Link><p className={s.note}>{r.purpose} · {r.state} · {r.createdAt.slice(0,10)}</p></div>) : <p>No analysis has started.</p>}<p className={s.note}>Source identity and question inventory are reviewed before matching. A completed extraction is not a content approval.</p></aside></div>
 </>;
}
