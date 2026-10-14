import type {FileDetail} from './library';

export const DRAFT_MAX_BYTES=262144;
export type DraftRevision={revision:number;blobId:string;sha256:string;size:number;integrity:string;reason:string;restoredFrom:number|null;createdBy:string;createdAt:string};
export type MaintenanceDraft={id:string;file:FileDetail;revision:number;state:'draft'|'discarded';createdBy:string;createdAt:string;updatedAt:string;discardedBy:string|null;discardedReason:string|null;revisions:DraftRevision[]};
export type DraftSummary={id:string;moduleId:string;snapshotId:string;path:string;purpose:string;revision:number;state:'draft'|'discarded';updatedAt:string};
export type SaveDraftInput={draftId:string|null;snapshotId:string;path:string;expectedRevision:number;expectedSha256:string;text:string;reason:string;restoredFrom:number|null;command:string};
export const draftUrl=(id:string)=>`/admin/studio/library/drafts/${id}`;
export const newDraftUrl=(f:FileDetail)=>`${draftUrl('new')}?snapshot=${f.snapshotId}&path=${encodeURIComponent(f.path)}`;
export const canDraftFile=(f:FileDetail)=>f.integrity==='verified'&&f.size<=DRAFT_MAX_BYTES&&/^data\/(?!archive(?:\/|$))[A-Za-z0-9_][A-Za-z0-9_./-]*\.(md|json)$/.test(f.path);
/** Byte-format checks only. Never label these as subject, skill or generation validation. */
export function draftTextProblem(path:string,text:string):string|null {
 if(!text.trim())return 'Enter some source text.';
 if(new TextEncoder().encode(text).length>DRAFT_MAX_BYTES)return 'The draft exceeds the 256 KB editing limit.';
 if(text.includes('\0')||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text))return 'The text contains an invalid character.';
 if(path.endsWith('.json'))try{JSON.parse(text);}catch{return 'The JSON is not valid. Correct its syntax before saving.';}
 return null;
}
/** Bounded, linear-time comparison: the complete changed span, including unchanged lines inside it. */
export function changedSpan(before:string,after:string) {
 const a=before.split('\n'),b=after.split('\n');let start=0,end=0;
 while(start<a.length&&start<b.length&&a[start]===b[start])start++;
 while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
 return {startLine:start+1,before:a.slice(start,a.length-end).join('\n'),after:b.slice(start,b.length-end).join('\n'),changed:before!==after};
}
