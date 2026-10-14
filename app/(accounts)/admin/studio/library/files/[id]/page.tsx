import {creditsEnabled} from '../../../../../../../lib/credits/server';
import {requireStudioEditor} from '../../../../../../../lib/studio/server';
import {call,isUuid} from '../../../../../../../lib/studio/contracts';
import {readBlob} from '../../../../../../../lib/studio/uploads';
import {studioStorage} from '../../../../../../../lib/studio/storage';
import type {FileDetail} from '../../../../../../../lib/studio/library';
import {StaffHeader} from '../../../../../staff-header';
import {Notice} from '../../../../../system/notice';
import {StudioShell,StudioHeading} from '../../../components';
import {BankFileView} from '../../../bank-file';
export const dynamic='force-dynamic';
export default async function File({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{path?:string}>}) {
 const {rpc,account}=await requireStudioEditor(),{id}=await params,q=await searchParams;let file:FileDetail|null=null,content:string|null=null,error:string|undefined;
 try {if(!isUuid(id))throw new Error('Invalid snapshot');file=await call(rpc,'studio_bank_file_view',{p_snapshot:id,p_path:q.path||''});}catch{}
 if(file)try {
  const storage=studioStorage();if(!storage)throw new Error('Storage unavailable');
  if(file.size>1024*1024)error='This document exceeds the one-megabyte text preview limit.';
  else if(/\.(md|json|txt|csv|py)$/i.test(file.path)) {const {info,bytes}=await readBlob(rpc,storage,file.blobId);if(info.sha256!==file.sha256)throw new Error('Source binding changed');content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 }catch {error='The source bytes could not be read or failed their integrity check.';}
 return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell current="library" moduleId={file?.moduleId}>{file?<BankFileView file={file} content={content} error={error}/>:<><StudioHeading title="Bank file unavailable" breadcrumb="Library"/><Notice tone="problem">The file does not resolve in the selected snapshot, or the read failed.</Notice></>}</StudioShell></>;
}
