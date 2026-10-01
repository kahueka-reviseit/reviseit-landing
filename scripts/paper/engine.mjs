import fs from 'node:fs';
import path from 'node:path';
import {parseSummary,readTree,toHtml,walk} from './tree.mjs';
import {hashOf,masterHash,matches,planInstance,planTokens,shape,stable,validateMaster} from './sync-core.mjs';

/**
 * Reads Paper, compares every registered instance with its master, and applies an
 * approved plan. `paper` is anything with a `json(tool, args)` method, so tests can
 * supply an in-memory double of the Paper tools.
 */
export const registryPath=root=>path.join(root,'design/paper/components.json');
export const lockPath=root=>path.join(root,'design/paper/link-lock.json');
export const readJson=(file,fallback)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;
export const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,1)+'\n');};
export const emptyLock=()=>({meta:{last_updated:null},tokens:{},instances:{}});
export const instanceId=entry=>entry.id??`${entry.file}:${entry.node}`;
const fileId=(registry,key)=>registry.files[key].id;

async function tokensOf(paper,id){return (await paper.json('get_tokens',{fileId:id,format:'json'})).tokens.map(({name,type,value,description})=>({name,type,value,description}));}

/** Nested components (for example a tag inside an outline row) resolve to their own master and variant. */
function nestedResolver(registry,masters) {
  return (name,parent)=>{
    for(const [pattern,target] of Object.entries(registry.nested??{})){
      if(!matches(name,[pattern]))continue;
      // The layer name carries the variant (tag--apply); the parent may add its own context variant.
      const spec=registry.masters[target],variant=name.includes('--')?[name.slice(name.indexOf('--')+2)]:[];
      return {master:masters[target].tree,spec,entry:{variant:[...variant,...(parent?.nestedVariants?.[pattern]??[])]}};
    }
    return null;
  };
}

export async function survey(paper,registry,lock=emptyLock(),{accept=[],acceptRemoval=[],scan=true,tokens=true,only,preloaded}={}) {
  const result={at:new Date().toISOString(),masters:{},instances:[],tokens:[],unregistered:[],problems:[]};
  // Tokens: owner file to each mirror file.
  const owner=tokens?await tokensOf(paper,fileId(registry,registry.tokens.owner)):[];
  for(const mirror of tokens?registry.tokens.mirrors:[]){
    const plan=planTokens({source:owner,mirror:await tokensOf(paper,fileId(registry,mirror)),base:accept.includes(`tokens:${mirror}`)?undefined:lock.tokens[mirror],aliases:registry.tokens.legacyAliases});
    result.tokens.push({id:`tokens:${mirror}`,file:mirror,adopted:!!lock.tokens[mirror],...plan,fingerprint:hashOf({ops:plan.ops,drift:plan.drift})});
  }
  // Masters.
  const masters={};
  for(const [id,spec] of Object.entries(registry.masters)){
    try{const tree=preloaded?.[id]?.tree??await readTree(paper,fileId(registry,spec.file),spec.node);
      masters[id]={tree};result.masters[id]={hash:masterHash(tree,specOf(spec)),node:spec.node,file:spec.file,problems:validateMaster(tree,spec)};
      for(const p of result.masters[id].problems)result.problems.push(`master ${id}: ${p}`);
    }catch(error){result.problems.push(`master ${id}: ${error.message}`);}
  }
  const resolveNested=nestedResolver(registry,masters);
  // Instances.
  for(const [id,spec] of Object.entries(registry.masters)){
    if(!masters[id])continue;
    for(const entry of spec.instances??[]){
      const key=instanceId(entry);if(only&&!only.includes(key))continue;
      const known=lock.instances[key];
      let tree;try{tree=await readTree(paper,fileId(registry,entry.file),entry.node);}
      catch{result.instances.push({id:key,master:id,file:entry.file,node:entry.node,status:'detached',ops:[],drift:[{kind:'detached',key:'@root',detail:'the registered Paper node no longer exists'}]});continue;}
      const plan=planInstance({master:masters[id].tree,instance:tree,spec,entry,base:accept.includes(key)?undefined:known?.state,baseContent:known?.content,allowRemoval:acceptRemoval.includes(key),resolveNested});
      const status=plan.drift.length?'drift':!known?(plan.ops.length?'unadopted':'unrecorded'):plan.ops.length?'pending':stable(plan.state)===stable(known.state)&&known.masterHash===result.masters[id].hash?'in-sync':'unrecorded';
      result.instances.push({id:key,master:id,file:entry.file,node:entry.node,where:entry.where,variant:entry.variant,status,ops:plan.ops,drift:plan.drift,state:plan.state,
        stateHash:hashOf(plan.state),content:plan.content,contentHash:hashOf(plan.content),masterHash:result.masters[id].hash,fingerprint:hashOf({ops:plan.ops,drift:plan.drift}),before:plan.ops.length?tree:undefined});
    }
  }
  if(scan)result.unregistered=await scanPages(paper,registry,result);
  Object.defineProperty(result,'trees',{value:masters,enumerable:false});
  return result;
}
const specOf=({slots,overridable,repeat,nested,nestedVariants,extras,variants})=>({slots,overridable,repeat,nested,nestedVariants,extras,variants});

