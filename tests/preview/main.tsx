import React from 'react';
import {createRoot} from 'react-dom/client';
import WorkspaceView from '../../app/(accounts)/teacher/workspace';
import AccountNav from '../../app/(accounts)/account-nav';
import shell from '../../app/(accounts)/accounts.module.css';
import {workspace,sampleWorkspace} from '../fixtures/workspace';
import {paperCurriculum,paperWorkspace} from '../fixtures/paper-catalogue';
import {denseWorkspace} from '../fixtures/dense-catalogue';
import {searchTerms} from '../../lib/workspace/catalogue';
import type { Workspace } from '../../lib/workspace/contracts';
import '../../app/globals.css';
// Isolated UI harness: synthetic data only, no authentication bypass in the actual app.
// Default: the realistic synthetic paper catalogue (configurator on, purchasing open).
// ?data=demo keeps the original three-entry demonstration catalogue; ?data=dense uses the
// pilot's real catalogue shape (89 entries, 81 topic labels, 73 used once).
const params=new URLSearchParams(location.search);
const legacy=params.get('data')==='demo', dense=params.get('data')==='dense';
const store='reviseit-workspace-demo'+(legacy?'':dense?'-dense':'-paper');
const saved:Record<string,Workspace>=JSON.parse(localStorage.getItem(store) || '{}');
const base=(id:string)=>legacy?sampleWorkspace(id):dense?denseWorkspace:paperCurriculum(id);
const curricula=legacy?workspace.curricula:dense?denseWorkspace.curricula:paperWorkspace.curricula;
// ?configurator=1 on the legacy data adds one synthetic multiple-choice type and the editable path.
const configurator=legacy && params.get('configurator')==='1';
const withConfigurator=(w:Workspace):Workspace=>configurator?{...w,purchase:{available:true,amountMinor:10000,currency:'zar',configurator:true},
 entries:[...w.entries,{id:'mcq:DEMO_MCQ',title:'Synthetic option type',topic:'Mechanics',description:'A synthetic two-mark option item.',marks:{min:2,max:2},orderable:true}]}:w;
const get=(id:string)=>withConfigurator({...base(id),...(saved[id] ? {formatting:saved[id].formatting,selection:saved[id].selection}: {})});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
window.fetch=async(input,options)=>{
 const url=String(input);
 if(url.startsWith('/api/teacher/catalogue/search')) {
  const terms=searchTerms(new URL(url,location.origin).searchParams.get('q') || '');
  const matches=curricula.flatMap(module=>base(module.id).entries.filter(entry=>terms.every(t=>[module.id,module.name,entry.id,entry.title,entry.topic,entry.description].join(' ').toLowerCase().includes(t))).map(entry=>({module,entry})));
  return reply({matches:matches.slice(0,50),hasMore:matches.length>50});
 }
 // Synthetic checkout: no Stripe. It opens the synthetic order page awaiting payment.
 if(url.startsWith('/api/teacher/checkout')) return reply({orderId:'00000000-0000-4000-8000-0000000000c5',checkoutUrl:'/configurator.html?paid=0'});
 if(!url.startsWith('/api/teacher/workspace')) throw new Error('Only synthetic workspace requests are supported');
 if(options?.method==='PUT'){
  const body=JSON.parse(String(options.body)),current=get(body.moduleId);
  saved[body.moduleId]=body.kind==='selection'?{...current,selection:{revision:body.revision+1,release:body.release,entryIds:body.entryIds}}:{...current,formatting:{revision:body.revision+1,preferences:body.preferences}};
  localStorage.setItem(store,JSON.stringify(saved));return reply({revision:body.revision+1});
 }
 return reply(get(new URL(url,location.origin).searchParams.get('curriculum') || curricula[0].id));
};
createRoot(document.getElementById('root')!).render(<>
 <div style={{padding:'10px 24px',background:'#1A1A2E',color:'white',textAlign:'center',fontSize:14}}>Local demonstration · synthetic catalogue and school · changes saved only in this browser</div>
 <div className={shell.shell}><AccountNav path="/teacher"/><main className={shell.main}><WorkspaceView initial={get(curricula[0].id)}/></main></div></>);
