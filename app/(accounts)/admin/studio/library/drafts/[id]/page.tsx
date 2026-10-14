import {creditsEnabled} from '../../../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../../../lib/studio/server';
import {call,isUuid} from '../../../../../../../lib/studio/contracts';
import {studioStorage} from '../../../../../../../lib/studio/storage';
import {readDraftText} from '../../../../../../../lib/studio/maintenance-save';
import {canDraftFile,draftUrl,type MaintenanceDraft,type DraftSummary} from '../../../../../../../lib/studio/maintenance-drafts';
import {fileUrl,type FileDetail} from '../../../../../../../lib/studio/library';
import {parseAuthoredForm,type FormSource} from '../../../../../../../lib/studio/form-authoring';
import {StaffHeader} from '../../../../../staff-header';
import {StudioShell,StudioHeading} from '../../../components';
import {DraftEditor} from '../../../draft-editor';
import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Draft({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{snapshot?:string;path?:string;revision?:string}>}) {
 const {rpc,account,user}=await requireStudioEditor(),{id}=await params,q=await searchParams;
 let file:FileDetail|null=null,draft:MaintenanceDraft|null=null,baseText='',currentText='',selectedText='',selectedRevision=0,error='',existing:string|null=null;const sources:FormSource[]=[];
 try {
  if(id==='new') {
   if(!isUuid(q.snapshot))throw new Error('Select a bank snapshot first.');
   file=await call<FileDetail>(rpc,'studio_bank_file_view',{p_snapshot:q.snapshot,p_path:q.path||''});
   const others=await call<DraftSummary[]>(rpc,'studio_maintenance_drafts_view',{p_snapshot:q.snapshot,p_path:file.path});
   existing=others.find(d=>d.state==='draft')?.id||null;
  } else {
   if(!isUuid(id))throw new Error('Invalid draft.');
   draft=await call<MaintenanceDraft>(rpc,'studio_maintenance_draft_view',{p_draft:id});file=draft.file;
  }
  if(!canDraftFile(file))throw new Error('This file cannot be edited in the text editor.');
  const storage=studioStorage();if(!storage)throw new Error('Storage unavailable.');
  baseText=await readDraftText(rpc,storage,file.blobId,file.sha256);
  const current=draft?.revisions.find(r=>r.revision===draft?.revision);
  currentText=current?await readDraftText(rpc,storage,current.blobId,current.sha256):baseText;
  selectedRevision=q.revision===undefined?(draft?.revision||0):Number(q.revision);
  if(!Number.isSafeInteger(selectedRevision)||selectedRevision<0||selectedRevision>(draft?.revision||0))throw new Error('Unknown revision.');
  const selected=draft?.revisions.find(r=>r.revision===selectedRevision);
  selectedText=selected?selectedRevision===draft?.revision?currentText:await readDraftText(rpc,storage,selected.blobId,selected.sha256):baseText;
  const authored=parseAuthoredForm(file,currentText);
  if(authored&&Array.isArray(authored.current_source_matches))for(const source of authored.current_source_matches) {
   if(!source||typeof source.path!=='string'||typeof source.sha256!=='string')continue;
   const entry:FormSource={path:source.path,sha256:source.sha256,verified:false,url:null};
   const prefix=`our content/${file.moduleId}/`;
   if(source.path.startsWith(prefix))try {
    const path=source.path.slice(prefix.length),bound=await call<FileDetail>(rpc,'studio_bank_file_view',{p_snapshot:file.snapshotId,p_path:path});
    if(bound.sha256===source.sha256&&bound.integrity==='verified'){entry.verified=true;entry.url=fileUrl(file.snapshotId,path);}
   }catch{}
   sources.push(entry);
  }
 }catch {error='The draft or its verified source bytes could not be loaded. Refresh, or return to the source file.';}
 if(existing&&!error)redirect(draftUrl(existing));
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="library" moduleId={file?.moduleId}>
 {file&&!error?<DraftEditor key={`${draft?.id||'new'}:${draft?.revision||0}:${draft?.state||''}`} file={file} draft={draft} baseText={baseText} currentText={currentText} selectedText={selectedText} selectedRevision={selectedRevision} viewerId={user.id} asOf={new Date().toISOString().slice(0,10)} sources={sources}/>:<><StudioHeading title="Draft unavailable" breadcrumb="Library"/><p role="alert">{error}</p></>}
 </StudioShell></>;
}
