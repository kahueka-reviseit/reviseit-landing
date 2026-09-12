import type { CatalogueEntry } from './contracts';
export function thumbnailFor(moduleId:string,release:string,entryId:string,alt:unknown):CatalogueEntry['thumbnail'] {
  if(typeof alt!=='string' || !alt.trim()) return undefined;
  const query=new URLSearchParams({curriculum:moduleId,release,entry:entryId});
  return {src:`/api/teacher/catalogue/thumbnail?${query}`,alt};
}
export function searchTerms(value:string):string[] {
  return value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
}
