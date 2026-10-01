#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {connectPaper} from './client.mjs';
import {applyPlan,emptyLock,isClean,lockPath,openJournals,readJson,registryPath,restoreJournal,summarise,survey,toPlan,writeJson} from './engine.mjs';
import {exportCode} from './export-code.mjs';

/**
 * Paper synchronisation commands. Paper itself only links tokens inside one file;
 * everything else here is explicit synchronisation with a preview, never inheritance.
 *
 *   status                      compare Paper with the registry; exit 1 on any difference
 *   plan --out <file>           write the preview of what an application would change
 *   apply --plan <file>         apply that preview (refused if Paper changed since)
 *       --adopt <id,…|all>      allow the first synchronisation of the named instances
 *       --accept-master <id,…>  overwrite a reported manual edit with the master
 *       --accept-removal <id,…> remove a layer the master dropped even though it holds work (journalled)
 *   restore --journal <file>    undo one application, interrupted or complete, after checking Paper
 *   pull [--check]              export tokens and component definitions to application code
 */
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [command,...rest]=process.argv.slice(2);
const flag=name=>{const i=rest.indexOf(`--${name}`);return i<0?undefined:rest[i+1]??'';};
const list=name=>(flag(name)??'').split(',').map(s=>s.trim()).filter(Boolean);
const journalDir=flag('journal-dir')??process.env.PAPER_LINK_JOURNAL??path.join(root,'.paper-link/journal');

function print(result) {
  const s=summarise(result);
  console.log(`Paper link: ${s.masters} masters, ${s.instances} instances; ${s.inSync} in sync, ${s.pending} awaiting a master change, ${s.unadopted+s.unrecorded} not yet adopted, ${s.drift} with unrecognised edits, ${s.detached} detached, ${s.unreadable} unreadable; ${s.tokenOperations} token operations, ${s.tokenDrift} token conflicts; ${s.unregistered} unregistered component layers.`);
  for(const p of result.problems)console.log(`  problem: ${p}`);
  for(const t of result.tokens){
    for(const o of t.ops)console.log(`  ${t.id}: ${o.op} ${o.name??o.token.name} ${o.from!==undefined?`${o.from} -> `:''}${o.value??o.token?.value??''}`);
    for(const d of t.drift)console.log(`  ${t.id}: ${d.kind} ${d.key}: mirror has ${d.found}, owner has ${d.master??'nothing'}${d.lastSynchronised!==undefined?`, last synchronised ${d.lastSynchronised}`:''}`);
  }
  for(const i of result.instances.filter(i=>i.status!=='in-sync')){
    console.log(`  ${i.id} (${i.master}${i.where?`, ${i.where}`:''}): ${i.status}, ${i.ops.length} operations`);
    for(const o of i.ops.slice(0,8))console.log(`      ${o.op} ${o.key}${o.set?` ${JSON.stringify(o.set)} was ${JSON.stringify(o.from)}`:o.text!==undefined?` "${o.from}" -> "${o.text}"`:''}`);
    if(i.ops.length>8)console.log(`      … ${i.ops.length-8} more`);
    for(const d of i.drift)console.log(`      ${d.kind} ${d.key}${d.property?` ${d.property}: found ${d.found}, master ${d.master}`:d.found!==undefined?`: found "${d.found}", master "${d.master}"`:d.detail?`: ${d.detail}`:''}`);
  }
  for(const u of result.unregistered)console.log(`  unregistered: "${u.name}" (${u.node}) on ${u.file} ${u.page} · ${u.artboard}; expected to be an instance of ${u.master}`);
}

