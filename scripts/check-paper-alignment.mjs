import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import postcss from 'postcss';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'design/paper/snapshot.json'),'utf8'));
const failures=[];
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=walk(path.join(root,'app'));
const classes=new Map();
const bem=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
for(const file of files.filter(f=>f.endsWith('.module.css'))){
  const names=new Set();
  postcss.parse(fs.readFileSync(file,'utf8')).walkRules(rule=>{
    for(const [,name] of rule.selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)){
      names.add(name);
      if(!bem.test(name))failures.push(`${path.relative(root,file)}: non-BEM selector ${name}`);
    }
  });
  classes.set(file,names);
}
let references=0;
for(const file of [...files,...walk(path.join(root,'tests'))].filter(f=>/\.tsx?$/.test(f))){
  const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const imports=new Map();
  tree.forEachChild(n=>{
    if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier)&&n.importClause?.name){
      const css=path.resolve(path.dirname(file),n.moduleSpecifier.text);
      if(classes.has(css))imports.set(n.importClause.name.text,classes.get(css));
    }
  });
  const visit=node=>{
    let alias,key;
    if(ts.isPropertyAccessExpression(node)&&ts.isIdentifier(node.expression)){alias=node.expression.text;key=node.name.text;}
    if(ts.isElementAccessExpression(node)&&ts.isIdentifier(node.expression)&&ts.isStringLiteral(node.argumentExpression)){alias=node.expression.text;key=node.argumentExpression.text;}
    if(imports.has(alias)&&key){references++;if(!imports.get(alias).has(key))failures.push(`${path.relative(root,file)}: missing CSS class ${alias}[${key}]`);}
    ts.forEachChild(node,visit);
  };
  visit(tree);
}
const declarations={};
postcss.parse(fs.readFileSync(path.join(root,'app/paper-tokens.css'),'utf8')).walkDecls(d=>{declarations[d.prop]=d.value.replace(/^"|"$/g,'');});
for(const token of snapshot.tokens)if(declarations[token.name]!==token.value)failures.push(`Paper token differs: ${token.name}`);
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log(`${classes.size} stylesheet modules use BEM; ${references} static component references resolve; ${snapshot.tokens.length} tokens match the recorded Paper export.`);
