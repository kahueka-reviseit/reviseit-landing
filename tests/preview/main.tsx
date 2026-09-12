import React from 'react';
import {createRoot} from 'react-dom/client';
import WorkspaceView from '../../app/(accounts)/teacher/workspace';
import {workspace,sampleWorkspace} from '../fixtures/workspace';
import {searchTerms} from '../../lib/workspace/catalogue';
import type { Workspace } from '../../lib/workspace/contracts';
import '../../app/globals.css';
// Isolated UI harness: sample data only, no authentication bypass in the actual app.
const saved:Record<string,Workspace>=JSON.parse(localStorage.getItem('reviseit-workspace-demo') || '{}');
const get=(id:string)=>({...sampleWorkspace(id),...(saved[id] ? {formatting:saved[id].formatting,selection:saved[id].selection}: {})});
window.fetch=async(input,options)=>{
 const url=String(input);
 if(url.startsWith('/api/teacher/catalogue/search')) {
  const terms=searchTerms(new URL(url,location.origin).searchParams.get('q') || '');
  const matches=workspace.curricula.flatMap(module=>sampleWorkspace(module.id).entries.filter(entry=>terms.every(t=>[module.id,module.name,entry.id,entry.title,entry.topic,entry.description].join(' ').toLowerCase().includes(t))).map(entry=>({module,entry})));
  return new Response(JSON.stringify({matches:matches.slice(0,50),hasMore:matches.length>50}));
 }
 if(!url.startsWith('/api/teacher/workspace')) throw new Error('Only synthetic workspace requests are supported');
 if(options?.method==='PUT'){
  const body=JSON.parse(String(options.body)),current=get(body.moduleId);
  saved[body.moduleId]=body.kind==='selection'?{...current,selection:{revision:body.revision+1,release:body.release,entryIds:body.entryIds}}:{...current,formatting:{revision:body.revision+1,preferences:body.preferences}};
  localStorage.setItem('reviseit-workspace-demo',JSON.stringify(saved));return new Response(JSON.stringify({revision:body.revision+1}));
 }
 return new Response(JSON.stringify(get(new URL(url,location.origin).searchParams.get('curriculum') || workspace.module!.id)));
};
createRoot(document.getElementById('root')!).render(<><div style={{padding:'10px 24px',background:'#1A1A2E',color:'white',textAlign:'center'}}>Local demonstration · sample school · changes saved only in this browser</div><div style={{borderTop:'6px solid #5B8A72',maxWidth:1080,margin:'auto',padding:'24px'}}><WorkspaceView initial={get(workspace.module!.id)}/></div></>);
