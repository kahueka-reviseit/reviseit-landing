/** Read models for the Studio library. Publication and bank acceptance are separate facts. */
export type LibraryModule = {id:string;name:string;currentRelease:string;acceptedSnapshotId:string|null};
export type BankSnapshot = {id:string;moduleId:string;manifestSha256:string;purpose:string;origin:string;accepted:boolean;createdAt:string;fileCount:number;adapter:string};
export type BankRecord = {kind:string;id:string;parentId:string;path:string;sha256:string;status:string};
export type BankFile = {path:string;sha256:string;size:number;mediaType:string;integrity:string};
export type LibraryItem = {moduleId:string;release:string;entryId:string;title:string;topic:string;marksMin:number;marksMax:number;enabled:boolean;supported:boolean;orderable:boolean};
export type LibraryData = {modules:LibraryModule[];snapshots:BankSnapshot[];selectedSnapshotId:string|null;items:LibraryItem[];records:BankRecord[];files:BankFile[]};
export type FormField = {id:string;label:string;hint:string;type:'choice'|'text';choices?:Array<{id:string;label:string}>;required:boolean;allowAutomatic:boolean;allowOther?:boolean;maxLength?:number};
export type CatalogueItem = LibraryItem & {currentRelease:string;description:string;preview:unknown;thumbnailPng:string|null;thumbnailAlt:string|null;form:null|{revision:string;fields:FormField[];explicitlyNoInput:boolean;shared:Record<string,{revision:string;fields:FormField[]}>};manifestSha256:string|null;workflowSha256:string|null;bundleSha256:string|null;sources:Array<{role:string;path:string;sha256:string}>};
export type FileDetail = BankFile & {moduleId:string;snapshotId:string;purpose:string;accepted:boolean;manifestSha256:string;blobId:string;records:BankRecord[]};
export type ReleaseRecord = {moduleId:string;release:string;current:boolean;publishedAt:string|null;importedAt:string|null;previousRelease:string|null;contentDigest:string|null;entries:number;enabled:number;supported:number;ready:number;forms:number;executions:number};
export type ReleasesData = {modules:LibraryModule[];releases:ReleaseRecord[]};
export const itemUrl=(i:Pick<LibraryItem,'moduleId'|'release'|'entryId'>)=>`/admin/studio/library/items/${encodeURIComponent(i.entryId)}?module=${encodeURIComponent(i.moduleId)}&release=${encodeURIComponent(i.release)}`;
export const fileUrl=(snapshot:string,path:string)=>`/admin/studio/library/files/${snapshot}?path=${encodeURIComponent(path)}`;
export const recordLabel=(r:Pick<BankRecord,'id'|'parentId'>)=>r.parentId?`${r.parentId} · ${r.id}`:r.id;
export const snapshotLabel=(s:BankSnapshot)=>`${s.accepted?'Accepted bank':s.purpose==='rehearsal'?'Rehearsal copy':'Historical bank copy'} · ${s.createdAt.slice(0,10)} · ${s.manifestSha256.slice(0,10)}`;
export const marksLabel=(min:number,max:number)=>`${min===max?min:`${min}–${max}`} marks`;
/** App Router and proxy layers can supply an encoded path segment. Accept only catalogue IDs. */
export function catalogueEntryId(segment:string):string {
 const id=decodeURIComponent(segment);
 if(!/^(structured|mcq):[A-Z0-9_-]+$/.test(id))throw new Error('Invalid catalogue identifier');
 return id;
}
