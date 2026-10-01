import { beforeEach, describe, expect, it } from 'vitest';
import * as engineModule from '../../scripts/paper/engine.mjs';
import * as exportModule from '../../scripts/paper/export-code.mjs';
import * as treeModule from '../../scripts/paper/tree.mjs';
import { paperDouble } from './paper-double';

/**
 * The synchronisation mechanism itself, against an in-memory Paper. Paper has no native
 * master and instance link, so these are the guarantees the tooling has to provide:
 * one change reaches every registered instance, instance content survives, manual edits
 * and stale previews are refused, and a second run changes nothing.
 */
const row=(text:string)=>`<div layer-name="card__row" style="padding-block:8px"><div layer-name="card__row-text" style="font-size:14px">${text}</div></div>`;
const card=(title:string,rows:string[],extra='')=>`<div layer-name="card" style="display:flex;gap:16px;padding:24px;background-color:var(--color-surface)${extra}">`+
  `<div layer-name="card__label" style="font-size:12px">ABOUT THE QUESTION</div><div layer-name="card__title" style="font-size:18px;color:var(--color-text)">${title}</div>`+
  `<div layer-name="card__rows" style="display:flex">${rows.map(row).join('')}</div></div>`;
const artboard=(name:string,inner:string)=>`<div layer-name="${name}" style="display:flex">${inner}</div>`;
const tokens=[{name:'--color-surface',type:'color',value:'#FFFFFF'},{name:'--color-text',type:'color',value:'var(--ink)'},{name:'--ink',type:'color',value:'#2D2D2D'}];

// The tooling is plain JavaScript; the tests exercise it through untyped handles.
const { applyPlan, emptyLock, isClean, restoreJournal, summarise, survey, toPlan } = engineModule as any;
const { componentValues, inspectGenerated, resolveToken, withHeader } = exportModule as any;
const { readTree } = treeModule as any;

let paper:ReturnType<typeof paperDouble>,registry:any,lock:any;
const id=(file:string,name:string,nth=0)=>paper.node(file,name,nth).id;
const plan=async(options={})=>toPlan(await survey(paper,registry,lock,options),registry);
const sync=async(options:any={adopt:['all']})=>applyPlan(paper,registry,lock,await plan(),options);
const text=(file:string,name:string,nth=0)=>paper.node(file,name,nth).text;

beforeEach(async()=>{
  paper=paperDouble();
  paper.addFile('ds','Design System',{masters:[artboard('Masters',card('Master title',['Template row']))],reference:[artboard('Reference',card('Reference title',['One']))]},tokens);
  paper.addFile('web','Website',{screens:[artboard('Editor',card('Projectile motion',['Launch','Flight','Landing'],';width:480px')),artboard('Submitted',card('Projectile motion',['Launch','Flight']))],archive:[artboard('Old',card('Archived',[]))]},
    [...tokens.slice(0,2),{name:'--ink',type:'color',value:'#2D2D2D'},{name:'--legacy-ink',type:'color',value:'#2D2D2D'}]);
  registry={files:{ds:{id:'ds',pages:{masters:{status:'active'},reference:{status:'active'}}},web:{id:'web',pages:{screens:{status:'active'},archive:{status:'historical'}}}},
    tokens:{owner:'ds',mirrors:['web'],legacyAliases:{'--legacy-ink':'var(--ink)'}},
    masters:{card:{file:'ds',node:id('ds','card',0),block:'card',slots:['card__title','card__row-text'],overridable:{card:['width']},repeat:['card__row'],
      variants:{'read-only':{styles:{card:{backgroundColor:'var(--color-surface-muted)'}}}},
      instances:[{file:'ds',node:id('ds','card',1),where:'reference board'},{file:'web',node:id('web','card',0),where:'editor'},{file:'web',node:id('web','card',1),where:'submitted',variant:'read-only'}]}}};
  lock=emptyLock();
  await sync();
});