/** Active pages are searched for component-named frames that nobody registered. */
export async function scanPages(paper,registry,result) {
  const found=[];
  const blocks=Object.entries(registry.masters).map(([id,spec])=>({id,names:spec.scan??[spec.block,`${spec.block}--*`]}));
  for(const [fileKey,file] of Object.entries(registry.files)){
    const registered=new Map();// node id -> nested patterns that the registration covers
    for(const [id,spec] of Object.entries(registry.masters)){
      if(spec.file===fileKey)registered.set(spec.node,['*']);
      for(const entry of spec.instances??[])if(entry.file===fileKey)registered.set(entry.node,spec.nested??[]);
      for(const entry of spec.notLinked??[])if(entry.file===fileKey)registered.set(entry.node,['*']);
    }
    const listed=await paper.json('get_basic_info',{fileId:file.id});
    for(const page of listed.pages??[]){
      const status=file.pages?.[page.id]?.status;
      if(!status){result.problems.push(`${fileKey}: page "${page.name}" (${page.id}) is not classified as active, illustration or historical`);continue;}
      if(status!=='active')continue;
      const top=await paper.json('get_children',{fileId:file.id,nodeId:`root_node_${page.id}`});
      for(const artboard of top.children??[]){
        if(registered.get(artboard.id)?.includes('*'))continue;
        const tree=parseSummary((await paper.json('get_tree_summary',{fileId:file.id,nodeId:artboard.id,depth:10})).summary);
        const visit=(node,covered)=>{
          const own=registered.get(node.id);
          if(own?.includes('*'))return;
          const cover=own?[...covered,...own]:covered;
          const block=blocks.find(b=>matches(node.name,b.names));
          if(block&&node.type==='Frame'&&!own&&!matches(node.name,cover))found.push({master:block.id,file:fileKey,page:page.id,artboard:artboard.name,node:node.id,name:node.name});
          node.children.forEach(child=>visit(child,cover));
        };
        if(tree)visit(tree,[]);
      }
    }
  }
  return found;
}

export function summarise(result) {
  const count=status=>result.instances.filter(i=>i.status===status).length;
  const tokenOps=result.tokens.reduce((n,t)=>n+t.ops.length,0),tokenDrift=result.tokens.reduce((n,t)=>n+t.drift.length,0);
  return {masters:Object.keys(result.masters).length,instances:result.instances.length,inSync:count('in-sync'),pending:count('pending'),unadopted:count('unadopted'),unrecorded:count('unrecorded'),
    drift:count('drift'),detached:count('detached'),operations:result.instances.reduce((n,i)=>n+i.ops.length,0)+tokenOps,tokenOperations:tokenOps,tokenDrift,unregistered:result.unregistered.length,problems:result.problems.length};
}
export const isClean=result=>{const s=summarise(result);return !s.pending&&!s.unadopted&&!s.unrecorded&&!s.drift&&!s.detached&&!s.operations&&!s.tokenDrift&&!s.unregistered&&!s.problems;};

/** The reviewable preview: what would change, and the fingerprints that must still hold when it is applied. */
export function toPlan(result,registry) {
  return {meta:{created:result.at,registry:hashOf(registry)},summary:summarise(result),masters:result.masters,problems:result.problems,unregistered:result.unregistered,
    tokens:result.tokens.map(({id,file,adopted,ops,drift,fingerprint})=>({id,file,adopted,ops,drift,fingerprint})),
    instances:result.instances.filter(i=>i.status!=='in-sync').map(({id,master,file,node,where,status,ops,drift,masterHash,stateHash,contentHash,fingerprint})=>({id,master,file,node,where,status,ops,drift,masterHash,stateHash,contentHash,fingerprint}))};
}

