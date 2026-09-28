import type { CatalogueEntry, QuestionContext } from './contracts';
export function thumbnailFor(moduleId:string,release:string,entryId:string,alt:unknown):CatalogueEntry['thumbnail'] {
  if(typeof alt!=='string' || !alt.trim()) return undefined;
  const query=new URLSearchParams({curriculum:moduleId,release,entry:entryId});
  return {src:`/api/teacher/catalogue/thumbnail?${query}`,alt};
}
/**
 * Safe per-entry reminders for a paid order. Only the public topic, description and
 * authenticated preview link leave the server; the preview is pinned to the order's
 * release, so a later publication cannot change what a purchased question shows.
 */
export function questionContexts(moduleId:string,release:string,rows:unknown):Record<string,QuestionContext> {
  const out:Record<string,QuestionContext>={};
  for(const r of Array.isArray(rows)?rows:[]) {
    if(!r || typeof r!=='object' || typeof r.entry_id!=='string') continue;
    const text=(x:unknown)=>typeof x==='string'?x.trim():'';
    const thumbnail=thumbnailFor(moduleId,release,r.entry_id,r.thumbnail_alt);
    out[r.entry_id]={topic:text(r.topic),description:text(r.description),...(thumbnail?{thumbnail}:{})};
  }
  return out;
}
export function searchTerms(value:string):string[] {
  return value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function formatMarks(marks:CatalogueEntry['marks']):string {
  return marks.min===marks.max ? String(marks.min) : `${marks.min}–${marks.max}`;
}
export function totalMarks(entries:CatalogueEntry[]):CatalogueEntry['marks'] {
  return entries.reduce((total,entry)=>({min:total.min+entry.marks.min,max:total.max+entry.marks.max}),{min:0,max:0});
}
