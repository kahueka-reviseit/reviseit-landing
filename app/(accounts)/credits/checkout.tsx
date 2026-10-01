'use client';
import {useRef,useState} from 'react';
import {formatRand,pricePaper} from '../../../lib/credits/pricing';
import type {PaperModel} from '../teacher/paper/model';
import {button} from '../system/button';
import {Notice} from '../system/notice';
type Quote={quoteId:string;amountMinor:number;balanceMinor:number;expiresAt:string;mode:string};
export function CreditCheckout({paper}:{paper:PaperModel}){
 const [quote,setQuote]=useState<Quote|null>(null),[previous,setPrevious]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const key=useRef<string>('');let estimate:number|null=null;
 try{estimate=pricePaper(paper.mcqCount,paper.sectionTotal('structured')).totalMinor;}catch{}
 async function refresh(){setBusy(true);setError('');try{
 const r=await fetch('/api/credits/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey:crypto.randomUUID(),moduleId:paper.data.module!.id,selectionRevision:paper.data.selection.revision,allocations:paper.allocation,
 targets:{paper:paper.paperTarget,...(Object.keys(paper.sectionTargets).length?{sections:paper.sectionTargets}:{})}})});
 const value=await r.json();if(!r.ok)throw new Error(value.error);key.current=crypto.randomUUID();setQuote(value);setUncertain(false);
 }catch(e){setError(e instanceof Error?e.message:'Price unavailable.');}finally{setBusy(false);}}
 async function create(){if(!quote)return;setBusy(true);setError('');try{
 const r=await fetch('/api/credits/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quoteId:quote.quoteId,requestKey:key.current})});
 const value=await r.json();if(!r.ok){if(value.code==='quote_changed'||value.code==='balance_changed'){setPrevious(quote.amountMinor);setQuote(null);setUncertain(false);}else setUncertain(true);throw new Error(value.error);}
 window.location.assign(`/teacher/orders/${value.orderId}`);
 }catch(e){setError(e instanceof Error?e.message:'Creation could not be confirmed. Retry to check its outcome.');setUncertain(true);}finally{setBusy(false);}}
 return <><p>From department credit</p><h2>{estimate===null?'Check your marks':formatRand(quote?.amountMinor??estimate)}</h2>
 {error&&<Notice tone="problem" role="alert">{error}</Notice>}
 {quote?<><p>Department balance: {formatRand(quote.balanceMinor)}{quote.mode==='test'?' · test credit':''}</p>
 {previous!==null&&previous!==quote.amountMinor&&<Notice tone="caution">The price changed from {formatRand(previous)} to {formatRand(quote.amountMinor)}. Nothing has been charged. Accept the new price to continue.</Notice>}
 {quote.balanceMinor<quote.amountMinor?<Notice tone="caution">Your department needs more credit before this paper can be created.</Notice>:<p>After creation: {formatRand(quote.balanceMinor-quote.amountMinor)}</p>}
 <button disabled={busy||quote.balanceMinor<quote.amountMinor} className={button('primary',{full:true})} onClick={create}>{busy?'Confirming…':uncertain?'Check creation outcome':`Accept ${formatRand(quote.amountMinor)} and create paper`}</button></>:
 <button disabled={busy||!paper.canPay||estimate===null} className={button('primary',{full:true})} onClick={refresh}>{busy?'Checking price…':'Review department price'}</button>}
 <p>Your total marks and accepted price stay fixed after creation. You can still redistribute marks and edit question details before submitting.</p><p>No credit is taken until you accept the quoted price. <a href="/teacher/department">View department</a></p></>;
}