describe('one master, every registered instance',()=>{
  it('adopts the instances and then reports that nothing differs',async()=>{
    expect(isClean(await survey(paper,registry,lock))).toBe(true);
    expect(paper.node('web','card',1).styles.backgroundColor).toBe('var(--color-surface-muted)');
  });

  it('carries a style change to instances in both files without touching their content',async()=>{
    paper.edit('ds','card',{gap:'24px'});paper.edit('ds','card__row',{paddingBlock:'12px'});
    const preview=await plan();
    expect(preview.summary).toMatchObject({pending:3,drift:0});
    const report=await applyPlan(paper,registry,lock,preview);
    expect(report.applied).toHaveLength(3);expect(report.refused).toEqual([]);
    for(const [file,nth] of [['ds',1],['web',0],['web',1]] as const)expect(paper.node(file,'card',nth).styles.gap).toBe('24px');
    // Three repeated rows in the editor, two in the submitted copy: each follows the one template row.
    expect([0,1,2,3,4].map(n=>paper.node('web','card__row',n).styles.paddingBlock)).toEqual(Array(5).fill('12px'));
    // Content and declared overrides belong to the instance.
    expect([0,1,2].map(n=>text('web','card__row-text',n))).toEqual(['Launch','Flight','Landing']);
    expect(text('web','card__title',0)).toBe('Projectile motion');
    expect(paper.node('web','card',0).styles.width).toBe('480px');
    expect(paper.node('web','card',1).styles.backgroundColor).toBe('var(--color-surface-muted)');
  });

  it('adds a new master layer to every instance, in the master\'s position, and removes one the master drops',async()=>{
    const master=id('ds','card',0);
    await paper.json('write_html',{fileId:'ds',targetNodeId:master,mode:'insert-children',html:'<div layer-name="card__help" style="font-size:13px">Show writing hint</div>'});
    await paper.json('move_nodes',{fileId:'ds',moves:[{nodeId:id('ds','card__help',0),after:id('ds','card__title',0)}]});
    expect((await sync({})).applied).toHaveLength(3);
    for(const [file,nth] of [['ds',1],['web',0],['web',1]] as const)expect(paper.node(file,'card',nth).children.map(c=>c.name)).toEqual(['card__label','card__title','card__help','card__rows']);
    expect(text('web','card__help',0)).toBe('Show writing hint');
    await paper.json('delete_nodes',{fileId:'ds',nodeIds:[id('ds','card__help',0)]});
    await sync({});
    expect(paper.node('web','card',0).children.map(c=>c.name)).toEqual(['card__label','card__title','card__rows']);
    expect(isClean(await survey(paper,registry,lock))).toBe(true);
  });

  it('settles a layout style that Paper adds to a newly inserted layer',async()=>{
    paper.quirks.moveAddsWidth=true;
    await paper.json('write_html',{fileId:'ds',targetNodeId:id('ds','card',0),mode:'insert-children',html:'<div layer-name="card__marker" style="font-size:13px">Hint</div>'});
    paper.quirks.moveAddsWidth=false;await paper.json('move_nodes',{fileId:'ds',moves:[{nodeId:id('ds','card__marker',0),parentId:id('ds','card',0),index:0}]});paper.quirks.moveAddsWidth=true;
    const report=await sync({});
    expect(report.refused).toEqual([]);expect(report.applied).toHaveLength(3);
    expect(paper.node('web','card__marker',0).styles).toEqual({fontSize:'13px'});
    expect(isClean(await survey(paper,registry,lock))).toBe(true);
  });

  it('treats a childless Rectangle and Frame as the same box, but not a Text',async()=>{
    // A layer with no children: the master draws a Frame, this instance a Rectangle.
    for(const [file,nth] of [['ds',0],['ds',1],['web',0],['web',1]] as const)paper.node(file,'card__rows',nth).children=[];
    const plain=await survey(paper,registry,emptyLock());
    paper.node('web','card__rows',0).type='Rectangle' as any;
    const kinds=(await survey(paper,registry,emptyLock())).instances.flatMap((i:any)=>i.drift.map((d:any)=>d.kind));
    expect(plain.instances.flatMap((i:any)=>i.drift)).toEqual([]);
    expect(kinds).not.toContain('layer-type');
    paper.node('web','card__rows',0).type='Text' as any;
    expect((await survey(paper,registry,lock)).instances.flatMap((i:any)=>i.drift.map((d:any)=>d.kind))).toContain('layer-type');
  });

  it('lets a variant remove a master style with null',async()=>{
    registry.masters.card.variants.bare={styles:{card:{backgroundColor:null}}};
    registry.masters.card.instances[1].variant='bare';
    await sync({});
    expect(paper.node('web','card',0).styles.backgroundColor).toBeUndefined();
    expect(isClean(await survey(paper,registry,lock))).toBe(true);
  });

  it('changes nothing on a second run with no new input',async()=>{
    paper.edit('ds','card',{gap:'24px'});await sync({});
    const writes=paper.calls.length,again=await sync({});
    expect(again.applied).toEqual([]);expect(again.refused).toEqual([]);
    expect(paper.calls.slice(writes).filter(c=>/update_styles|set_text|write_html|delete_nodes|move_nodes|set_tokens|create_tokens/.test(c.tool))).toEqual([]);
  });

  it('keeps two occurrences of the same question separate',async()=>{
    paper.node('web','card__title',1).text='Projectile motion, second occurrence';
    paper.edit('ds','card__title',{fontSize:'20px'});await sync({});
    expect([text('web','card__title',0),text('web','card__title',1)]).toEqual(['Projectile motion','Projectile motion, second occurrence']);
    expect([0,1].map(n=>paper.node('web','card__title',n).styles.fontSize)).toEqual(['20px','20px']);
  });
});

