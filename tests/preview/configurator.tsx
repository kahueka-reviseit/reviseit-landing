import React from 'react';
import {createRoot} from 'react-dom/client';
import OrderView from '../../app/(accounts)/teacher/orders/[id]/view';
import AccountNav from '../../app/(accounts)/account-nav';
import shell from '../../app/(accounts)/accounts.module.css';
import {applyInterpretation} from '../../lib/configurator/brief';
import {evaluate,project} from '../../lib/configurator/engine';
import {previewConfiguration,previewDefinitions} from '../fixtures/configurator';
import type {Configuration} from '../../lib/configurator/contracts';
import type {Order} from '../../lib/jobs/contracts';
import '../../app/globals.css';
// Isolated UI harness: synthetic definitions evaluated in this page only. The real
// application evaluates on the server and never ships the engine to browsers.
// ?paid=0 opens the order awaiting payment; "I have paid: check again" simulates the
// server confirming payment, which unlocks the detailed questions without a reload.
const params=new URLSearchParams(location.search);let paid=params.get('paid')!=='0';
const defs=previewDefinitions();let cfg:Configuration=structuredClone(previewConfiguration);let revision=1;let submitted=false;
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
 <div className={shell['site-shell']}><AccountNav path="/teacher/orders/synthetic"/><main className={shell['page-body']}><OrderView initial={order()}/></main></div></>);
