import React from 'react';
import {createRoot} from 'react-dom/client';
import OrderView from '../../app/(accounts)/teacher/orders/[id]/view';
import AccountNav from '../../app/(accounts)/account-nav';
import shell from '../../app/(accounts)/accounts.module.css';
import {applyInterpretation} from '../../lib/configurator/brief';
import {evaluate,project} from '../../lib/configurator/engine';
import {previewCatalogue,previewConfiguration,previewDefinitions} from '../fixtures/configurator';
import type {Configuration} from '../../lib/configurator/contracts';
import type {Order} from '../../lib/jobs/contracts';
import '../../app/globals.css';
// Isolated UI harness: synthetic definitions evaluated in this page only. The real
// application evaluates on the server and never ships the engine to browsers.
// ?paid=0 opens the order awaiting payment; "I have paid: check again" simulates the
// server confirming payment, which unlocks the detailed questions without a reload.
const params=new URLSearchParams(location.search);let paid=params.get('paid')!=='0';
const defs=previewDefinitions();let cfg:Configuration=structuredClone(previewConfiguration);let revision=1;let submitted=false;
if(params.get('many')==='1'){
 const structured=structuredClone(defs.lines[1]),mcq=structuredClone(defs.lines[2]);
 const marks=[18,16,27,15,16,14,10,14];
 defs.lines=Array.from({length:18},(_,i)=>({...structuredClone(i<10?mcq:structured),id:`q${i+1}`,
  title:i<10?`Synthetic multiple-choice question ${i+1}`:`Synthetic structured question ${i-8}: interpreting relationships and explaining results`,
  ...(i<10?{}:{range:{min:8,max:30}})}));
 cfg={schemaVersion:1,targets:{paper:150,sections:{multiple_choice:20,structured:130}},lines:Object.fromEntries(defs.lines.map((l,i)=>[l.id,{marks:i<10?2:marks[i-10],parts:null,facets:{}}])),answers:{items:{},paper:{}}};
}
// ?long=1 stretches the catalogue reminder to check it never buries the teacher's brief.
const catalogue=structuredClone(previewCatalogue);
if(params.get('long')==='1'){catalogue['structured:SYN-02']={...catalogue['structured:SYN-02'],topic:'A deliberately long synthetic topic name that has to wrap across several lines in the panel',
 description:'A deliberately long synthetic description. '.repeat(8).trim()};defs.lines[1].title='A deliberately long synthetic question title that wraps across more than one line in the editor heading';}
const id='00000000-0000-4000-8000-0000000000c5';
const order=():Order=>({id,title:'Grade 11 Physical Sciences paper',moduleId:'synthetic-module',release:'1',internalTest:false,createdAt:'',updatedAt:'',configurable:true,
 state:submitted?'queued':paid?'awaiting_answers':'awaiting_payment',form:null,answers:null,documents:[],
 payment:{status:paid?'paid':'open',amountMinor:10000,currency:'zar',testMode:true,checkoutUrl:null,needsAttention:false}});
const view=()=>project(defs,cfg,evaluate(defs,cfg,{paid}),{orderId:id,state:submitted?'queued':paid?'awaiting_answers':'awaiting_payment',paymentStatus:paid?'paid':'open',revision,submitted});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
window.fetch=async(input,options)=>{
 const url=String(input);
 if(url.endsWith('/configuration/interpret')){
  const body=JSON.parse(String(options?.body));if(body.revision!==revision)return reply({error:'This paper changed elsewhere.'},409);
  if(params.get('briefFailure')==='1')return reply({error:'Your brief is saved. Try again or choose options yourself.'},503);
  cfg=applyInterpretation(cfg,body.lineId,{setting:{kind:'choice',choiceId:'one'},shade:{kind:'choice',choiceId:'blue'}});revision++;
  return reply({...view(),briefEnabled:true});
 }
 if(url.endsWith('/configuration/hints')){
  return reply({status:'checked',hints:[{checkId:'synthetic-note-conflict',field:'note',text:'Your synthetic note may conflict with the selected setting.'}]});
 }
 if(url.endsWith('/payment')){const action=JSON.parse(String(options?.body??'{}')).action;if(action==='reconcile')paid=true;return reply(order());}
 if(url.endsWith('/configuration/submit')){submitted=true;return reply({ok:true});}
 if(url.includes('/configuration')){
  if(options?.method==='PUT'){const body=JSON.parse(String(options.body));if(body.revision!==revision)return reply({error:'This paper changed in another tab or window. Your edits are still on this page.'},409);cfg=body.configuration;revision++;}
  return reply({...view(),briefEnabled:params.get('brief')==='1',...(params.get('jev')==='1'?{advice:{enabled:true,lineIds:defs.lines.map(l=>l.id)}}:{})});
 }
 if(url.startsWith(`/api/teacher/orders/${id}`)) return reply(order());
 throw new Error('Only synthetic order requests are supported');
};
// Lets the browser check simulate another tab saving first (stale-tab refusal).
(window as unknown as {simulateOtherTab:()=>void}).simulateOtherTab=()=>{revision++;};
createRoot(document.getElementById('root')!).render(<>
 <div style={{padding:'10px 24px',background:'#1A1A2E',color:'white',textAlign:'center',fontSize:14}}>Local demonstration · synthetic questions · nothing is saved or charged</div>
 <div className={shell['site-shell']}><AccountNav path="/teacher/orders/synthetic"/><main className={shell['page-body']}><OrderView initial={order()} catalogue={catalogue}/></main></div></>);
