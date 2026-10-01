import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
import {componentsCss,emailBlock,files,inspectGenerated} from './export-code.mjs';
import {instanceId,lockPath,readJson,registryPath} from './engine.mjs';

/**
 * Offline drift check for the application side of the component links. It needs no
 * Paper connection: it compares the registry, the lock left by the last synchronisation,
 * the generated files and the source tree with each other.
 */
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='node_modules'?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const blockOf=name=>name.split('__')[0].split('--')[0];

export function importSites(root,definition) {
  const target=path.join(root,definition),sites=[];
  for(const file of [...walk(path.join(root,'app')),...walk(path.join(root,'lib'))].filter(f=>/\.tsx?$/.test(f))){
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,false);
    source.forEachChild(node=>{
      if(!(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))||!node.moduleSpecifier||!ts.isStringLiteral(node.moduleSpecifier))return;
      const spec=node.moduleSpecifier.text;if(!spec.startsWith('.'))return;
      const base=path.resolve(path.dirname(file),spec);
      if([base,base+'.tsx',base+'.ts'].includes(target)&&!sites.includes(path.relative(root,file)))sites.push(path.relative(root,file));
    });
  }
  return sites.sort();
}

export function checkLinks(root) {
  const failures=[],notes=[];
  const registry=readJson(registryPath(root)),lock=readJson(lockPath(root));
  if(!registry)return {failures:['design/paper/components.json is missing'],notes};
  // 1. Generated files are exactly what the export wrote.
  const record=readJson(path.join(root,files.record));
  for(const file of [files.tokens,files.components]){
    const state=fs.existsSync(path.join(root,file))?inspectGenerated(fs.readFileSync(path.join(root,file),'utf8')):{generated:false};
    if(!state.generated)failures.push(`${file}: not written by paper:pull`);
    else if(!state.intact)failures.push(`${file}: edited by hand after it was generated. Change the value in Paper and run paper:pull, or restore the file.`);
    else if(file===files.components&&record&&state.body!==componentsCss(record))failures.push(`${file}: does not match ${files.record}. Run paper:pull.`);
  }
  // 2. Every component value the stylesheets read was exported.
  const defined=new Set(Object.values(record?.masters??{}).flatMap(m=>Object.keys(m.values)));
  const styles=walk(path.join(root,'app')).filter(f=>f.endsWith('.css')&&!f.endsWith(files.components));
  const used=new Set();
  for(const file of styles)for(const [,name] of fs.readFileSync(file,'utf8').matchAll(/var\((--pc-[\w-]+)/g)){used.add(name);
    if(!defined.has(name))failures.push(`${path.relative(root,file)}: reads ${name}, which no Paper master exports`);}
  // 3. Email colours equal the resolved tokens.
  const snapshot=readJson(path.join(root,files.snapshot));
  try{const email=fs.readFileSync(path.join(root,files.email),'utf8');
    if(!email.includes(emailBlock(registry.tokens.email,snapshot.tokens)))failures.push(`${files.email}: the colour block differs from the Paper tokens. Run paper:pull.`);
  }catch(error){failures.push(`${files.email}: ${error.message}`);}
  // 4. One definition per family: the registry's import sites are the real ones, and nobody redefines a shared block.
  const modules=walk(path.join(root,'app')).filter(f=>f.endsWith('.module.css'));
  for(const [id,family] of Object.entries(registry.families??{})){
    for(const master of family.masters??[])if(!registry.masters[master])failures.push(`${id}: master "${master}" is not registered`);
    const code=family.code;if(!code)continue;
    if(!fs.existsSync(path.join(root,code.definition))){failures.push(`${id}: definition ${code.definition} does not exist`);continue;}
    const actual=importSites(root,code.definition),listed=[...code.importSites].sort();
    for(const site of actual.filter(s=>!listed.includes(s)))failures.push(`${id}: ${site} imports ${code.definition} but is not listed as a use`);
    for(const site of listed.filter(s=>!actual.includes(s)))failures.push(`${id}: ${site} is listed as a use of ${code.definition} but does not import it`);
    // Several registered exceptions can name the same stylesheet; their classes add up.
    const allowed=new Map();
    for(const p of family.privateStyles??[]){const key=path.join(root,p.file);allowed.set(key,new Set([...(allowed.get(key)??[]),...p.classes]));}
    for(const file of modules){
      if(file===path.join(root,code.stylesheet))continue;
      const classes=new Set();
      postcss.parse(fs.readFileSync(file,'utf8')).walkRules(rule=>{for(const [,name] of rule.selector.matchAll(/\.([a-zA-Z_][\w-]*)/g))if(code.blocks.includes(blockOf(name)))classes.add(name);});
      for(const name of classes)if(!allowed.get(file)?.has(name))failures.push(`${path.relative(root,file)}: private style .${name} redefines the shared ${id} block "${blockOf(name)}" owned by ${code.stylesheet}`);
    }
    for(const [file,names] of allowed){
      const present=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
      for(const name of names)if(!new RegExp(`\\.${name}(?![\\w-])`).test(present))failures.push(`${id}: registered exception .${name} no longer exists in ${path.relative(root,file)}; remove it from the registry`);
    }
    notes.push(`${id} ${family.title}: ${actual.length} import ${actual.length===1?'site':'sites'}`);
  }
  // 5. The code export and the Paper instances come from the same version of each master.
  if(!lock)failures.push('design/paper/link-lock.json is missing: Paper has never been synchronised');
  else{
    const registered=new Set();
    for(const [id,spec] of Object.entries(registry.masters))for(const entry of spec.instances??[]){
      const key=instanceId(entry);registered.add(key);const known=lock.instances[key];
      if(!known)failures.push(`${key}: registered instance of ${id} has never been synchronised`);
      else if(record?.masters[id]&&known.masterHash!==record.masters[id].hash)failures.push(`${key}: synchronised to a different version of the ${id} master than the one exported to code`);
    }
    for(const key of Object.keys(lock.instances))if(!registered.has(key))failures.push(`${key}: in the lock but no longer registered`);
  }
  const instances=Object.values(registry.masters).reduce((n,m)=>n+(m.instances?.length??0),0);
  return {failures,notes,summary:`${Object.keys(registry.masters).length} Paper masters with ${instances} synchronised instances; ${used.size} exported component values in use; ${Object.keys(registry.families??{}).length} families checked for a single definition`};
}
