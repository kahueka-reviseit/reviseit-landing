import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as engineModule from '../../scripts/paper/engine.mjs';
import { paperDouble } from './paper-double';

/**
 * C15A: an interrupted application can always be inspected and undone, and a layer the
 * master drops is never deleted from an instance while it holds work, unless reviewed.
 */
const { applyPlan, emptyLock, isClean, openJournals, restoreJournal, survey, toPlan } = engineModule as any;

const card=(title:string,{label='ABOUT',extra=''}={})=>`<div layer-name="card" style="gap:16px;padding:24px">`+
  `<div layer-name="card__label" style="font-size:12px">${label}</div><div layer-name="card__title" style="font-size:18px">${title}</div>`+
  `<div layer-name="card__aside" style="padding:4px"><div layer-name="card__note" style="font-size:13px">Fixed note</div></div>${extra}</div>`;
const artboard=(inner:string)=>`<div layer-name="Board" style="display:flex">${inner}</div>`;

let paper:ReturnType<typeof paperDouble>,registry:any,lock:any,dir:string,checkpoints:any[];
const node=(file:string,name:string,nth=0)=>paper.node(file,name,nth);
const plan=async(options={})=>toPlan(await survey(paper,registry,lock,{scan:false,...options}),registry);
const apply=async(options:any={})=>applyPlan(paper,registry,lock,await plan(options),{journalDir:dir,checkpoint:(l:any)=>checkpoints.push(structuredClone(l)),...options});
const journalOf=(report:any)=>JSON.parse(fs.readFileSync(report.journal,'utf8'));
const restore=async(file:string)=>{const journal=JSON.parse(fs.readFileSync(file,'utf8'));
  return restoreJournal(paper,registry,lock,journal,{save:(j:any)=>fs.writeFileSync(file,JSON.stringify(j))});};
/** Makes the nth call of one Paper tool fail: before it does anything, or after doing it (the reply is lost). */
function fail(tool:string,{nth=1,applied=false}={}){
  const original=paper.json;let seen=0;
  paper.json=async(t:string,a:any)=>{
    if(t===tool&&++seen===nth){if(applied)await original(t,a);throw new Error(`simulated connection loss on ${tool}`);}
    return original(t,a);
  };
  return ()=>{paper.json=original;};
}

beforeEach(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'c15a-journal-'));checkpoints=[];
  paper=paperDouble();
  paper.addFile('ds','Design System',{masters:[artboard(card('Master title'))]},[{name:'--ink',type:'color',value:'#2D2D2D'},{name:'--paper',type:'color',value:'#FFFFFF'}]);
  paper.addFile('web','Website',{screens:[artboard(card('Projectile motion')),artboard(card('Inclined plane'))]},[{name:'--ink',type:'color',value:'#2D2D2D'},{name:'--paper',type:'color',value:'#FFFFFF'}]);
  registry={files:{ds:{id:'ds',pages:{masters:{status:'active'}}},web:{id:'web',pages:{screens:{status:'active'}}}},
    tokens:{owner:'ds',mirrors:['web'],legacyAliases:{}},
    masters:{card:{file:'ds',node:node('ds','card').id,block:'card',slots:['card__title'],overridable:{card:['width']},
      instances:[{file:'web',node:node('web','card',0).id,where:'first'},{file:'web',node:node('web','card',1).id,where:'second'}]}}};
  lock=emptyLock();
  await applyPlan(paper,registry,lock,await plan(),{adopt:['all']});
});
afterEach(()=>fs.rmSync(dir,{recursive:true,force:true}));