describe('drift is reported and protected',()=>{
  it('refuses to overwrite a private style edit, then recovers when the master is accepted',async()=>{
    paper.edit('web','card',{gap:'10px'},0);paper.edit('ds','card',{gap:'24px'});
    const result=await survey(paper,registry,lock);
    expect(summarise(result)).toMatchObject({drift:1,pending:2});
    expect(result.instances.find((i:any)=>i.where==='editor').drift[0]).toMatchObject({kind:'unrecognised-style',property:'gap',found:'10px',master:'24px'});
    const report=await applyPlan(paper,registry,lock,toPlan(result,registry));
    expect(report.refused).toEqual([expect.objectContaining({reason:'drift'})]);
    expect(paper.node('web','card',0).styles.gap).toBe('10px');
    const editor=result.instances.find((i:any)=>i.where==='editor').id;
    const accepted=await applyPlan(paper,registry,lock,await plan({accept:[editor]}),{accept:[editor]});
    expect(accepted.refused).toEqual([]);expect(paper.node('web','card',0).styles.gap).toBe('24px');
    expect(isClean(await survey(paper,registry,lock))).toBe(true);
  });

  it('reports a changed fixed label, an unknown layer and a deleted layer',async()=>{
    paper.node('web','card__label',0).text='About this';
    await paper.json('write_html',{fileId:'web',targetNodeId:id('web','card',1),mode:'insert-children',html:'<div layer-name="card__sticker" style="font-size:10px">New</div>'});
    await paper.json('delete_nodes',{fileId:'ds',nodeIds:[id('ds','card__rows',1)]});
    const kinds=(await survey(paper,registry,lock)).instances.flatMap((i:any)=>i.drift.map((d:any)=>d.kind)).sort();
    expect(kinds).toEqual(['layer-deleted','unrecognised-layer','unrecognised-text']);
  });

  it('reports a detached instance and a component layer that nobody registered',async()=>{
    await paper.json('delete_nodes',{fileId:'web',nodeIds:[id('web','card',1)]});
    await paper.json('write_html',{fileId:'web',targetNodeId:'root_node_screens',mode:'insert-children',html:artboard('Copy',card('Detached copy',[]))});
    const result=await survey(paper,registry,lock);
    expect(result.instances.filter((i:any)=>i.status==='detached')).toHaveLength(1);
    expect(result.unregistered).toEqual([expect.objectContaining({master:'card',page:'screens',artboard:'Copy'})]);
    expect(isClean(result)).toBe(false);
  });

  it('ignores historical pages but requires every page to be classified',async()=>{
    expect((await survey(paper,registry,lock)).unregistered).toEqual([]);
    delete registry.files.web.pages.archive;
    expect((await survey(paper,registry,lock)).problems.join(' ')).toMatch(/archive.*not classified/);
  });
});

