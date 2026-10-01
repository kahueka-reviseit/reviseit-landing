import fs from 'node:fs';
import path from 'node:path';
import {parseSummary,readTree,toHtml,walk} from './tree.mjs';
import {hashOf,masterHash,matches,planInstance,planTokens,stable,validateMaster} from './sync-core.mjs';

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

export async function survey(paper,registry,lock=emptyLock(),{accept=[],scan=true,tokens=true,only,preloaded}={}) {
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
      const plan=planInstance({master:masters[id].tree,instance:tree,spec,entry,base:accept.includes(key)?undefined:known?.state,resolveNested});
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

/**
 * Applies a preview. Each instance is read again first: if its master or the instance
 * itself no longer matches what the preview recorded, that instance is refused.
 */
export async function applyPlan(paper,registry,lock,plan,{adopt=[],accept=[],journalDir,now=()=>new Date().toISOString()}={}) {
  const fresh=await survey(paper,registry,lock,{accept,scan:false});
  const journal={meta:{applied:now(),plan:plan.meta},tokens:[],instances:[],lockBefore:{tokens:{},instances:{}}};
  const report={applied:[],refused:[],unchanged:[]};
  const all=adopt.includes('all');
  for(const planned of plan.tokens){
    const current=fresh.tokens.find(t=>t.id===planned.id);
    if(!current||current.fingerprint!==planned.fingerprint){report.refused.push({id:planned.id,reason:'stale-plan',detail:'the tokens changed after this preview was made'});continue;}
    if(current.drift.length){report.refused.push({id:planned.id,reason:'drift',drift:current.drift});continue;}
    if(!current.ops.length){if(!lock.tokens[current.file]){journal.lockBefore.tokens[current.file]=null;lock.tokens[current.file]=current.state;}report.unchanged.push(planned.id);continue;}
    if(!current.adopted&&!all&&!adopt.includes(planned.id)){report.refused.push({id:planned.id,reason:'not-adopted',detail:'first synchronisation needs --adopt'});continue;}
    const id=fileId(registry,current.file);
    journal.lockBefore.tokens[current.file]=lock.tokens[current.file]??null;journal.tokens.push({file:current.file,ops:current.ops});
    const create=current.ops.filter(o=>o.op==='token-create').map(o=>o.token);
    if(create.length)await paper.json('create_tokens',{fileId:id,tokens:create.map(t=>({type:t.type,name:t.name,value:t.value,...(t.description?{description:t.description}:{})}))});
    const change=current.ops.filter(o=>o.op!=='token-create').map(o=>o.op==='token-delete'?{name:o.name,delete:true}:{name:o.name,value:o.value});
    if(change.length)await paper.json('set_tokens',{fileId:id,tokens:change});
    lock.tokens[current.file]=current.state;report.applied.push({id:planned.id,operations:current.ops.length});
  }
  for(const planned of plan.instances){
    const current=fresh.instances.find(i=>i.id===planned.id);
    if(!current){report.refused.push({id:planned.id,reason:'not-registered'});continue;}
    if(current.masterHash!==planned.masterHash||current.fingerprint!==planned.fingerprint){report.refused.push({id:planned.id,reason:'stale-plan',detail:current.masterHash!==planned.masterHash?'the master changed after this preview was made':'the instance changed after this preview was made'});continue;}
    if(current.drift.length){report.refused.push({id:planned.id,reason:'drift',drift:current.drift});continue;}
    const known=lock.instances[current.id];
    if(!known&&current.ops.length&&!all&&!adopt.includes(current.id)){report.refused.push({id:planned.id,reason:'not-adopted',detail:'first synchronisation needs --adopt'});continue;}
    const id=fileId(registry,current.file),entry={id:current.id,file:current.file,node:current.node,before:current.before,ops:current.ops,inserted:[]},placed={};
    journal.lockBefore.instances[current.id]=known??null;
    if(current.ops.length){
      const styles=current.ops.filter(o=>o.op==='style');
      if(styles.length)await paper.json('update_styles',{fileId:id,updates:styles.map(o=>({nodeIds:[o.nodeId],styles:o.set}))});
      const texts=current.ops.filter(o=>o.op==='text');
      if(texts.length)await paper.json('set_text_content',{fileId:id,updates:texts.map(o=>({nodeId:o.nodeId,textContent:o.text}))});
      for(const o of current.ops.filter(o=>o.op==='insert')){
        const made=await paper.json('write_html',{fileId:id,targetNodeId:o.parentId,mode:'insert-children',html:o.html});
        const root=made.createdNodes[0].id;entry.inserted.push(root);placed[o.key]=root;
        const after=o.after?.id??placed[o.after?.inserted];
        await paper.json('move_nodes',{fileId:id,moves:[after?{nodeId:root,after}:{nodeId:root,parentId:o.parentId,index:0}]});
      }
      const removed=current.ops.filter(o=>o.op==='remove');
      if(removed.length)await paper.json('delete_nodes',{fileId:id,nodeIds:removed.map(o=>o.nodeId)});
      for(const o of current.ops.filter(o=>o.op==='order'))
        for(let i=1;i<o.order.length;i++)await paper.json('move_nodes',{fileId:id,moves:[{nodeId:o.order[i],after:o.order[i-1]}]});
      journal.instances.push(entry);
    }
    // Read back: the instance must now equal its master, and its own content must be untouched.
    const after=(await survey(paper,registry,{...lock,instances:{...lock.instances,[current.id]:undefined}},{scan:false,tokens:false,only:[current.id],preloaded:fresh.trees})).instances[0];
    if(after.ops.length||after.drift.length){report.refused.push({id:current.id,reason:'did-not-converge',remaining:after.ops,drift:after.drift});continue;}
    // Everything the instance owned before must be exactly as it was; a newly inserted layer may bring new slots.
    const removed=current.ops.filter(o=>o.op==='remove').map(o=>o.key);
    const lost=Object.entries(current.content).filter(([key,value])=>after.content[key]===undefined?!removed.some(r=>key===r||key.startsWith(r+'/')):stable(after.content[key])!==stable(value)).map(([key])=>key);
    if(lost.length){report.refused.push({id:current.id,reason:'content-changed',detail:`instance content changed during synchronisation: ${lost.join(', ')}`});continue;}
    lock.instances[current.id]={master:current.master,masterHash:after.masterHash,variant:current.variant??null,state:after.state,contentHash:after.contentHash,synchronised:now()};
    (current.ops.length?report.applied:report.unchanged).push(current.ops.length?{id:current.id,operations:current.ops.length,contentHash:after.contentHash}:current.id);
  }
  lock.meta.last_updated=now().slice(0,10);
  if(journalDir&&(journal.instances.length||journal.tokens.length)){
    const file=path.join(journalDir,`journal-${journal.meta.applied.replace(/[:.]/g,'-')}.json`);writeJson(file,journal);report.journal=file;}
  Object.defineProperty(report,'record',{value:journal});
  return report;
}

/** Puts back what an application changed: styles, text, order, inserted layers and token values. */
export async function restoreJournal(paper,registry,lock,journal) {
  const report={restored:[],notes:[]};
  for(const entry of journal.tokens){
    const id=fileId(registry,entry.file);
    const back=entry.ops.map(o=>o.op==='token-create'?{name:o.token.name,delete:true}:o.op==='token-set'?{name:o.name,value:o.from}:null).filter(Boolean);
    if(back.length)await paper.json('set_tokens',{fileId:id,tokens:back});
    for(const o of entry.ops.filter(o=>o.op==='token-delete'))report.notes.push(`${entry.file}: token ${o.name} was deleted and must be created again with value ${o.from}`);
    report.restored.push(`tokens:${entry.file}`);
  }
  for(const [file,state] of Object.entries(journal.lockBefore.tokens)){if(state===null)delete lock.tokens[file];else lock.tokens[file]=state;}
  for(const entry of journal.instances){
    const id=fileId(registry,entry.file),before=new Map();walk(entry.before,n=>before.set(n.id,n));
    if(entry.inserted.length)await paper.json('delete_nodes',{fileId:id,nodeIds:entry.inserted});
    for(const o of entry.ops){
      if(o.op==='style')await paper.json('update_styles',{fileId:id,updates:[{nodeIds:[o.nodeId],styles:Object.fromEntries(Object.entries(o.from).map(([k,v])=>[k,v??'']))}]});
      if(o.op==='text')await paper.json('set_text_content',{fileId:id,updates:[{nodeId:o.nodeId,textContent:o.from}]});
      if(o.op==='order')for(let i=1;i<o.from.length;i++)await paper.json('move_nodes',{fileId:id,moves:[{nodeId:o.from[i],after:o.from[i-1]}]});
      if(o.op==='remove'){const node=before.get(o.nodeId);let parent;walk(entry.before,(n,p)=>{if(n.id===o.nodeId)parent=p;});
        await paper.json('write_html',{fileId:id,targetNodeId:parent.id,mode:'insert-children',html:toHtml(node)});
        report.notes.push(`${entry.id}: layer "${node.name}" was recreated with a new identifier`);}
    }
    report.restored.push(entry.id);
  }
  for(const [key,state] of Object.entries(journal.lockBefore.instances)){if(state===null)delete lock.instances[key];else lock.instances[key]=state;}
  return report;
}
