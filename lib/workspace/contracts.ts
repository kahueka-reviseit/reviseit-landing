export type Formatting = { font: 'Arial' | 'Times New Roman'; fontSize: 11 | 12; spacing: 'normal' | 'relaxed'; header: string; answerLines: boolean };
export const defaultFormatting: Formatting = { font:'Arial', fontSize:12, spacing:'normal', header:'', answerLines:true };
export type CatalogueEntry = { id:string; title:string; topic:string; description:string; marks:{min:number;max:number}; thumbnail?:{src:string; alt:string} };
export type Curriculum = { id:string; name:string; release:string; isDemo:boolean };
export type Workspace = {
  schoolName:string; curricula:Curriculum[]; module:Curriculum | null; entries:CatalogueEntry[];
  formatting:{revision:number; preferences:Formatting};
  selection:{revision:number; release:string; entryIds:string[]};
};
export function isFormatting(value: unknown): value is Formatting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string,unknown>;
  return Object.keys(v).length === 5 && ['font','fontSize','spacing','header','answerLines'].every(k => Object.hasOwn(v,k)) &&
    typeof v.font==='string' && ['Arial','Times New Roman'].includes(v.font) && [11,12].includes(v.fontSize as number) &&
    typeof v.spacing==='string' && ['normal','relaxed'].includes(v.spacing) && typeof v.header === 'string' && v.header.length <= 160 && typeof v.answerLines === 'boolean';
}
export type WorkspaceWrite = { kind:'formatting'; moduleId:string; revision:number; preferences:Formatting } |
  { kind:'selection'; moduleId:string; revision:number; release:string; entryIds:string[] };
export function isWorkspaceWrite(value: unknown): value is WorkspaceWrite {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v=value as Record<string,unknown>;
  if (typeof v.moduleId !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.moduleId) || v.moduleId.length>120 || !Number.isSafeInteger(v.revision) || Number(v.revision)<0) return false;
  if (v.kind==='formatting') return isFormatting(v.preferences);
  return v.kind==='selection' && typeof v.release==='string' && v.release.length>0 && v.release.length<100 &&
    Array.isArray(v.entryIds) && v.entryIds.length<=30 && new Set(v.entryIds).size===v.entryIds.length && v.entryIds.every(x=>typeof x==='string' && x.length>0 && x.length<=120);
}

export type CatalogueMatch = { module:Curriculum; entry:CatalogueEntry };
export type CatalogueSearch = { matches:CatalogueMatch[]; hasMore:boolean };