/** Paper did not confirm a write, so its remote result is unknown. Nothing after it was attempted. */
export class InterruptedApply extends Error {}

const writeAtomic=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(value,null,1)+'\n');fs.renameSync(tmp,file);};
const unfinished=['in-progress','interrupted','recovery-incomplete'];
/** Journals whose application did not finish cleanly, or whose recovery left something for review. */
export function openJournals(dir){
  if(!dir||!fs.existsSync(dir))return [];
  return fs.readdirSync(dir).filter(f=>/^journal-.*\.json$/.test(f)).map(f=>path.join(dir,f)).filter(f=>unfinished.includes(readJson(f)?.meta?.status));
}

/**
 * Applies a preview. Each instance is read again first: if its master or the instance
 * itself no longer matches what the preview recorded, that instance is refused.
 *
 * Recovery is written ahead. Before the first change to a token file or an instance, its
 * before-state and every intended operation are saved to the journal. Each operation is
 * marked "sent" before the call and "acknowledged" after it. If Paper fails to confirm a
 * call, that operation is marked "uncertain" (it may or may not have been applied), the
 * journal is marked "interrupted", nothing further is attempted, and the report says so.
 * The lock is saved through `checkpoint` after each verified item, never for an item that
 * did not finish.
 */
export async function applyPlan(paper,registry,lock,plan,{adopt=[],accept=[],acceptRemoval=[],journalDir,checkpoint=()=>{},now=()=>new Date().toISOString()}={}) {
  const fresh=await survey(paper,registry,lock,{accept,acceptRemoval,scan:false});
  const applied=now();
  const journal={meta:{format:2,applied,plan:plan.meta,status:'in-progress'},tokens:[],instances:[],lockBefore:{tokens:{},instances:{}}};
  const file=journalDir?path.join(journalDir,`journal-${applied.replace(/[:.]/g,'-')}.json`):null;
  let written=false;
  const save=()=>{if(file){writeAtomic(file,journal);written=true;}};
  const report={applied:[],refused:[],unchanged:[]};
  Object.defineProperty(report,'record',{value:journal});
  const step=async(op,call)=>{
    op.status='sent';save();
    try{const result=await call();op.status='acknowledged';save();return result;}
    catch(error){op.status='uncertain';op.error=String(error?.message??error);throw new InterruptedApply(`Paper did not confirm ${op.op} ${op.key??op.name??op.token?.name}: ${op.error}`);}
  };
  const pending=ops=>ops.map(o=>({...o,status:'pending'}));
  const all=adopt.includes('all');
  try{
    for(const planned of plan.tokens){
      const current=fresh.tokens.find(t=>t.id===planned.id);
      if(!current||current.fingerprint!==planned.fingerprint){report.refused.push({id:planned.id,reason:'stale-plan',detail:'the tokens changed after this preview was made'});continue;}
      if(current.drift.length){report.refused.push({id:planned.id,reason:'drift',drift:current.drift});continue;}
      if(!current.ops.length){if(!lock.tokens[current.file]){lock.tokens[current.file]=current.state;checkpoint(lock);}report.unchanged.push(planned.id);continue;}
      if(!current.adopted&&!all&&!adopt.includes(planned.id)){report.refused.push({id:planned.id,reason:'not-adopted',detail:'first synchronisation needs --adopt'});continue;}
      const id=fileId(registry,current.file),entry={file:current.file,status:'in-progress',ops:pending(current.ops)};
      journal.lockBefore.tokens[current.file]=lock.tokens[current.file]??null;journal.tokens.push(entry);save();
      for(const o of entry.ops){
        if(o.op==='token-create')await step(o,()=>paper.json('create_tokens',{fileId:id,tokens:[{type:o.token.type,name:o.token.name,value:o.token.value,...(o.token.description?{description:o.token.description}:{})}]}));
        else if(o.op==='token-delete')await step(o,()=>paper.json('set_tokens',{fileId:id,tokens:[{name:o.name,delete:true}]}));
        else await step(o,()=>paper.json('set_tokens',{fileId:id,tokens:[{name:o.name,value:o.value}]}));
      }
      lock.tokens[current.file]=current.state;entry.status='verified';save();checkpoint(lock);
      report.applied.push({id:planned.id,operations:current.ops.length});
    }
    for(const planned of plan.instances){
      const current=fresh.instances.find(i=>i.id===planned.id);
      if(!current){report.refused.push({id:planned.id,reason:'not-registered'});continue;}
      if(current.masterHash!==planned.masterHash||current.fingerprint!==planned.fingerprint){report.refused.push({id:planned.id,reason:'stale-plan',detail:current.masterHash!==planned.masterHash?'the master changed after this preview was made':'the instance changed after this preview was made'});continue;}
      if(current.drift.length){report.refused.push({id:planned.id,reason:'drift',drift:current.drift});continue;}
      const known=lock.instances[current.id];
      if(!known&&current.ops.length&&!all&&!adopt.includes(current.id)){report.refused.push({id:planned.id,reason:'not-adopted',detail:'first synchronisation needs --adopt'});continue;}
      const id=fileId(registry,current.file);
      const entry={id:current.id,file:current.file,node:current.node,status:'in-progress',before:current.before,ops:pending(current.ops)};
      if(current.ops.length){
        journal.lockBefore.instances[current.id]=known??null;journal.instances.push(entry);save();
        const placed={};
        for(const o of entry.ops.filter(o=>o.op==='style'))await step(o,()=>paper.json('update_styles',{fileId:id,updates:[{nodeIds:[o.nodeId],styles:o.set}]}));
        for(const o of entry.ops.filter(o=>o.op==='text'))await step(o,()=>paper.json('set_text_content',{fileId:id,updates:[{nodeId:o.nodeId,textContent:o.text}]}));
        for(const o of entry.ops.filter(o=>o.op==='insert'))await step(o,async()=>{
          const made=await paper.json('write_html',{fileId:id,targetNodeId:o.parentId,mode:'insert-children',html:o.html});
          o.created=made.createdNodes[0].id;placed[o.key]=o.created;save();
          const after=o.after?.id??placed[o.after?.inserted];
          await paper.json('move_nodes',{fileId:id,moves:[after?{nodeId:o.created,after}:{nodeId:o.created,parentId:o.parentId,index:0}]});
        });
        for(const o of entry.ops.filter(o=>o.op==='remove'))await step(o,()=>paper.json('delete_nodes',{fileId:id,nodeIds:[o.nodeId]}));
        for(const o of entry.ops.filter(o=>o.op==='order'))await step(o,async()=>{for(let i=1;i<o.order.length;i++)await paper.json('move_nodes',{fileId:id,moves:[{nodeId:o.order[i],after:o.order[i-1]}]});});
      }
      // Read back: the instance must now equal its master, and its own content must be untouched.
      const reread=async()=>(await survey(paper,registry,{...lock,instances:{...lock.instances,[current.id]:undefined}},{scan:false,tokens:false,only:[current.id],preloaded:fresh.trees})).instances[0];
      let after=await reread();
      // Paper may add a layout style (for example a width) to a layer it has just inserted or moved. Settle those once, journalled like any other write.
      if(after.ops.length&&!after.drift.length&&after.ops.every(o=>o.op==='style')&&current.ops.some(o=>o.op==='insert'||o.op==='order')){
        const settle=after.ops.map(o=>({...o,settled:true,status:'pending'}));entry.ops.push(...settle);save();
        for(const o of settle)await step(o,()=>paper.json('update_styles',{fileId:id,updates:[{nodeIds:[o.nodeId],styles:o.set}]}));
        after=await reread();
      }
      if(after.ops.length||after.drift.length){entry.status='did-not-converge';save();report.refused.push({id:current.id,reason:'did-not-converge',remaining:after.ops,drift:after.drift});continue;}
      // Everything the instance owned before must be exactly as it was, apart from layers a reviewed removal took away; a newly inserted layer may bring new slots.
      const removed=current.ops.filter(o=>o.op==='remove').map(o=>o.key);
      const lost=Object.entries(current.content).filter(([key,value])=>after.content[key]===undefined?!removed.some(r=>key===r||key.startsWith(r+'/')):stable(after.content[key])!==stable(value)).map(([key])=>key);
      if(lost.length){entry.status='content-changed';save();report.refused.push({id:current.id,reason:'content-changed',detail:`instance content changed during synchronisation: ${lost.join(', ')}`});continue;}
      lock.instances[current.id]={master:current.master,masterHash:after.masterHash,variant:current.variant??null,state:after.state,content:after.content,contentHash:after.contentHash,synchronised:now()};
      if(current.ops.length){entry.status='verified';save();}
      checkpoint(lock);
      (current.ops.length?report.applied:report.unchanged).push(current.ops.length?{id:current.id,operations:current.ops.length,contentHash:after.contentHash}:current.id);
    }
  }catch(error){
    // Whatever stopped the run, the journal already holds every change that was sent.
    journal.meta.status='interrupted';journal.meta.interrupted=now();journal.meta.error=String(error?.message??error);
    if(journal.tokens.length||journal.instances.length)save();
    lock.meta.last_updated=now().slice(0,10);checkpoint(lock);
    report.interrupted={error:journal.meta.error,journal:written?file:null,uncertain:[...journal.tokens,...journal.instances].flatMap(e=>e.ops.filter(o=>o.status==='uncertain'||o.status==='sent').map(o=>({item:e.id??`tokens:${e.file}`,op:o.op,key:o.key??o.name??o.token?.name})))};
    if(written)report.journal=file;
    return report;
  }
  lock.meta.last_updated=now().slice(0,10);
  journal.meta.status='complete';
  if(journal.tokens.length||journal.instances.length){save();report.journal=file??undefined;}
  checkpoint(lock);
  return report;
}

