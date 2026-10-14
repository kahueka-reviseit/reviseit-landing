import {call,sha256,StudioError,type Rpc} from './contracts';
import {parseAuthoredForm,formEditProblem,canonicalFormJson,changedFormFields,type FormSaveInput} from './form-authoring';
import {readDraftText,saveMaintenanceDraft} from './maintenance-save';
import type {StudioStorage} from './storage/types';
import type {FileDetail} from './library';
import type {MaintenanceDraft} from './maintenance-drafts';

export async function saveFormDraft(rpc:Rpc,verifiedRpc:Rpc,storage:StudioStorage,input:FormSaveInput) {
 const file=await call<FileDetail>(rpc,'studio_bank_file_view',{p_snapshot:input.snapshotId,p_path:input.path});
 let blob=file.blobId,digest=file.sha256;
 if(input.draftId) {
  const draft=await call<MaintenanceDraft>(rpc,'studio_maintenance_draft_view',{p_draft:input.draftId});
  const revision=draft.revisions.find(r=>r.revision===input.expectedRevision);
  if(draft.file.snapshotId!==file.snapshotId||draft.file.path!==file.path||!revision)throw new StudioError('The form draft does not match this source file.');
  blob=revision.blobId;digest=revision.sha256;
 }
 if(digest!==input.expectedSha256)throw new StudioError('The form revision changed. Reload before editing.');
 const original=parseAuthoredForm(file,await readDraftText(rpc,storage,blob,digest));
 if(!original)throw new StudioError('This file is not a supported authored item form.');
 if(original.form_revision!==sha256(canonicalFormJson({fields:original.fields,identity:original.identity})))throw new StudioError('The stored form fingerprint does not match its fields. Repair that source record before editing it here.');
 const problem=formEditProblem(original,input.fields);if(problem)throw new StudioError(problem);
 if(typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>2000)throw new StudioError('Enter a reason of 10 to 2000 characters.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)||!Number.isFinite(Date.parse(input.asOf))||new Date(input.asOf).toISOString().slice(0,10)!==input.asOf||input.asOf>new Date().toISOString().slice(0,10)
  ||(typeof original.meta.last_updated==='string'&&input.asOf<original.meta.last_updated))throw new StudioError('The form edit date is invalid. Refresh the editor.');
 const changed=changedFormFields(original,input.fields);if(!changed.length)throw new StudioError('The form fields are unchanged.');
 const next=structuredClone(original);next.fields=structuredClone(input.fields);next.meta.last_updated=input.asOf;
 for(const id of changed)next.field_provenance[id].changes=[...(next.field_provenance[id].changes as unknown[]),`Studio private revision (${input.asOf}): ${input.reason.trim()}`];
 next.form_revision=sha256(canonicalFormJson({fields:next.fields,identity:next.identity}));
 // Evidence, source bindings, exclusions, status and unresolved findings are retained verbatim.
 return saveMaintenanceDraft(rpc,verifiedRpc,storage,{...input,text:JSON.stringify(next,null,2)+'\n',restoredFrom:null});
}
