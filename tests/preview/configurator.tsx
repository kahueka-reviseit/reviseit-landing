import React from 'react';
import {createRoot} from 'react-dom/client';
import ConfigureOrder from '../../app/(accounts)/teacher/orders/[id]/configure';
import {evaluate,project} from '../../lib/configurator/engine';
import {previewConfiguration,previewDefinitions} from '../fixtures/configurator';
import type {Configuration} from '../../lib/configurator/contracts';
import '../../app/globals.css';
// Isolated UI harness: synthetic definitions evaluated in this page only. The real
// application evaluates on the server and never ships the engine to browsers.
const params=new URLSearchParams(location.search);const paid=params.get('paid')!=='0';
const defs=previewDefinitions();let cfg:Configuration=structuredClone(previewConfiguration);let revision=1;
const view=()=>project(defs,cfg,evaluate(defs,cfg,{paid}),{orderId:'synthetic',state:paid?'awaiting_answers':'awaiting_payment',paymentStatus:paid?'paid':'open',revision,submitted:false});
window.fetch=async(_input,options)=>{
 if(options?.method==='PUT'){const body=JSON.parse(String(options.body));if(body.revision!==revision)return new Response(JSON.stringify({error:'This paper changed in another tab or window.'}),{status:409});cfg=body.configuration;revision++;}
 return new Response(JSON.stringify(view()));
};
createRoot(document.getElementById('root')!).render(<><div style={{padding:'10px 24px',background:'#1A1A2E',color:'white',textAlign:'center'}}>Local demonstration · synthetic questions · nothing is saved</div>
 <div style={{borderTop:'6px solid #5B8A72',background:'#F8F6F0',minHeight:'100vh'}}><div style={{maxWidth:1240,margin:'auto',padding:'24px'}}>
 <p style={{color:'#3B5F8A',letterSpacing:'0.12em',fontSize:13,fontWeight:600}}>SYNTHETIC PAPER · {paid?'PAID · COMPLETE CONFIGURATION':'AWAITING PAYMENT'}</p>
 <h1 style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:44,margin:'8px 0 4px'}}>{paid?'Finish your paper':'Review your marks'}</h1>
 <ConfigureOrder orderId="synthetic" onSubmitted={()=>alert('Submitted (demonstration)')}/></div></div></>);