describe('a stale preview cannot overwrite newer work',()=>{
  it('refuses an instance that was edited after the preview',async()=>{
    paper.edit('ds','card',{gap:'24px'});const preview=await plan();
    paper.edit('web','card',{gap:'8px'},0);
    const report=await applyPlan(paper,registry,lock,preview);
    expect(report.refused).toEqual([expect.objectContaining({reason:'stale-plan',detail:expect.stringMatching(/instance changed/)})]);
    expect(paper.node('web','card',0).styles.gap).toBe('8px');
    expect(report.applied).toHaveLength(2);
  });

  it('refuses everything when the master moved on after the preview',async()=>{
    paper.edit('ds','card',{gap:'24px'});const preview=await plan();
    paper.edit('ds','card',{gap:'32px'});
    const report=await applyPlan(paper,registry,lock,preview);
    expect(report.applied).toEqual([]);expect(report.refused.every((r:any)=>r.reason==='stale-plan')).toBe(true);
    expect(paper.node('web','card',0).styles.gap).toBe('16px');
  });
});

describe('tokens across the two files',()=>{
  it('mirrors an owner change, and keeps a legacy alias pointing at its owner token',async()=>{
    expect(paper.tokens('web').find(t=>t.name==='--legacy-ink')!.value).toBe('var(--ink)');
    paper.tokens('ds').find(t=>t.name==='--ink')!.value='#111111';
    await sync({});
    expect(paper.tokens('web').find(t=>t.name==='--ink')!.value).toBe('#111111');
    expect(resolveToken('--legacy-ink',paper.tokens('web'))).toBe('#111111');
  });

  it('reports a mirror value changed by hand instead of overwriting it',async()=>{
    paper.tokens('web').find(t=>t.name==='--ink')!.value='#333333';
    paper.tokens('ds').find(t=>t.name==='--ink')!.value='#111111';
    const report=await sync({});
    expect(report.refused).toEqual([expect.objectContaining({id:'tokens:web',reason:'drift'})]);
    expect(paper.tokens('web').find(t=>t.name==='--ink')!.value).toBe('#333333');
  });

  it('reports a mirror-only token that is not a declared alias',async()=>{
    paper.tokens('web').push({name:'--stray',type:'color',value:'#FF0000'});
    expect((await survey(paper,registry,lock)).tokens[0].drift).toEqual([expect.objectContaining({kind:'unregistered-token',key:'--stray'})]);
  });
});

describe('recovery and export',()=>{
  it('restores styles, text, structure and tokens from the journal of an application',async()=>{
    const before=JSON.stringify(await readTree(paper,'web',id('web','card',0)));
    paper.edit('ds','card',{gap:'24px'});paper.node('ds','card__label',0).text='ABOUT';paper.tokens('ds').find(t=>t.name==='--ink')!.value='#111111';
    const report=await sync({});
    expect(paper.node('web','card__label',0).text).toBe('ABOUT');
    await restoreJournal(paper,registry,lock,report.record);
    expect(JSON.stringify(await readTree(paper,'web',id('web','card',0)))).toBe(before);
    expect(paper.tokens('web').find(t=>t.name==='--ink')!.value).toBe('#2D2D2D');
  });

  it('exports each visual value of the master once, and detects a hand-edited generated file',async()=>{
    const values=componentValues('card',registry.masters.card,await readTree(paper,'ds',id('ds','card',0)));
    expect(values).toMatchObject({'--pc-card-gap':'16px','--pc-card__title-font-size':'18px','--pc-card--read-only-background-color':'var(--color-surface-muted)'});
    expect(Object.keys(values)).not.toContain('--pc-card-display');
    const file=withHeader(':root {\n  --pc-card-gap: 16px;\n}\n','test');
    expect(inspectGenerated(file)).toMatchObject({generated:true,intact:true});
    expect(inspectGenerated(file.replace('16px','18px'))).toMatchObject({generated:true,intact:false});
  });
});
