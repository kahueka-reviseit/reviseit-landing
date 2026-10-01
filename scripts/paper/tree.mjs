/**
 * Reads a Paper node and its descendants into a plain tree:
 * {id,name,type,styles,text?,children}. Styles are Paper's own computed values, so a
 * token binding stays a `var(--token)` reference instead of a resolved number.
 */
const LINE=/^(\s*)(\S+) "((?:[^"\\]|\\.)*)" \(([^)]+)\)/;

export function parseSummary(summary) {
  const root={children:[]},stack=[{depth:-1,node:root}];
  for(const line of summary.split('\n')){
    const m=line.match(LINE);if(!m)continue;
    const node={id:m[4],name:m[3],type:m[2],children:[]},depth=m[1].length/2;
    while(stack[stack.length-1].depth>=depth)stack.pop();
    stack[stack.length-1].node.children.push(node);stack.push({depth,node});
  }
  return root.children[0];
}
export const walk=(node,visit,parent=null)=>{visit(node,parent);node.children.forEach(child=>walk(child,visit,node));};

/**
 * Paper describes an auto-width text either as `white-space: pre` alone or with an added
 * `width: max-content`, depending on how the layer was created. Both render identically and
 * the width cannot be removed, so it is not treated as a difference.
 */
function normalise(node,styles) {
  if(node.type==='Text'&&styles.whiteSpace==='pre'&&styles.width==='max-content'){const {width,...rest}=styles;return rest;}
  return styles;
}

export async function readTree(paper,fileId,nodeId) {
  const {summary}=await paper.json('get_tree_summary',{fileId,nodeId,depth:10});
  const tree=parseSummary(summary);if(!tree)throw new Error(`Paper node ${nodeId} was not found in ${fileId}`);
  const nodes=[];walk(tree,n=>nodes.push(n));
  for(let i=0;i<nodes.length;i+=40){
    const batch=nodes.slice(i,i+40);
    const {styles}=await paper.json('get_computed_styles',{fileId,nodeIds:batch.map(n=>n.id)});
    for(const n of batch)n.styles=normalise(n,styles[n.id]??{});
  }
  for(const n of nodes)if(n.type==='Text')n.text=(await paper.json('get_node_info',{fileId,nodeId:n.id})).textContent??'';
  return tree;
}

const kebab=prop=>prop.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
/** HTML that recreates a master subtree in any file, with the same layer names and token bindings. */
export function toHtml(node) {
  const style=Object.entries(node.styles).map(([k,v])=>`${kebab(k)}:${String(v).replace(/"/g,"'")}`).join(';');
  const inner=node.type==='Text'?escape(node.text??''):node.children.map(toHtml).join('');
  return `<div layer-name="${node.name}" style="${style}">${inner}</div>`;
}