/**
 * Undoes one application, interrupted or complete, by looking at Paper first. A recorded
 * change is put back only where Paper still shows the value that application wrote. Where
 * Paper shows the earlier value, the change never landed and nothing is done. Anything else
 * was changed by someone since: it is left alone and reported. Operations are undone in
 * reverse order; running it again does nothing more.
 */
export async function restoreJournal(paper,registry,lock,journal,{save=()=>{},now=()=>new Date().toISOString()}={}) {
  const report={restored:[],conflicts:[],notes:[],outcomes:[]};
  const record=(item,o,outcome,detail)=>{o.recovery=outcome;if(detail)o.recoveryDetail=detail;report.outcomes.push({item,op:o.op,key:o.key??o.name??o.token?.name,outcome,...(detail?{detail}:{})});
    if(outcome==='conflict')report.conflicts.push({item,key:o.key??o.name??o.token?.name,detail});save(journal);};
  const exists=async(fileKey,nodeId)=>{try{return await readTree(paper,fileId(registry,fileKey),nodeId);}catch{return null;}};
  for(const entry of journal.tokens){
    const item=`tokens:${entry.file}`,id=fileId(registry,entry.file);
    for(const o of [...entry.ops].reverse()){
      if(o.recovery==='reverted')continue;
      if(o.status==='pending'){record(item,o,'never-sent');continue;}
      const tokens=new Map((await paper.json('get_tokens',{fileId:id,format:'json'})).tokens.map(t=>[t.name,t]));
      if(o.op==='token-set'){const cur=tokens.get(o.name)?.value;
        if(cur===o.value){await paper.json('set_tokens',{fileId:id,tokens:[{name:o.name,value:o.from}]});record(item,o,'reverted');}
        else if(cur===o.from)record(item,o,'not-applied');
        else record(item,o,'conflict',`${o.name} is now ${cur??'absent'}; this application set ${o.value} over ${o.from}`);}
      if(o.op==='token-create'){const cur=tokens.get(o.token.name);
        if(!cur)record(item,o,'not-applied');
        else if(cur.value===o.token.value){await paper.json('set_tokens',{fileId:id,tokens:[{name:o.token.name,delete:true}]});record(item,o,'reverted');}
        else record(item,o,'conflict',`${o.token.name} was created as ${o.token.value} and is now ${cur.value}`);}
      if(o.op==='token-delete'){const cur=tokens.get(o.name);
        if(!cur){await paper.json('create_tokens',{fileId:id,tokens:[{type:o.type??'color',name:o.name,value:o.from}]});record(item,o,'reverted');}
        else if(cur.value===o.from)record(item,o,'not-applied');
        else record(item,o,'conflict',`${o.name} was deleted by this application and now exists again as ${cur.value}`);}
    }
    if(!entry.ops.some(o=>o.recovery==='conflict')){const state=journal.lockBefore.tokens[entry.file];if(state===null||state===undefined)delete lock.tokens[entry.file];else lock.tokens[entry.file]=state;report.restored.push(item);}
  }
  for(const entry of journal.instances){
    const id=fileId(registry,entry.file),beforeIds=new Set();walk(entry.before,n=>beforeIds.add(n.id));
    for(const o of [...entry.ops].reverse()){
      if(o.recovery==='reverted')continue;
      if(o.status==='pending'){record(entry.id,o,'never-sent');continue;}
      if(o.op==='style'){
        const node=await exists(entry.file,o.nodeId);
        if(!node){record(entry.id,o,'conflict','the layer no longer exists');continue;}
        const back={},clash=[];let landed=false;
        for(const [p,v] of Object.entries(o.set)){
          const target=v===''?undefined:v,before=o.from[p]??undefined,cur=node.styles[p];
          if(cur===target){back[p]=before??'';landed=true;}else if(cur!==before)clash.push(`${p} is ${cur??'unset'}`);
        }
        if(clash.length){record(entry.id,o,'conflict',`changed since this application: ${clash.join(', ')}`);continue;}
        if(landed){await paper.json('update_styles',{fileId:id,updates:[{nodeIds:[o.nodeId],styles:back}]});record(entry.id,o,'reverted');}else record(entry.id,o,'not-applied');
      }
      if(o.op==='text'){
        const node=await exists(entry.file,o.nodeId);
        if(!node)record(entry.id,o,'conflict','the layer no longer exists');
        else if(node.text===o.text){await paper.json('set_text_content',{fileId:id,updates:[{nodeId:o.nodeId,textContent:o.from}]});record(entry.id,o,'reverted');}
        else if(node.text===o.from)record(entry.id,o,'not-applied');
        else record(entry.id,o,'conflict',`text is now "${node.text}"`);
      }
      if(o.op==='insert'){
        let created=o.created?await exists(entry.file,o.created):null;
        if(!o.created){
          // The write was not confirmed, so its identifier is unknown: look for a layer of that name that was not there before.
          const parent=await exists(entry.file,o.parentId),name=o.key.split('/').pop();
          const candidates=(parent?.children??[]).filter(c=>c.name===name&&!beforeIds.has(c.id));
          if(candidates.length>1){record(entry.id,o,'conflict',`${candidates.length} new layers named "${name}"; remove the right one by hand`);continue;}
          created=candidates[0]?await exists(entry.file,candidates[0].id):null;
        }
        if(!created)record(entry.id,o,'not-applied');
        // Paper may store the same styles in another order, so compare structure, not markup text.
        else if(o.tree?stable(shape(created))===stable(o.tree):toHtml(created)===o.html){await paper.json('delete_nodes',{fileId:id,nodeIds:[created.id]});record(entry.id,o,'reverted');}
        else record(entry.id,o,'conflict','the inserted layer was edited after this application; left in place');
      }
      if(o.op==='remove'){
        if(await exists(entry.file,o.nodeId)){record(entry.id,o,'not-applied');continue;}
        let node,parent,previous;walk(entry.before,(n,p)=>{if(n.id===o.nodeId){node=n;parent=p;}});
        if(!parent||!await exists(entry.file,parent.id)){record(entry.id,o,'conflict','its parent layer no longer exists');continue;}
        const index=parent.children.findIndex(c=>c.id===o.nodeId);previous=parent.children[index-1];
        const made=await paper.json('write_html',{fileId:id,targetNodeId:parent.id,mode:'insert-children',html:toHtml(node)});
        o.recreated=made.createdNodes[0].id;
        await paper.json('move_nodes',{fileId:id,moves:[previous&&await exists(entry.file,previous.id)?{nodeId:o.recreated,after:previous.id}:{nodeId:o.recreated,parentId:parent.id,index:0}]});
        record(entry.id,o,'reverted');report.notes.push(`${entry.id}: layer "${node.name}" was recreated with a new identifier ${o.recreated}`);
      }
      if(o.op==='order'){
        const parent=await exists(entry.file,o.parentId);
        if(!parent){record(entry.id,o,'conflict','the parent layer no longer exists');continue;}
        const ids=parent.children.map(c=>c.id).filter(c=>o.order.includes(c));
        if(ids.join()===o.order.join()){for(let i=1;i<o.from.length;i++)await paper.json('move_nodes',{fileId:id,moves:[{nodeId:o.from[i],after:o.from[i-1]}]});record(entry.id,o,'reverted');}
        else if(ids.join()===o.from.join())record(entry.id,o,'not-applied');
        else record(entry.id,o,'conflict','the layer order has changed since this application');
      }
    }
    if(!entry.ops.some(o=>o.recovery==='conflict')){const state=journal.lockBefore.instances[entry.id];if(state===null||state===undefined)delete lock.instances[entry.id];else lock.instances[entry.id]=state;report.restored.push(entry.id);}
  }
  journal.recovery={at:now(),outcomes:report.outcomes};
  journal.meta.status=report.conflicts.length?'recovery-incomplete':'recovered';save(journal);
  return report;
}
