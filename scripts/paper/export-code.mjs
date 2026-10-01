import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {connectPaper} from './client.mjs';
import {emptyLock,isClean,lockPath,readJson,registryPath,summarise,survey,writeJson} from './engine.mjs';
import {hashOf} from './sync-core.mjs';
import {walk} from './tree.mjs';
import {matches} from './sync-core.mjs';

/**
 * Paper to application code. Run by hand (`npm run paper:pull`) after Paper is in sync.
 * It only rewrites local files; review, commit and deployment stay ordinary steps.
 *
 *   app/paper-tokens.css          every token of the Website file (which mirrors the Design System)
 *   app/paper-components.css      one custom property per visual value of each master layer
 *   design/paper/linked-components.json   the same values with their Paper identities
 *   design/paper/snapshot.json    token list used by check:paper
 *   lib/email/templates.ts        the marked colour block, resolved to literal values
 */
export const files={tokens:'app/paper-tokens.css',components:'app/paper-components.css',record:'design/paper/linked-components.json',snapshot:'design/paper/snapshot.json',email:'lib/email/templates.ts'};
const exported=/^(gap|rowGap|columnGap|padding\w*|width|height|minHeight|maxWidth|fontSize|lineHeight|letterSpacing|fontWeight|color|backgroundColor|border\w*(Color|Width|Radius)|opacity)$/;
const kebab=prop=>prop.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
// Keywords such as fit-content describe Paper's layout intent, not a value the application can reuse.
const measurable=value=>/^(-?[\d.]|#|var\(|rgb|hsl|color-mix)/.test(String(value));
const stamp=body=>hashOf(body);
const HEADER=/^\/\* generated-by: paper:pull · content-hash: ([0-9a-f]{12})[^\n]*\*\/\n/;

/** A generated file records the hash of its own body, so a hand edit is detectable without Paper. */
export function withHeader(body,note){return `/* generated-by: paper:pull · content-hash: ${stamp(body)} · ${note} */\n${body}`;}
export function inspectGenerated(text){
  const m=text.match(HEADER);if(!m)return {generated:false,intact:false};
  return {generated:true,intact:stamp(text.slice(m[0].length))===m[1],body:text.slice(m[0].length)};
}

export function tokensCss(tokens){
  const value=t=>t.type==='fontFamily'&&/\s/.test(String(t.value))?`"${t.value}"`:t.value;
  return `:root {\n${tokens.map(t=>`  ${t.name}: ${value(t)};`).join('\n')}\n}\n`;
}
/** Custom properties for every visual value of every named master layer, and for each variant's differences. */
export function componentValues(id,spec,tree){
  const values={};
  const visit=node=>{
    // Nested components (for example a tag inside an outline row) belong to their own master.
    if(node!==tree&&matches(node.name,spec.nested??[]))return;
    node.children.forEach(visit);
    const layer=node===tree?spec.block:node.name;
    for(const [prop,value] of Object.entries(node.styles))if(exported.test(prop)&&measurable(value)&&!(spec.overridable?.[layer]??[]).includes(prop))values[`--pc-${layer}-${kebab(prop)}`]=String(value);
  };
  visit(tree);
  for(const [variant,definition] of Object.entries(spec.variants??{}))
    for(const [layer,styles] of Object.entries(definition.styles??{}))
      for(const [prop,value] of Object.entries(styles))if(exported.test(prop))values[`--pc-${layer}--${variant}-${kebab(prop)}`]=value===null?'initial':String(value);
  return values;
}
export function componentsCss(record){
  const blocks=Object.entries(record.masters).map(([id,m])=>`  /* ${id} · Paper master ${m.node} · definition ${m.hash} */\n${Object.entries(m.values).map(([k,v])=>`  ${k}: ${v};`).join('\n')}`);
  return `:root {\n${blocks.join('\n')}\n}\n`;
}
/** Email clients ignore variables, so each token is resolved to its literal value. */
export function resolveToken(name,tokens,seen=new Set()){
  const token=tokens.find(t=>t.name===name);if(!token)throw new Error(`token ${name} does not exist`);
  const alias=String(token.value).match(/^var\((--[\w-]+)\)$/);
  if(!alias)return String(token.value);
  if(seen.has(name))throw new Error(`token ${name} refers to itself`);
  return resolveToken(alias[1],tokens,new Set([...seen,name]));
}
const EMAIL=/(\/\/ paper:tokens:start[^\n]*\n)([\s\S]*?)(\/\/ paper:tokens:end)/;
export function emailBlock(map,tokens){
  const entries=Object.entries(map).map(([key,name])=>`${key}: '${resolveToken(name,tokens)}'`);
  const lines=[];for(let i=0;i<entries.length;i+=6)lines.push('  '+entries.slice(i,i+6).join(', ')+',');
  return `const color = {\n${lines.join('\n')}\n};\n`;
}
export function replaceEmailBlock(source,block){
  if(!EMAIL.test(source))throw new Error('lib/email/templates.ts has no paper:tokens markers');
  return source.replace(EMAIL,(_,start,__,end)=>`${start}${block}${end}`);
}

/** Everything the export would write, computed from Paper without touching the disk. */
export function buildOutputs(root,registry,{websiteTokens,websiteHash,ownerHash,result}){
  const record={meta:{last_updated:new Date().toISOString().slice(0,10),source:{designSystemTokens:ownerHash,websiteTokens:websiteHash}},masters:{}};
  for(const [id,spec] of Object.entries(registry.masters)){
    if(!result.trees[id]||spec.export===false)continue;// exploratory masters have no application counterpart
    record.masters[id]={family:spec.family,file:spec.file,node:spec.node,hash:result.masters[id].hash,values:componentValues(id,spec,result.trees[id].tree)};
  }
  const snapshot=readJson(path.join(root,files.snapshot));
  snapshot.meta.last_updated=record.meta.last_updated;snapshot.tokenHash=websiteHash;snapshot.tokens=websiteTokens.map(({name,value})=>({name,value:String(value)}));
  const email=replaceEmailBlock(fs.readFileSync(path.join(root,files.email),'utf8'),emailBlock(registry.tokens.email,websiteTokens));
  return {
    [files.tokens]:withHeader(tokensCss(websiteTokens),`Revise It Website tokens ${websiteHash}, mirroring Design System ${ownerHash}. Change a token in the Design System file in Paper, never here.`),
    [files.components]:withHeader(componentsCss(record),'values of the Paper masters. Change the master in Paper, never here.'),
    [files.record]:JSON.stringify(record,null,1)+'\n',
    [files.snapshot]:JSON.stringify(snapshot,null,2)+'\n',
    [files.email]:email,
  };
}
const comparable=(file,text)=>file===files.record||file===files.snapshot?JSON.stringify({...JSON.parse(text),meta:undefined}):text;

export async function exportCode(root,{check=false,force=false,paper:given}={}){
  const registry=readJson(registryPath(root)),lock=readJson(lockPath(root),emptyLock());
  const paper=given??await connectPaper();
  try{
    const result=await survey(paper,registry,lock);
    if(!isClean(result)){console.error(`Paper is not in sync (${JSON.stringify(summarise(result))}). Run paper:status, then paper:plan and paper:apply, before exporting to code.`);return 1;}
    const website=registry.files[registry.tokens.mirrors[0]].id;
    const websiteTokens=(await paper.json('get_tokens',{fileId:website,format:'json'})).tokens;
    const outputs=buildOutputs(root,registry,{websiteTokens,websiteHash:await paper.tokenHash(website),ownerHash:await paper.tokenHash(registry.files[registry.tokens.owner].id),result});
    const changed=[],refused=[];
    for(const [file,text] of Object.entries(outputs)){
      const target=path.join(root,file),current=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';
      if(current&&comparable(file,current)===comparable(file,text))continue;
      // A generated stylesheet that was edited by hand is newer local work: never overwrite it silently.
      const state=inspectGenerated(current);
      if(file.endsWith('.css')&&state.generated&&!state.intact&&!force){refused.push(file);continue;}
      changed.push(file);if(!check)fs.writeFileSync(target,text);
    }
    if(!check&&changed.includes(files.email))execFileSync(process.execPath,['scripts/write-auth-templates.mts'],{cwd:root,stdio:'inherit'});
    for(const file of refused)console.error(`refused: ${file} was edited by hand after it was generated. Move the change to Paper, or rerun with --force to discard it.`);
    if(changed.length)console.log(`${check?'Out of date':'Updated'}: ${changed.join(', ')}`);
    else if(!refused.length)console.log('Application code already matches Paper.');
    return refused.length||(check&&changed.length)?1:0;
  }finally{if(!given)paper.close();}
}
