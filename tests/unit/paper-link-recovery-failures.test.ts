import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as engineModule from '../../scripts/paper/engine.mjs';
import { paperDouble } from './paper-double';

/**
 * C15B: recovery is held to the same standard as applying. A failed read is never taken as
 * absence, every recovery write is journalled, and a retry after any failure neither
 * duplicates nor discards work, and never closes the journal early.
 */
const { applyPlan, emptyLock, isClean, openJournals, restoreJournal, survey, toPlan } = engineModule as any;

const card=(title:string)=>`<div layer-name="card" style="gap:16px;padding:24px">`+
  `<div layer-name="card__label" style="font-size:12px">ABOUT</div><div layer-name="card__title" style="font-size:18px">${title}</div>`+
  `<div layer-name="card__aside" style="padding:4px"><div layer-name="card__note" style="font-size:13px">Fixed note</div></div></div>`;
const artboard=(inner:string)=>`<div layer-name="Board" style="display:flex">${inner}</div>`;

let paper:ReturnType<typeof paperDouble>,registry:any,lock:any,dir:string,original:any;
const node=(file:string,name:string,nth=0)=>paper.node(file,name,nth);
const plan=async(options={})=>toPlan(await survey(paper,registry,lock,{scan:false,...options}),registry);
const apply=async(options:any={})=>applyPlan(paper,registry,lock,await plan(options),{journalDir:dir,...options});
const status=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8')).meta.status;
const restore=async(file:string)=>{const journal=JSON.parse(fs.readFileSync(file,'utf8'));
  return restoreJournal(paper,registry,lock,journal,{save:(j:any)=>fs.writeFileSync(file,JSON.stringify(j))});};
/** Fails the first matching call: before it does anything, or after doing it (the reply is lost). */
function fail(tool:string,{applied=false,when=(_a:any):boolean=>true}:{applied?:boolean;when?:(a:any)=>boolean}={}){
  let done=false;
  paper.json=async(t:string,a:any)=>{
    if(!done&&t===tool&&when(a)){done=true;if(applied)await original(t,a);throw new Error(`simulated connection loss on ${tool}`);}
    return original(t,a);
  };
}
const heal=()=>{paper.json=original;};
const writes=(from:number)=>paper.calls.slice(from).filter(c=>!c.tool.startsWith('get_')).map(c=>c.tool);

beforeEach(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'c15b-journal-'));
  paper=paperDouble();original=paper.json;
  paper.addFile('ds','Design System',{masters:[artboard(card('Master title'))]},[{name:'--ink',type:'color',value:'#2D2D2D'}]);
  paper.addFile('web','Website',{screens:[artboard(card('Projectile motion'))]},[{name:'--ink',type:'color',value:'#2D2D2D'}]);
  registry={files:{ds:{id:'ds',pages:{masters:{status:'active'}}},web:{id:'web',pages:{screens:{status:'active'}}}},
    tokens:{owner:'ds',mirrors:['web'],legacyAliases:{}},
    masters:{card:{file:'ds',node:node('ds','card').id,block:'card',slots:['card__title'],instances:[{file:'web',node:node('web','card').id}]}}};
  lock=emptyLock();
  await applyPlan(paper,registry,lock,await plan(),{adopt:['all']});
});
afterEach(()=>{heal();fs.rmSync(dir,{recursive:true,force:true});});

describe('the coordinator probes',()=>{
  it('does not treat an unreadable inserted layer as absent, and finishes once it can read it',async()=>{
    await paper.json('write_html',{fileId:'ds',targetNodeId:node('ds','card').id,mode:'insert-children',html:'<div layer-name="card__hint" style="font-size:13px">Hint</div>'});
    const report=await apply();const inserted=node('web','card__hint').id;
    fail('get_node_info',{when:a=>a.nodeId===inserted});
    const first=await restore(report.journal);heal();
    expect(first.outcomes).toEqual([expect.objectContaining({op:'insert',outcome:'uncertain',detail:expect.stringMatching(/could not read/)})]);
    expect(node('web','card__hint')).toBeDefined();
    expect(status(report.journal)).toBe('recovery-incomplete');
    expect(openJournals(dir)).toEqual([report.journal]);
    const second=await restore(report.journal);
    expect(second.outcomes.map((o:any)=>o.outcome)).toEqual(['reverted']);
    expect(node('web','card__hint')).toBeUndefined();
    expect(status(report.journal)).toBe('recovered');
  });

  it('does not recreate a removed layer twice when the recreation reply was lost',async()=>{
    await paper.json('delete_nodes',{fileId:'ds',nodeIds:[node('ds','card__aside').id]});
    const report=await apply();
    fail('write_html',{applied:true});
    const first=await restore(report.journal);heal();
    expect(first.outcomes).toEqual([expect.objectContaining({op:'remove',outcome:'uncertain'})]);
    expect(status(report.journal)).toBe('recovery-incomplete');
    const second=await restore(report.journal);
    expect(second.outcomes.map((o:any)=>o.outcome)).toEqual(['reverted']);
    expect(node('web','card').children.map(c=>c.name)).toEqual(['card__label','card__title','card__aside']);
    expect(node('web','card__note').text).toBe('Fixed note');
    expect(status(report.journal)).toBe('recovered');
  });
});

