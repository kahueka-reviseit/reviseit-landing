import Link from 'next/link';
import type { ReactNode } from 'react';
import { moduleLabel, checkpointSteps, checkpointStatus } from '../../../../lib/studio/presentation';
import s from './studio.module.css';

export function StudioShell({ children, moduleId, modules = [], current = 'sources' }: { children: ReactNode; moduleId?: string; modules?: string[]; current?: 'sources'|'queue'|'library'|'releases' }) {
  const query = moduleId ? `?module=${encodeURIComponent(moduleId)}` : '';
  const section = current === 'sources' ? '' : `/${current}`;
  return <div className={s['studio-shell']}><aside className={s['studio-shell__sidebar']}>
    <details className={s['studio-shell__module']}><summary><span className={s['studio-shell__eyebrow']}>Curriculum module</span><strong>{moduleId ? moduleLabel(moduleId) : 'All curriculum modules'}</strong><span className={s['studio-shell__switch']}>Switch module ⌄</span></summary>
      <Link href={`/admin/studio${section}`}>All modules</Link>
      {modules.filter(m => m !== moduleId).map(m => <Link key={m} href={`/admin/studio${section}?module=${encodeURIComponent(m)}`}>{moduleLabel(m)}</Link>)}
    </details>
    <nav aria-label="Curriculum Studio" className={s['studio-shell__nav']}>
      <Link href={`/admin/studio${query}`} aria-current={current === 'sources' ? 'page' : undefined}>Sources</Link>
      <Link href={`/admin/studio/library${query}`} aria-current={current === 'library' ? 'page' : undefined}>Library</Link>
      <Link href={`/admin/studio/queue${query}`} aria-current={current === 'queue' ? 'page' : undefined}>Work queue</Link>
      <Link href={`/admin/studio/releases${query}`} aria-current={current === 'releases' ? 'page' : undefined}>Releases</Link>
    </nav>
  </aside><main id="studio-content" className={s['studio-shell__main']}>{children}</main></div>;
}
export function StudioHeading({ breadcrumb, title, children, action }: { breadcrumb: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <header className={s['studio-heading']}><div><div className={s['studio-heading__breadcrumb']}>{breadcrumb}</div><h1>{title}</h1>{children && <div className={s['studio-heading__description']}>{children}</div>}</div>{action}</header>;
}
export function Stats({ items }: { items: { value: ReactNode; label: string }[] }) {
  return <dl className={s['studio-stats']}>{items.map(i => <div key={i.label}><dt>{i.label}</dt><dd>{i.value}</dd></div>)}</dl>;
}
export function Checkpoints({ runId, views, decisions = [] }: { runId: string; views: any[]; decisions?: any[] }) {
  return <section className={s['studio-checkpoints']} aria-label="Analysis progress">{checkpointSteps.map((step,i) => {
    const status = checkpointStatus(views[i],decisions,step.gate);
    return <div className={s['studio-checkpoints__row']} key={step.gate}><div><span className={s.note}>{step.work}</span><h3>{step.gate.slice(0,2)} · {step.title}</h3><p className={s.note}>{step.detail}</p></div><span className={status === 'Approved' ? s['state--done'] : status === 'Waiting' ? s.state : s['state--attention']}>{status}</span>
      {views[i]?.binding ? <Link href={i === 0 ? `/admin/studio/runs/${runId}/inventory` : `/admin/studio/runs/${runId}#${step.gate}`}>{views[i].live ? 'View review' : 'Review →'}</Link> : <span className={s.note}>Not ready</span>}</div>;
  })}</section>;
}
