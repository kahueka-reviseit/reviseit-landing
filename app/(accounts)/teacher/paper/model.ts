import type { CatalogueEntry, Workspace } from '../../../../lib/workspace/contracts';
import type { Filters, Kind } from '../../../../lib/workspace/paper';

export type View = 'home'|'shape'|'catalogue'|'question'|'builder'|'builder-question'|'builder-mcq'|'review'|'formatting';
export type Occurrence = {entry:CatalogueEntry; index:number; repeat:number; number:string; kind:Kind};
export type SectionKey = 'multiple_choice'|'structured';

/** Everything a paper screen may read or change. Built once per render by WorkspaceView. */
export type PaperModel = {
  data:Workspace; ids:string[]; byId:Map<string,CatalogueEntry>; occurrences:Occurrence[];
  configured:boolean; busy:boolean; price:string;
  allocation:Record<string,number>; inRange:(e:CatalogueEntry)=>boolean; setMark:(id:string,value:number)=>void;
  paperTarget:number|null; setPaperTarget:(v:number|null)=>void;
  sectionTargets:Partial<Record<SectionKey,number>>; setSectionTarget:(k:SectionKey,v:number|undefined)=>void;
  allocatedTotal:number; sectionTotal:(k:SectionKey)=>number; marksSet:boolean; balanced:boolean;
  limits:{questions:number; structured:number; multipleChoice:number}; mcqCount:number; structuredCount:number; withinPilotSize:boolean;
  selectionDirty:boolean; canPay:boolean; stale:boolean;
  toggle:(e:CatalogueEntry,checked:boolean)=>void; addAfter:(index:number)=>void; move:(index:number,by:number)=>void;
  remove:(index:number)=>void; swap:(index:number,id:string)=>void; arrange:(next:string[])=>void;
  go:(view:View,question?:string)=>void; save:()=>Promise<boolean>; checkout:()=>Promise<void>;
  filters:Filters; setFilters:(f:Filters)=>void;
};

/** Server numbering: multiple choice is question 1 (1.1, 1.2 …); structured questions follow in the teacher's order. */
export function occurrencesOf(ids:string[],byId:Map<string,CatalogueEntry>,kindOf:(e:{id:string})=>Kind):Occurrence[] {
  const list=ids.map((id,index)=>({id,index,entry:byId.get(id)})).filter((x):x is {id:string;index:number;entry:CatalogueEntry}=>!!x.entry);
  const mcq=list.filter(x=>kindOf(x.entry)==='multiple_choice'), structured=list.filter(x=>kindOf(x.entry)==='structured');
  const repeat=(x:{id:string;index:number})=>list.filter(y=>y.id===x.id&&y.index<x.index).length;
  return [...mcq.map((x,i)=>({entry:x.entry,index:x.index,repeat:repeat(x),number:`1.${i+1}`,kind:'multiple_choice' as Kind})),
    ...structured.map((x,i)=>({entry:x.entry,index:x.index,repeat:repeat(x),number:String((mcq.length?2:1)+i),kind:'structured' as Kind}))];
}
export const occurrenceName=(o:Occurrence)=>`${o.entry.title}${o.repeat?` occurrence ${o.repeat+1}`:''}`;
