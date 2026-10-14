'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { StudioHeading } from './components';
import { importedStatus } from '../../../../lib/studio/presentation';
import { moduleLabel } from '../../../../lib/studio/presentation';
import s from './studio.module.css';
export function SourcesView({ sources, imported, runs, upload }: { sources: any[]; imported: any[]; runs: any[]; upload: ReactNode }) {
  const [filter,setFilter] = useState('all'), [search,setSearch] = useState('');
  const match = (title: string) => title.toLowerCase().includes(search.toLowerCase());
  const visibleSources = sources.filter(x => match(x.title) && (filter === 'retired' ? x.state === 'retired' : x.state !== 'retired') && filter !== 'imported');
  const visibleImports = filter === 'retired' || filter === 'new' ? [] : imported.filter(x => match(x.title));
  return <><StudioHeading breadcrumb="Sources" title="Source library" action={<a className={s['studio-button--primary']} href="#upload">Upload documents</a>}>Past papers, memoranda and retained analysis records</StudioHeading>
    <div className={s['studio-toolbar']}><div className={s['studio-toolbar__group']} role="group" aria-label="Source filter">{[['all','All documents'],['new','Studio sources'],['imported','Previously analysed'],['retired','Retired sources']].map(([value,label]) => <button key={value} className={s['studio-button']} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div><label className={s['studio-search']}>Find a document<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search titles"/></label></div>
    <div className={s['studio-columns']}><div className={s['studio-list']}>
      {!visibleSources.length && !visibleImports.length && <div className={s['studio-panel']}><h2>No matching documents</h2><p>Try another title or filter, or upload a source.</p></div>}
      {visibleSources.map(src => { const sourceRuns=runs.filter(r=>r.sourceId===src.id); return <article key={src.id} className={s['studio-panel']}><h2><Link href={`/admin/studio/sources/${src.id}`}>{src.title}</Link></h2><p className={s.note}>{moduleLabel(src.moduleId)} · source revision {src.revision}</p><p>{sourceRuns.length ? `${sourceRuns.length} analysis ${sourceRuns.length===1?'run':'runs'} retained` : 'Ready to set up an analysis'}</p><div className={s['studio-toolbar__group']}><Link className={s['studio-button']} href={`/admin/studio/sources/${src.id}`}>Open source</Link>{sourceRuns[0] && <Link className={s['studio-button']} href={`/admin/studio/runs/${sourceRuns[0].id}`}>View latest run</Link>}</div></article>; })}
      {visibleImports.map(x => <article key={x.id} className={s['studio-panel']}><h2><Link href={`/admin/studio/imports/${x.id}`}>{x.title}</Link></h2><p className={s.note}>{moduleLabel(x.moduleId)} · imported history</p><p>{importedStatus[x.status as keyof typeof importedStatus]} · {x.fileCount} files</p><Link className={s['studio-button']} href={`/admin/studio/imports/${x.id}`}>Open retained collection</Link></article>)}
    </div><aside id="upload" className={s['studio-panel']}><h2>Add documents</h2><p>Choose a PDF or source image. The stored bytes are verified before the source is accepted.</p>{upload}<p className={s.note}>Existing collections retain their original papers and analysis reports. Importing them does not rescan or approve them.</p></aside></div>
  </>;
}
