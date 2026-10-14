import Link from 'next/link';
import {creditsEnabled} from '../../../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../../../lib/studio/server';
import {call,sha256} from '../../../../../../../lib/studio/contracts';
import {studioStorage} from '../../../../../../../lib/studio/storage';
import {readDraftText} from '../../../../../../../lib/studio/maintenance-save';
import {parseAuthoredForm,canonicalFormJson} from '../../../../../../../lib/studio/form-authoring';
import {newDraftUrl} from '../../../../../../../lib/studio/maintenance-drafts';
import {catalogueEntryId,snapshotLabel,itemUrl,type LibraryData,type CatalogueItem,type FileDetail} from '../../../../../../../lib/studio/library';
import {StaffHeader} from '../../../../../staff-header';
import {StudioShell,StudioHeading} from '../../../components';
import s from '../../../studio.module.css';
export const dynamic='force-dynamic';
export default async function FormSources({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{module?:string;release?:string}>}) {
 const {rpc,account}=await requireStudioEditor(),{id}=await params,q=await searchParams;let item:CatalogueItem|null=null,error='';
 const choices:Array<{label:string;file:FileDetail;matches:boolean}>=[];
 try {
  item=await call<CatalogueItem>(rpc,'studio_catalogue_item_view',{p_module:q.module||'',p_release:q.release||'',p_entry:catalogueEntryId(id)});
  const library=await call<LibraryData>(rpc,'studio_library_view',{p_module:item.moduleId}),storage=studioStorage();
  if(!storage)throw new Error('Storage unavailable');
  const [kind,recordId]=item.entryId.split(':'),path=`data/forms/authored/${kind==='structured'?'specification':'multiple-choice'}/${recordId}.json`;
  for(const snapshot of library.snapshots) {
   try {
    const file=await call<FileDetail>(rpc,'studio_bank_file_view',{p_snapshot:snapshot.id,p_path:path});
    const form=parseAuthoredForm(file,await readDraftText(rpc,storage,file.blobId,file.sha256));
    if(form&&form.form_revision===sha256(canonicalFormJson({fields:form.fields,identity:form.identity})))choices.push({label:snapshotLabel(snapshot),file,matches:form.form_revision===item.form?.revision});
   }catch{}
  }
 }catch{error='The form sources could not be loaded. Return to the item and try again.';}
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="library" moduleId={item?.moduleId}>
 <StudioHeading title="Choose a form source" breadcrumb={item?<Link href={itemUrl(item)}>Library / {item.entryId}</Link>:'Library'}>{item?.title} · teacher release {item?.release}</StudioHeading>
 <p>Choose the bank copy you want to edit. Published teacher definitions remain separate from private drafts.</p>
 {error?<p role="alert">{error}</p>:!choices.length?<p role="status">No verified, matching authored form identity is available in the retained snapshots. A form source must be imported before it can be edited here.</p>:choices.map(c=><article className={s['studio-panel']} key={c.file.snapshotId}><h2>{c.label}</h2><p>{c.matches?'Its field fingerprint matches this teacher release.':'Its fields differ from this teacher release. Review the source before editing.'}</p><code className={s['studio-path']}>{c.file.path}</code><Link className={s['studio-button--primary']} href={newDraftUrl(c.file)}>Open form editor</Link></article>)}
 </StudioShell></>;
}
