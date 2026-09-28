import React from 'react';
import {createRoot} from 'react-dom/client';
import PaperList from '../../app/(accounts)/teacher/orders/list';
import OrderView from '../../app/(accounts)/teacher/orders/[id]/view';
import {TeacherHeader} from '../../app/(accounts)/shell';
import ui from '../../app/(accounts)/experience.module.css';
import {evaluate,project} from '../../lib/configurator/engine';
import {previewConfiguration,previewDefinitions,previewCatalogue} from '../fixtures/configurator';
import type {Configuration} from '../../lib/configurator/contracts';
import type {Order,OrderPayment} from '../../lib/jobs/contracts';
import '../../app/globals.css';
// Isolated UI harness for My papers and the paper status page (Paper M1 to M4).
// Synthetic orders only; no authentication bypass exists in the real application.
// ?screen=papers|order  ?state=<order state>  ?payment=<status>  ?attention=1  ?empty=1  ?failed=1  ?summary=fail
const params=new URLSearchParams(location.search);
const pay=(status:OrderPayment['status'],extra:Partial<OrderPayment>={}):OrderPayment=>({status,amountMinor:10000,currency:'zar',testMode:true,checkoutUrl:status==='open'?'#synthetic-checkout':null,needsAttention:false,...extra});
const base=(id:string,state:string,payment:OrderPayment|null,created:string,title='Catalogue paper'):Order=>({id:`00000000-0000-4000-8000-0000000000${id}`,title,moduleId:'synthetic-module',release:'1',internalTest:false,state,createdAt:created,updatedAt:created,form:null,answers:null,
 documents:state==='released'?['paper','memo','learner-memo','teacher-description']:[],payment,configurable:true});
const orders:Order[]=[
 base('a1','released',pay('paid'),'2026-09-21T09:00:00+02:00'),
 base('a2','awaiting_answers',pay('paid'),'2026-09-26T09:00:00+02:00'),
 base('a3','rendering',pay('paid'),'2026-09-22T09:00:00+02:00'),
 base('a4','awaiting_payment',pay('open'),'2026-09-27T09:00:00+02:00'),
 base('a5','awaiting_payment',pay('cancelled'),'2026-09-20T09:00:00+02:00'),
 base('a6','held',pay('paid'),'2026-09-19T09:00:00+02:00','A deliberately long synthetic paper name that has to wrap across more than one line in the list'),
 base('a7','awaiting_answers',pay('refunded'),'2026-09-18T09:00:00+02:00'),
];
const curricula={'synthetic-module':'Synthetic Grade 11 curriculum'};
const defs=previewDefinitions();
const cfg:Configuration={...structuredClone(previewConfiguration),briefs:{q1:{text:'A crate is pushed up a synthetic ramp. Learners should work out the acceleration and explain the result in their own words.',interpretedText:null,suggestions:{},resolutions:{}}},
 answers:{items:{q1:{setting:{kind:'choice',choiceId:'two'},shade:{kind:'automatic'}},q3:{emphasis:{kind:'choice',choiceId:'balanced'}}},paper:{}}};
const state=params.get('state')||'rendering';
const payment=params.get('payment') as OrderPayment['status']|null;
const order:Order={...base('c5',state,pay(payment||(state==='awaiting_payment'?'open':'paid'),{needsAttention:params.get('attention')==='1'}),'2026-09-28T09:00:00+02:00'),
 configurable:params.get('legacy')!=='1'};
const view=()=>project(defs,cfg,evaluate(defs,cfg,{paid:true}),{orderId:order.id,state,paymentStatus:'paid',revision:3,submitted:!['awaiting_payment','awaiting_answers'].includes(state)});
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
window.fetch=async input=>{const url=String(input);
 if(url.endsWith('/configuration')) return params.get('summary')==='fail'?reply({error:'unavailable'},503):reply(view());
 if(url.includes('/api/teacher/orders/')) return reply(order);
 throw new Error('Only synthetic requests are supported');};
const screen=params.get('screen')||'papers';
createRoot(document.getElementById('root')!).render(<div className={ui['site-shell']}>
 <TeacherHeader current="papers" name="Synthetic Teacher"/>
 <main className={ui['site-shell__main']}>{screen==='papers'
  ?<PaperList orders={params.get('empty')==='1'?[]:orders} failed={params.get('failed')==='1'} curricula={curricula} school="Synthetic Secondary School · Physical Sciences"/>
  :<OrderView initial={order} curriculum="Synthetic Grade 11 curriculum" catalogue={previewCatalogue}/>}</main>
 <footer className={ui['site-footer']}>Need help? <a href="mailto:kahueka@reviseit.io">kahueka@reviseit.io</a></footer></div>);
