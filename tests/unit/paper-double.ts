/**
 * An in-memory double of the Paper tools the synchronisation uses. It stores files of
 * named layers with styles and text, and answers the same tool names with the same
 * result shapes, so the real planning and application code runs unchanged in tests.
 */
type Node = {id:string;name:string;type:'Frame'|'Text';styles:Record<string,string|number>;text?:string;children:Node[];parent?:Node};
type Token = {name:string;type:string;value:string;description?:string};
const camel=(prop:string)=>prop.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());

export function paperDouble() {
  let serial=0;const files=new Map<string,{name:string;pages:Map<string,{name:string;root:Node}>;tokens:Token[]}>();
  const index=new Map<string,Map<string,Node>>();
  const calls:{tool:string;args:any}[]=[];
  /** Paper sometimes adds a layout style to a layer it moves; tests can switch that behaviour on. */
  const quirks={moveAddsWidth:false};
  const register=(file:string,node:Node)=>{index.get(file)!.set(node.id,node);node.children.forEach(c=>{c.parent=node;register(file,c);});};
  const find=(file:string,id:string)=>{const node=index.get(file)?.get(id);if(!node)throw new Error(`Node ${id} not found`);return node;};
  function parse(html:string):Node[] {
    const out:Node[]=[];let rest=html.trim();
    while(rest.startsWith('<div')){
      const open=rest.match(/^<div layer-name="([^"]*)" style="([^"]*)">/)!;let depth=1,at=open[0].length;
      while(depth){const o=rest.indexOf('<div',at),c=rest.indexOf('</div>',at);if(o>=0&&o<c){depth++;at=o+4;}else{depth--;at=c+6;}}
      const inner=rest.slice(open[0].length,at-6);
      const styles=Object.fromEntries(open[2].split(';').filter(Boolean).map(d=>{const i=d.indexOf(':');return [camel(d.slice(0,i)),d.slice(i+1)];}));
      const children=inner.trim().startsWith('<div')?parse(inner):[];
      out.push({id:`n${++serial}`,name:open[1],type:children.length||!inner?'Frame':'Text',styles,text:children.length||!inner?undefined:inner.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'),children});
      rest=rest.slice(at).trim();
    }
    return out;
  }
  const summary=(node:Node,depth=0):string=>`${'  '.repeat(depth)}${node.type} "${node.name}" (${node.id}) ?×?${node.type==='Text'?` "${(node.text??'').slice(0,60)}"`:''}\n`+node.children.map(c=>summary(c,depth+1)).join('');
  const tools:Record<string,(a:any)=>any>={
    get_tree_summary:a=>({summary:summary(find(a.fileId,a.nodeId))}),
    get_computed_styles:a=>({styles:Object.fromEntries(a.nodeIds.map((id:string)=>[id,{...find(a.fileId,id).styles}]))}),
    get_node_info:a=>({id:a.nodeId,textContent:find(a.fileId,a.nodeId).text??null}),
    get_children:a=>({children:find(a.fileId,a.nodeId).children.map(c=>({id:c.id,name:c.name}))}),
    get_basic_info:a=>({pages:[...files.get(a.fileId)!.pages].map(([id,p])=>({id,name:p.name}))}),
    update_styles:a=>{for(const u of a.updates)for(const id of u.nodeIds){const node=find(a.fileId,id);for(const [k,v] of Object.entries(u.styles)){if(v==='')delete node.styles[k];else node.styles[k]=v as string;}}return {updates:a.updates.length};},
    set_text_content:a=>{for(const u of a.updates)find(a.fileId,u.nodeId).text=u.textContent;return {};},
    write_html:a=>{const parent=find(a.fileId,a.targetNodeId),made=parse(a.html);for(const n of made){n.parent=parent;parent.children.push(n);register(a.fileId,n);}
      const flat:Node[]=[];const walk=(n:Node)=>{flat.push(n);n.children.forEach(walk);};made.forEach(walk);return {createdNodes:flat.map(n=>({id:n.id,name:n.name}))};},
    delete_nodes:a=>{for(const id of a.nodeIds){const node=find(a.fileId,id);node.parent!.children=node.parent!.children.filter(c=>c!==node);const drop=(n:Node)=>{index.get(a.fileId)!.delete(n.id);n.children.forEach(drop);};drop(node);}return {deletedNodeIds:a.nodeIds};},
    move_nodes:a=>{for(const m of a.moves){const node=find(a.fileId,m.nodeId);node.parent!.children=node.parent!.children.filter(c=>c!==node);
      if(m.after){const sibling=find(a.fileId,m.after),list=sibling.parent!.children;list.splice(list.indexOf(sibling)+1,0,node);node.parent=sibling.parent;}
      else{const parent=find(a.fileId,m.parentId);parent.children.splice(m.index??parent.children.length,0,node);node.parent=parent;}
      if(quirks.moveAddsWidth&&node.type==='Text')node.styles.width='max-content';}return {};},
    get_tokens:a=>({tokens:files.get(a.fileId)!.tokens.filter(t=>!a.namePattern||t.name===a.namePattern).map(t=>({...t}))}),
    create_tokens:a=>{files.get(a.fileId)!.tokens.push(...a.tokens.map((t:Token)=>({...t})));return {};},
    set_tokens:a=>{const file=files.get(a.fileId)!;for(const t of a.tokens){if(t.delete)file.tokens=file.tokens.filter(x=>x.name!==t.name);else file.tokens.find(x=>x.name===t.name)!.value=t.value;}return {};},
    finish_working_on_nodes:()=>({}),
  };
  return {
    calls,quirks,
    json:async(tool:string,args:any)=>{calls.push({tool,args});if(!tools[tool])throw new Error(`The double has no tool ${tool}`);return tools[tool](args);},
    tokenHash:async(fileId:string)=>JSON.stringify(files.get(fileId)!.tokens).length.toString(16),
    close(){},
    /** Adds a file with one page per entry; each page lists artboards written as HTML. */
    addFile(id:string,name:string,pages:Record<string,string[]>,tokens:Token[]=[]){
      index.set(id,new Map());const made=new Map<string,{name:string;root:Node}>();
      for(const [pageId,artboards] of Object.entries(pages)){const root:Node={id:`root_node_${pageId}`,name:'',type:'Frame',styles:{},children:[]};
        for(const html of artboards)for(const n of parse(html)){n.parent=root;root.children.push(n);}
        register(id,root);made.set(pageId,{name:pageId,root});}
      files.set(id,{name,pages:made,tokens:tokens.map(t=>({...t}))});
    },
    /** First node with this layer name in the file, for writing readable tests. */
    node(file:string,name:string,nth=0){return [...index.get(file)!.values()].filter(n=>n.name===name)[nth];},
    edit(file:string,name:string,styles:Record<string,string>,nth=0){Object.assign(this.node(file,name,nth).styles,styles);},
    tokens:(file:string)=>files.get(file)!.tokens,
  };
}