describe('failures inside recovery',()=>{
  const changeMaster=()=>{paper.edit('ds','card',{gap:'24px'});node('ds','card__label').text='CONTEXT';};

  it('stops at a failed read before any write, and leaves Paper unchanged',async()=>{
    changeMaster();const report=await apply();const from=paper.calls.length;
    fail('get_node_info');
    const first=await restore(report.journal);heal();
    expect(first.outcomes.map((o:any)=>o.outcome)).toEqual(['uncertain']);
    expect(writes(from)).toEqual([]);
    expect([node('web','card').styles.gap,node('web','card__label').text]).toEqual(['24px','CONTEXT']);
    expect(first.restored).toEqual([]);
    expect((await restore(report.journal)).outcomes.map((o:any)=>o.outcome)).toEqual(['reverted','reverted']);
  });

  it('retries a recovery write that never landed',async()=>{
    changeMaster();const report=await apply();
    fail('set_text_content');
    expect((await restore(report.journal)).outcomes.map((o:any)=>o.outcome)).toEqual(['uncertain']);heal();
    const op=JSON.parse(fs.readFileSync(report.journal,'utf8')).instances[0].ops[1];
    expect(op.undo.restore.status).toBe('uncertain');
    expect(node('web','card__label').text).toBe('CONTEXT');
    expect((await restore(report.journal)).outcomes.map((o:any)=>o.outcome)).toEqual(['reverted','reverted']);
    expect(node('web','card__label').text).toBe('ABOUT');
  });

  it('recognises a recovery write that landed with its reply lost, without writing again',async()=>{
    changeMaster();const report=await apply();
    fail('set_text_content',{applied:true});
    await restore(report.journal);heal();
    expect(node('web','card__label').text).toBe('ABOUT');
    const from=paper.calls.length,second=await restore(report.journal);
    expect(second.outcomes.map((o:any)=>o.outcome)).toEqual(['reverted','reverted']);
    expect(writes(from)).toEqual(['update_styles']);// only the style, never the text again
  });

  it('places a recreated layer on retry when placement failed after recreation',async()=>{
    paper.node('ds','card').children.reverse();// master order: aside, title, label
    await paper.json('delete_nodes',{fileId:'ds',nodeIds:[node('ds','card__label').id]});
    node('web','card__label').text='ABOUT';
    await paper.json('delete_nodes',{fileId:'ds',nodeIds:[node('ds','card__aside').id]});
    const report=await apply();
    expect(node('web','card').children.map(c=>c.name)).toEqual(['card__title']);
    fail('move_nodes');
    const first=await restore(report.journal);heal();
    expect(first.outcomes.some((o:any)=>o.outcome==='uncertain')).toBe(true);
    await restore(report.journal);
    expect(node('web','card').children.map(c=>c.name)).toEqual(['card__label','card__title','card__aside']);
    expect(node('web','card').children.filter(c=>c.name==='card__aside')).toHaveLength(1);
    expect(status(report.journal)).toBe('recovered');
  });

  it('never overwrites an edit made between a failed recovery and its retry',async()=>{
    changeMaster();const report=await apply();
    fail('get_node_info');await restore(report.journal);heal();
    paper.edit('web','card',{gap:'30px'});
    const second=await restore(report.journal);
    expect(second.conflicts).toEqual([expect.objectContaining({key:'@root',detail:expect.stringMatching(/gap is 30px/)})]);
    expect(node('web','card').styles.gap).toBe('30px');
    expect(status(report.journal)).toBe('recovery-incomplete');
  });

  it('handles token recovery the same way: failed read, then a write whose reply was lost',async()=>{
    paper.tokens('ds')[0].value='#111111';const report=await apply();
    fail('get_tokens');expect((await restore(report.journal)).outcomes.map((o:any)=>o.outcome)).toEqual(['uncertain']);heal();
    expect(paper.tokens('web')[0].value).toBe('#111111');
    fail('set_tokens',{applied:true});expect((await restore(report.journal)).outcomes.map((o:any)=>o.outcome)).toEqual(['uncertain']);heal();
    expect(paper.tokens('web')[0].value).toBe('#2D2D2D');
    const from=paper.calls.length,third=await restore(report.journal);
    expect(third.outcomes.map((o:any)=>o.outcome)).toEqual(['reverted']);expect(writes(from)).toEqual([]);
    expect(status(report.journal)).toBe('recovered');
  });

  it('finishes a reordering whose reply was lost',async()=>{
    const [l,t,a]=node('ds','card').children;node('ds','card').children.splice(0,3,t,l,a);
    const report=await apply();
    expect(node('web','card').children.map(c=>c.name)).toEqual(['card__title','card__label','card__aside']);
    fail('move_nodes',{applied:true});await restore(report.journal);heal();
    const second=await restore(report.journal);
    expect(second.outcomes.map((o:any)=>o.outcome)).toEqual(['reverted']);
    expect(node('web','card').children.map(c=>c.name)).toEqual(['card__label','card__title','card__aside']);
  });

  it('reports an unreadable registered instance as unreadable, not detached and not clean',async()=>{
    const instance=registry.masters.card.instances[0].node;
    fail('get_node_info',{when:a=>a.nodeId===instance});
    const result=await survey(paper,registry,lock,{scan:false});heal();
    expect(result.instances[0]).toMatchObject({status:'unreadable',drift:[expect.objectContaining({kind:'unreadable'})]});
    expect(isClean(result)).toBe(false);
  });
});