describe('R1: an interrupted application leaves a recoverable record',()=>{
  const changeMaster=()=>{paper.edit('ds','card',{gap:'24px'});node('ds','card__label').text='CONTEXT';};

  it('records intent before the first write when that write fails without landing, and recovery finds nothing to undo',async()=>{
    changeMaster();const undo=fail('update_styles');const report=await apply();undo();
    expect(report.interrupted).toMatchObject({uncertain:[{op:'style',key:'@root'}]});
    const journal=journalOf(report);
    expect(journal.meta.status).toBe('interrupted');
    expect(journal.instances[0].before.styles.gap).toBe('16px');
    expect(journal.instances[0].ops.map((o:any)=>o.status)).toEqual(['uncertain','pending']);
    expect(node('web','card',0).styles.gap).toBe('16px');
    const recovery=await restore(report.journal);
    expect(recovery.outcomes.map((o:any)=>o.outcome)).toEqual(['never-sent','not-applied']);
    expect(node('web','card',0).styles.gap).toBe('16px');
    expect(openJournals(dir)).toEqual([]);
  });

  it('undoes an acknowledged write when a later write fails, and does it only once',async()=>{
    changeMaster();const undo=fail('set_text_content');const report=await apply();undo();
    expect(node('web','card',0).styles.gap).toBe('24px');
    expect(journalOf(report).instances[0].ops.map((o:any)=>o.status)).toEqual(['acknowledged','uncertain']);
    expect(openJournals(dir)).toEqual([report.journal]);
    const recovery=await restore(report.journal);
    expect(recovery.outcomes.map((o:any)=>o.outcome)).toEqual(['not-applied','reverted']);
    expect(node('web','card',0).styles.gap).toBe('16px');
    const again=await restore(report.journal);
    expect(again.outcomes).toEqual([{item:expect.any(String),op:'text',key:'@root/card__label',outcome:'not-applied'}]);
    expect(isClean(await survey(paper,registry,lock,{scan:false}))).toBe(false);// the master change is still waiting, as it should
  });

  it('treats a write whose reply was lost as uncertain and undoes it after seeing that it landed',async()=>{
    changeMaster();const undo=fail('set_text_content',{applied:true});const report=await apply();undo();
    expect(node('web','card__label',0).text).toBe('CONTEXT');
    expect(journalOf(report).instances[0].ops[1].status).toBe('uncertain');
    const recovery=await restore(report.journal);
    expect(recovery.outcomes.map((o:any)=>o.outcome)).toEqual(['reverted','reverted']);
    expect([node('web','card',0).styles.gap,node('web','card__label',0).text]).toEqual(['16px','ABOUT']);
  });

  it('checkpoints the lock for items that finished and leaves it untouched for the one that did not',async()=>{
    changeMaster();const before=structuredClone(lock.instances);
    const undo=fail('update_styles',{nth:2});const report=await apply();undo();
    expect(report.applied.map((a:any)=>a.id)).toEqual([registry.masters.card.instances[0].node].map(n=>`web:${n}`));
    const saved=checkpoints.at(-1);
    const [first,second]=registry.masters.card.instances.map((i:any)=>`web:${i.node}`);
    expect(saved.instances[first].state).not.toEqual(before[first].state);
    expect(saved.instances[second]).toEqual(before[second]);
    const recovery=await restore(report.journal);
    expect(recovery.restored).toEqual([first,second]);
    expect(lock.instances[first]).toEqual(before[first]);
    expect(node('web','card',0).styles.gap).toBe('16px');
  });

  it('never overwrites an edit made after the interruption',async()=>{
    changeMaster();const undo=fail('set_text_content');const report=await apply();undo();
    paper.edit('web','card',{gap:'30px'},0);
    const recovery=await restore(report.journal);
    expect(recovery.conflicts).toEqual([expect.objectContaining({key:'@root',detail:expect.stringMatching(/gap is 30px/)})]);
    expect(node('web','card',0).styles.gap).toBe('30px');
    expect(JSON.parse(fs.readFileSync(report.journal,'utf8')).meta.status).toBe('recovery-incomplete');
    expect(openJournals(dir)).toEqual([report.journal]);
  });

  it('recovers token writes: one acknowledged, one whose reply was lost',async()=>{
    paper.tokens('ds').find(t=>t.name==='--ink')!.value='#111111';paper.tokens('ds').find(t=>t.name==='--paper')!.value='#FAFAFA';
    const undo=fail('set_tokens',{nth:2,applied:true});const report=await apply();undo();
    expect(paper.tokens('web').map(t=>t.value)).toEqual(['#111111','#FAFAFA']);
    expect(journalOf(report).tokens[0].ops.map((o:any)=>o.status)).toEqual(['acknowledged','uncertain']);
    const recovery=await restore(report.journal);
    expect(recovery.outcomes.map((o:any)=>o.outcome)).toEqual(['reverted','reverted']);
    expect(paper.tokens('web').map(t=>t.value)).toEqual(['#2D2D2D','#FFFFFF']);
  });

  it('recovers a structural insert whose reply was lost, finding the new layer by name',async()=>{
    await paper.json('write_html',{fileId:'ds',targetNodeId:node('ds','card').id,mode:'insert-children',html:'<div layer-name="card__hint" style="font-size:13px">Hint</div>'});
    const undo=fail('write_html',{applied:true});const report=await apply();undo();
    expect(node('web','card__hint',0)).toBeDefined();
    const op=journalOf(report).instances[0].ops.find((o:any)=>o.op==='insert');
    expect(op).toMatchObject({status:'uncertain'});expect(op.created).toBeUndefined();
    const recovery=await restore(report.journal);
    expect(recovery.outcomes.map((o:any)=>o.outcome)).toEqual(['reverted']);
    expect(node('web','card__hint',0)).toBeUndefined();
  });

  it('recovers a reviewed removal by recreating the layer in its place',async()=>{
    await paper.json('delete_nodes',{fileId:'ds',nodeIds:[node('ds','card__aside').id]});
    const undo=fail('delete_nodes',{nth:2});const report=await apply();undo();
    expect(paper.node('web','card',0).children.map(c=>c.name)).toEqual(['card__label','card__title']);
    const recovery=await restore(report.journal);
    expect(recovery.outcomes.map((o:any)=>o.outcome)).toEqual(['reverted','not-applied']);
    expect(paper.node('web','card',0).children.map(c=>c.name)).toEqual(['card__label','card__title','card__aside']);
    expect(node('web','card__note',0).text).toBe('Fixed note');
  });
});

