import type { CatalogueEntry } from './contracts';
export function thumbnailFor(moduleId:string,release:string,entryId:string,alt:unknown):CatalogueEntry['thumbnail'] {
  if(typeof alt!=='string' || !alt.trim()) return undefined;
  const query=new URLSearchParams({curriculum:moduleId,release,entry:entryId});
  return {src:`/api/teacher/catalogue/thumbnail?${query}`,alt};
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
