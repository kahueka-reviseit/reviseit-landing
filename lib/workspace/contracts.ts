export type Formatting = { font: 'Arial' | 'Times New Roman'; fontSize: 11 | 12; spacing: 'normal' | 'relaxed'; header: string; answerLines: boolean };
export const defaultFormatting: Formatting = { font:'Arial', fontSize:12, spacing:'normal', header:'', answerLines:true };
export type CatalogueEntry = { id:string; title:string; topic:string; description:string; marks:{min:number;max:number}; thumbnail?:{src:string; alt:string}; preview?:CataloguePreview };
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

export const bloomCategories = ['Remember','Understand','Apply','Analyse','Evaluate','Create'] as const;
export type BloomCategory = typeof bloomCategories[number];
export type CataloguePreview = {
  subquestions:{min:number;max:number};
  outline?:{summary:string;bloom:BloomCategory;marks?:{min:number;max:number}}[];
};
function exactKeys(value:unknown,required:string[],optional:string[]=[]):value is Record<string,unknown> {
  return !!value && typeof value==='object' && !Array.isArray(value) &&
    required.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>required.includes(k)||optional.includes(k));
}
function validRange(value:unknown,limit:number):boolean {
  return exactKeys(value,['min','max']) && Number.isSafeInteger(value.min) && Number.isSafeInteger(value.max) &&
    Number(value.min)>=1 && Number(value.max)>=Number(value.min) && Number(value.max)<=limit;
}
// A closed shape prevents private metadata in nested JSON from reaching the browser.
// Invalid/missing preview data is unavailable, never inferred from curriculum bands.
export function cataloguePreview(value:unknown):CataloguePreview|undefined {
  if(!exactKeys(value,['subquestions'],['outline']) || !validRange(value.subquestions,30)) return undefined;
  if(Object.hasOwn(value,'outline')) {
    const outline=value.outline,range=value.subquestions as {min:number;max:number};
    if(!Array.isArray(outline) || outline.length<range.min || outline.length>range.max || !outline.every(row=>
      exactKeys(row,['summary','bloom'],['marks']) && typeof row.summary==='string' && row.summary.trim().length>0 && row.summary.length<=160 &&
      bloomCategories.includes(row.bloom as BloomCategory) && (!Object.hasOwn(row,'marks')||validRange(row.marks,100)))) return undefined;
  }
  return value as CataloguePreview;
}
