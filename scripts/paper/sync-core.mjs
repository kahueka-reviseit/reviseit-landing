import {createHash} from 'node:crypto';
import {toHtml} from './tree.mjs';

/**
 * Planning for Paper synchronisation. Paper 0.5 has no master and instance link, so a
 * master is an ordinary frame and each registered instance is compared with it here.
 * Nothing in this file talks to Paper; it turns trees into a list of operations.
 *
 * Ownership: the master owns layer structure, every style and every fixed label. An
 * instance owns its slot text, its declared overridable properties and its extra layers.
 * `base` is the instance as it was left by the last synchronisation, which is what lets
 * a manual edit be told apart from a master change that has not arrived yet.
 */
const sortKeys=value=>Array.isArray(value)?value.map(sortKeys):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortKeys(value[k])])):value;
export const stable=value=>JSON.stringify(sortKeys(value));
export const hashOf=value=>createHash('sha256').update(stable(value)).digest('hex').slice(0,12);
const same=(a,b)=>stable(a??null)===stable(b??null);
export const matches=(name,patterns=[])=>patterns.some(p=>p.endsWith('*')?name.startsWith(p.slice(0,-1)):p===name);

/** A master's layer names are the addresses used by slots, overrides and variants, so they must be unique. */
export function validateMaster(master,spec={}) {
  const seen=new Set(),problems=[];
  const visit=node=>{
    if(matches(node.name,spec.nested))return;
    if(seen.has(node.name))problems.push(`layer name "${node.name}" is used twice`);
    seen.add(node.name);node.children.forEach(visit);
  };
  master.children.forEach(visit);
  for(const name of [...(spec.slots??[]),...(spec.repeat??[]),...Object.keys(spec.overridable??{})])
    if(name!==master.name&&!seen.has(name)&&name!=='@root')problems.push(`"${name}" is declared but is not a layer of the master`);
  return problems;
}

/** The master's own definition, used to notice that the master changed between a preview and its application. */
export function masterHash(master,spec={}) {
  const strip=node=>({name:node.name,type:node.type,styles:node.styles,text:node.text,children:node.children.map(strip)});
  return hashOf({tree:strip(master),spec});
}

/**
 * Compares one instance with its master.
 * Returns the operations that bring the instance in line, the edits that must not be
 * overwritten (`drift`), the synchronised state to remember, and the instance's own content.
 */