if(command==='pull'){process.exitCode=await exportCode(root,{check:rest.includes('--check'),force:rest.includes('--force')});}
else if(['status','plan','apply','restore','recover'].includes(command)){
  const registry=readJson(registryPath(root)),lock=readJson(lockPath(root),emptyLock());
  const paper=await connectPaper();
  try{
    const open=openJournals(journalDir);
    const warnOpen=()=>{for(const f of open)console.log(`  problem: ${f} records an application that did not finish (${readJson(f).meta.status}). Run paper:restore -- --journal ${f}`);};
    if(command==='status'){const result=await survey(paper,registry,lock);print(result);warnOpen();
      if(flag('out'))writeJson(flag('out'),toPlan(result,registry));
      // Fingerprint of what each instance owns (slot text, images, declared overrides), to compare before and after a change.
      if(flag('content'))writeJson(flag('content'),Object.fromEntries(result.instances.map(i=>[i.id,{master:i.master,where:i.where,contentHash:i.contentHash,content:i.content}])));
      process.exitCode=isClean(result)&&!open.length?0:1;if(isClean(result)&&!open.length)console.log('Every registered instance equals its master and the mirrored tokens equal their owner.');}
    if(command==='plan'){const result=await survey(paper,registry,lock,{accept:list('accept-master'),acceptRemoval:list('accept-removal')});print(result);
      const out=flag('out')??path.join(journalDir,'plan.json');writeJson(out,toPlan(result,registry));console.log(`Preview written to ${out}`);}
    if(command==='apply'){const plan=readJson(flag('plan'));if(!plan)throw new Error('apply needs --plan <file> from the plan command');
      if(open.length){warnOpen();throw new Error('An earlier application did not finish. Recover it before applying anything else.');}
      const report=await applyPlan(paper,registry,lock,plan,{adopt:list('adopt'),accept:list('accept-master'),acceptRemoval:list('accept-removal'),journalDir,checkpoint:l=>writeJson(lockPath(root),l)});
      console.log(`Applied ${report.applied.length}, already equal ${report.unchanged.length}, refused ${report.refused.length}.`);
      for(const a of report.applied)console.log(`  applied ${a.id}: ${a.operations} operations`);
      for(const r of report.refused)console.log(`  refused ${r.id}: ${r.reason}${r.detail?` (${r.detail})`:''}`);
      if(report.journal)console.log(`Recovery journal: ${report.journal}`);
      if(report.interrupted){console.log(`INTERRUPTED: ${report.interrupted.error}`);for(const u of report.interrupted.uncertain)console.log(`  result unknown: ${u.item} ${u.op} ${u.key}`);
        console.log(`Nothing after that step was attempted. Inspect and undo with: npm run paper:restore -- --journal ${report.journal}`);process.exitCode=2;}
      if(flag('report'))writeJson(flag('report'),report);
      for(const key of Object.keys(registry.files))await paper.json('finish_working_on_nodes',{fileId:registry.files[key].id}).catch(()=>{});
      process.exitCode??=report.refused.length?1:0;}
    if(command==='restore'||command==='recover'){const target=flag('journal'),journal=readJson(target);if(!journal)throw new Error('restore needs --journal <file>');
      const report=await restoreJournal(paper,registry,lock,journal,{save:j=>writeJson(target,j)});writeJson(lockPath(root),lock);
      const count=k=>report.outcomes.filter(o=>o.outcome===k).length;
      console.log(`Restored ${report.restored.join(', ')||'nothing'}. Reverted ${count('reverted')}, never landed ${count('not-applied')}, never sent ${count('never-sent')}, left for review ${count('conflict')}, unknown ${count('uncertain')}.`);
      for(const c of report.conflicts)console.log(`  left for review: ${c.item} ${c.key}: ${c.detail}`);
      for(const u of report.uncertain)console.log(`  unknown, run restore again: ${u.item} ${u.key}: ${u.detail}`);
      for(const n of report.notes)console.log(`  note: ${n}`);process.exitCode=report.conflicts.length||report.uncertain.length?1:0;}
  }finally{paper.close();}
}else{console.log(fs.readFileSync(fileURLToPath(import.meta.url),'utf8').split('\n').slice(9,19).map(l=>l.replace(/^ \* ?/,'')).join('\n'));process.exitCode=command?1:0;}
