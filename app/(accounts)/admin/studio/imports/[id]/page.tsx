import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireStudioEditor} from '../../../../../../lib/studio/server';
import {call,isUuid} from '../../../../../../lib/studio/contracts';
import {importedStatus,importedRole} from '../../../../../../lib/studio/imported-analysis';
import {StaffHeader} from '../../../../staff-header';
import ui from '../../../../experience.module.css';
import s from '../../studio.module.css';
import {StudioShell,StudioHeading} from '../../components';
export const dynamic='force-dynamic';
export default async function ImportedAnalysis({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!isUuid(id))notFound();
 const {rpc,account}=await requireStudioEditor();let record:any;
 try{record=await call(rpc,'studio_imported_analysis',{p_id:id});}catch{notFound();}
 const p=record.provenance;
 return <><StaffHeader current="studio" studioEnabled signedIn name={(account.full_name||'').split(/\s+/)[0]} record={{back:'/admin/studio',label:'Curriculum Studio'}}/>
 <StudioShell moduleId={record.moduleId}>
 <StudioHeading breadcrumb={<><Link href="/admin/studio">Sources</Link> / Imported history</>} title={record.title}>{importedStatus[record.status as keyof typeof importedStatus]}</StudioHeading>
 <section className={s.card}><h2 className={s.card__title}>Analysis history</h2>
 <p>These files were imported from the existing {record.moduleId.includes('grade-10')?'Grade 10':record.moduleId.includes('grade-11')?'Grade 11':record.moduleId} collection. Importing preserves the earlier work and does not run the analysis again.</p>
 <dl><dt>Original record</dt><dd>{p.originalId||'Not recorded'}</dd><dt>Original analysis date</dt><dd>{p.analysedOn||'Not recorded'}</dd><dt>Identity evidence</dt><dd>{p.identityNote||'Historical labels retained; not independently reverified during import.'}</dd><dt>Imported</dt><dd>{record.importedAt.slice(0,10)}</dd></dl>
 <p>{p.note}</p>{Array.isArray(p.limitations)&&p.limitations.length>0&&<ul>{p.limitations.map((x:string,i:number)=><li key={i}>{x}</li>)}</ul>}
 <p className={s.note}>The files retain their historical claims. No Studio worker run, model call, human checkpoint approval or new bank integration is recorded by this import.</p>
 </section>
 <section className={s.card}><h2 className={s.card__title}>Retained files</h2><p className={s.note}>Original filenames and duplicate aliases are preserved. Identical bytes share one stored object. Downloads are checked against their recorded digest.</p>
 <table className={s.table}><thead><tr><th>File</th><th>Kind</th><th>Size</th><th>Integrity</th></tr></thead><tbody>{record.files.map((f:any)=><tr key={f.id}><td><Link className={ui.link} href={`/admin/studio/imports/files/${f.id}`}>{f.path}</Link></td><td>{importedRole[f.role as keyof typeof importedRole]}</td><td>{Math.ceil(f.size/1024)} KB</td><td>{f.integrity}</td></tr>)}</tbody></table></section>
 </StudioShell></>;
}