describe('R2: a layer the master drops is protected while it holds work',()=>{
  const dropFromMaster=async(name:string)=>paper.json('delete_nodes',{fileId:'ds',nodeIds:[node('ds',name).id]});
  const driftOf=async()=>(await survey(paper,registry,lock,{scan:false})).instances.flatMap((i:any)=>i.drift);

  it('removes an unchanged decorative layer from every instance',async()=>{
    await dropFromMaster('card__aside');
    expect(await driftOf()).toEqual([]);
    const report=await apply();
    expect(report.applied).toHaveLength(2);expect(node('web','card__aside',0)).toBeUndefined();
  });

  it('refuses when the dropped layer\'s own text was edited (the review\'s reproduction)',async()=>{
    node('web','card__label',0).text='NEW MANUAL WORK';await dropFromMaster('card__label');
    expect(await driftOf()).toEqual([expect.objectContaining({kind:'removal-would-lose-work',key:'@root/card__label'})]);
    const report=await apply();
    expect(report.refused).toEqual([expect.objectContaining({reason:'drift'})]);
    expect(node('web','card__label',0).text).toBe('NEW MANUAL WORK');
    expect(node('web','card__label',1)).toBeUndefined();// the untouched instance follows the master
  });

  it('refuses when a descendant of the dropped layer was edited or added',async()=>{
    node('web','card__note',0).styles.fontSize='15px';
    await paper.json('write_html',{fileId:'web',targetNodeId:node('web','card__aside',1).id,mode:'insert-children',html:'<div layer-name="card__extra" style="font-size:12px">Mine</div>'});
    await dropFromMaster('card__aside');
    const drift=await driftOf();
    expect(drift.map((d:any)=>d.risks.map((r:any)=>`${r.key} ${r.reason}`))).toEqual([
      ['@root/card__aside/card__note was edited after the last synchronisation'],
      ['@root/card__aside/card__extra was added after the last synchronisation']]);
    await apply();
    expect(node('web','card__note',0).styles.fontSize).toBe('15px');expect(node('web','card__extra',0).text).toBe('Mine');
  });

  it('refuses a slot-bearing layer even when unchanged, because its text belongs to the instance',async()=>{
    await dropFromMaster('card__title');
    const drift=await driftOf();
    expect(drift).toHaveLength(2);
    expect(drift[0].risks).toEqual([{key:'@root/card__title',reason:'holds text owned by this instance',text:'Projectile motion'}]);
    await apply();expect(node('web','card__title',0).text).toBe('Projectile motion');
  });

  it('treats a rename as a removal: the old layer is protected and the plan says it may have been renamed',async()=>{
    const title=node('ds','card__title');title.name='card__heading';
    const drift=await driftOf();
    expect(drift[0].detail).toMatch(/may have been renamed to "card__heading"/);
    const report=await apply();
    expect(report.refused).toHaveLength(2);
    expect(paper.node('web','card',0).children.map(c=>c.name)).toEqual(['card__label','card__title','card__aside']);
  });

  it('removes protected work only when that removal is explicitly reviewed, and keeps it in the journal',async()=>{
    node('web','card__label',0).text='NEW MANUAL WORK';await dropFromMaster('card__label');
    const first=`web:${registry.masters.card.instances[0].node}`;
    const report=await apply({acceptRemoval:[first]});
    expect(report.refused).toEqual([]);expect(report.applied).toHaveLength(2);
    const op=journalOf(report).instances[0].ops[0];
    expect(op).toMatchObject({op:'remove',reviewed:true,losing:[{key:'@root/card__label',reason:'was edited after the last synchronisation'}]});
    await restore(report.journal);
    expect(node('web','card__label',0).text).toBe('NEW MANUAL WORK');
  });

  it('keeps the stale-plan refusal for removals',async()=>{
    await dropFromMaster('card__aside');const preview=await plan();
    node('web','card__note',0).text='Edited after the preview';
    const report=await applyPlan(paper,registry,lock,preview,{journalDir:dir});
    expect(report.refused).toEqual([expect.objectContaining({reason:'stale-plan'})]);
    expect(node('web','card__note',0).text).toBe('Edited after the preview');
  });
});