export function planInstance({master,instance,spec={},entry={},base,resolveNested=()=>null,prefix=''}) {
  // An instance may combine variants, for example ["collapsed","narrow"]; later ones win.
  const names=[entry.variant??[]].flat(),missing=names.filter(n=>!spec.variants?.[n]);
  if(missing.length)return {ops:[],drift:[{kind:'unknown-variant',key:prefix||'@root',detail:`variant "${missing.join(', ')}" is not defined`}],state:{},content:{}};
  const variant={omit:names.flatMap(n=>spec.variants[n].omit??[]),styles:{},text:{}};
  for(const n of names){
    for(const [layer,styles] of Object.entries(spec.variants[n].styles??{}))variant.styles[layer]={...(variant.styles[layer]??{}),...styles};
    Object.assign(variant.text,spec.variants[n].text??{});
  }
  const omit=new Set([...variant.omit,...(entry.omit??[])]);
  const extras=[...(spec.extras??[]),...(entry.extras??[])];
  const ops=[],drift=[],state={},content={};
  const styleFor=(name,node)=>({...node.styles,...(variant.styles[name]??{}),...(entry.overrides?.[name]??{})});
  const textFor=(name,node)=>variant.text[name]??node.text??'';
  const desiredTree=node=>({...node,styles:styleFor(node.name,node),text:node.type==='Text'?textFor(node.name,node):undefined,children:node.children.filter(c=>!omit.has(c.name)).map(desiredTree)});

  function compare(masterNode,node,key,rootName) {
    const name=rootName??masterNode.name,free=new Set(spec.overridable?.[name]??[]);
    const desired=styleFor(name,masterNode),slot=(spec.slots??[]).includes(name);
    const synced={},own={},changed=[];
    for(const prop of new Set([...Object.keys(desired),...Object.keys(node.styles)])){
      const current=node.styles[prop];
      if(free.has(prop)){if(current!==undefined)own[prop]=current;continue;}
      if(current!==undefined)synced[prop]=current;
      if(!same(current,desired[prop]))changed.push(prop);
    }
    const now={styles:synced};
    if(masterNode.type==='Text'&&!slot)now.text=node.text;
    // The lock keeps one hash per layer: equal means nobody has touched it since the last synchronisation.
    const untouched=!base||base[key]===undefined||base[key]===hashOf(now);
    const text=masterNode.type==='Text'&&!slot?textFor(name,masterNode):undefined;
    if(untouched){
      if(changed.length)ops.push({op:'style',key,nodeId:node.id,set:Object.fromEntries(changed.map(p=>[p,desired[p]??''])),from:Object.fromEntries(changed.map(p=>[p,node.styles[p]??null]))});
      if(text!==undefined&&node.text!==text)ops.push({op:'text',key,nodeId:node.id,text,from:node.text});
    }else{
      for(const prop of changed)drift.push({kind:'unrecognised-style',key,nodeId:node.id,property:prop,found:node.styles[prop]??null,master:desired[prop]??null});
      if(text!==undefined&&node.text!==text)drift.push({kind:'unrecognised-text',key,nodeId:node.id,found:node.text,master:text});
    }
    state[key]=hashOf(now);
    if(Object.keys(own).length)content[key]={...(content[key]??{}),styles:own};
    if(slot)content[key]={...(content[key]??{}),text:node.text};
    if(node.type!==masterNode.type)drift.push({kind:'layer-type',key,nodeId:node.id,found:node.type,master:masterNode.type});
    children(masterNode,node,key);
  }

  function children(masterNode,node,parentKey) {
    const expected=masterNode.children.filter(c=>!omit.has(c.name));
    const order=[];// instance children in the order the master asks for
    let previous=null;// the layer a new one goes after: an existing node, or one inserted earlier in this plan
    const claimed=new Set();
    for(const child of expected){
      const nested=matches(child.name,spec.nested);
      const found=node.children.filter(c=>!claimed.has(c.id)&&(nested?matches(c.name,spec.nested):c.name===child.name));
      const repeat=(spec.repeat??[]).includes(child.name);
      const used=repeat?found:found.slice(0,1);
      used.forEach(c=>claimed.add(c.id));
      if(!used.length&&!repeat){
        const key=`${parentKey}/${child.name}`;
        if(base&&Object.keys(base).some(k=>k===key||k.startsWith(key+'/')))drift.push({kind:'layer-deleted',key,parentId:node.id,detail:'a synchronised layer was removed from this instance'});
        else{ops.push({op:'insert',key,parentId:node.id,after:previous,html:toHtml(desiredTree(child))});previous={inserted:key};}
        continue;
      }
      used.forEach((c,i)=>{
        const key=repeat?`${parentKey}/${child.name}[${i}]`:`${parentKey}/${child.name}`;order.push(c);previous={id:c.id};
        if(nested){const link=resolveNested(c.name,spec);
          if(link){const inner=planInstance({...link,instance:c,base,resolveNested,prefix:key});ops.push(...inner.ops);drift.push(...inner.drift);Object.assign(state,inner.state);Object.assign(content,inner.content);}
          return;}
        compare(child,c,key);
      });
    }
    for(const c of node.children){
      if(claimed.has(c.id))continue;
      const key=`${parentKey}/${c.name}`;
      if(matches(c.name,extras)){content[key]={...(content[key]??{}),extra:true};continue;}
      if(omit.has(c.name))drift.push({kind:'omitted-layer-present',key,nodeId:c.id,detail:`this variant leaves out "${c.name}"`});
      else if(base&&base[key]!==undefined)ops.push({op:'remove',key,nodeId:c.id});
      else drift.push({kind:'unrecognised-layer',key,nodeId:c.id,detail:`"${c.name}" is not part of the master and is not a declared extra`});
    }
    // Relative order of the master's layers; extras keep whatever position they have.
    const current=node.children.filter(c=>claimed.has(c.id));
    if(current.some((c,i)=>c.id!==order[i]?.id))ops.push({op:'order',key:parentKey,parentId:node.id,order:order.map(c=>c.id),from:current.map(c=>c.id)});
  }

  compare(master,instance,prefix||'@root',master.name);
  return {ops,drift,state,content};
}

/**
 * Tokens: the Design System file owns each value and the Website file mirrors it.
 * A mirror value that differs from both the owner and the last synchronised value is
 * a manual edit and is reported instead of overwritten.
 */
export function planTokens({source,mirror,base,aliases={}}) {
  const ops=[],drift=[],state={};
  const byName=list=>new Map(list.map(t=>[t.name,t]));
  const owner=byName(source),copy=byName(mirror);
  // Legacy names exist only in the mirror; each is declared as an alias of an owner token so it follows natively.
  const wanted=[...source,...Object.entries(aliases).map(([name,value])=>({name,value,type:owner.get(value.replace(/^var\(|\)$/g,''))?.type??'color',description:`Legacy alias of ${value.replace(/^var\(|\)$/g,'')}. Kept for older boards and existing application styles.`}))];
  for(const token of wanted){
    const found=copy.get(token.name),known=base?.[token.name];
    state[token.name]=token.value;
    if(!found){ops.push({op:'token-create',token});continue;}
    if(same(found.value,token.value))continue;
    if(known!==undefined&&!same(found.value,known))drift.push({kind:'token-conflict',key:token.name,found:found.value,lastSynchronised:known,master:token.value});
    else ops.push({op:'token-set',name:token.name,value:token.value,from:found.value});
  }
  for(const token of mirror){
    if(owner.has(token.name)||aliases[token.name])continue;
    if(base&&base[token.name]!==undefined)ops.push({op:'token-delete',name:token.name,from:token.value});
    else drift.push({kind:'unregistered-token',key:token.name,found:token.value,detail:'exists only in the mirror file and is not a declared legacy alias'});
  }
  return {ops,drift,state};
}
