'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {formatRand} from '../../../lib/credits/pricing';
import {Notice} from '../system/notice';
import {button} from '../system/button';
import field from '../system/field.module.css';
import s from './credits.module.css';
export function Topup({amounts,purchaseId}:{amounts:number[];purchaseId?:string}){
 const router=useRouter();const [amount,setAmount]=useState<number|null>(null),[reference,setReference]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const pending=useRef<{amountMinor:number;reference:string;requestKey:string}|null>(null);
 useEffect(()=>{if(!purchaseId)return;let cancelled=false;let timer:ReturnType<typeof setTimeout>;let attempts=0;
 async function check(){try{const r=await fetch(`/api/credits/purchases?id=${encodeURIComponent(purchaseId!)}`);const v=await r.json();if(cancelled)return;
 if(r.ok&&v.status==='paid'){setMessage('Your top-up is confirmed and department credit has been added.');router.refresh();return;}
 if(r.ok&&v.status==='attention'){setMessage('Your payment needs staff attention. Contact Revise It with your purchase reference.');return;}
 if(r.ok&&v.status==='expired'){setMessage('This checkout expired. No credit was added.');return;}
 setMessage('We are checking your payment. Returning here alone does not add credit.');if(++attempts<10)timer=setTimeout(check,3000);
 }catch{if(!cancelled)setMessage('Payment confirmation is unavailable. Your purchase reference is saved.');}}
 void check();return()=>{cancelled=true;clearTimeout(timer);};},[purchaseId,router]);
 async function buy(){if(amount===null)return;setBusy(true);setError('');pending.current??={amountMinor:amount,reference,requestKey:crypto.randomUUID()};try{
 const r=await fetch('/api/credits/purchases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending.current)});const v=await r.json();if(!r.ok){if(v.terminal)pending.current=null;throw new Error(v.error);}window.location.assign(v.checkoutUrl||`/teacher/department?purchase=${v.purchaseId}`);
 }catch(e){setError(e instanceof Error?e.message:'Checkout could not be confirmed. Retry the same request.');}finally{setBusy(false);}}
 return <section className={s['credit-card']}><div className={s['credit-card__body']}><h2 className={s['credit-card__title']}>Add credit</h2>{message&&<Notice tone="neutral" role="status">{message}</Notice>}{purchaseId&&<p>Purchase reference: {purchaseId}</p>}
 {amounts.length?<form className={s['credit-card__form']} onSubmit={e=>{e.preventDefault();void buy();}}><fieldset disabled={busy||!!pending.current}><legend>Choose an amount</legend>{amounts.map(n=><label key={n}><input type="radio" name="amount" checked={amount===n} onChange={()=>setAmount(n)}/>{formatRand(n)} </label>)}</fieldset><label className={field.field}>School reference (optional)<input className={field['field__input']} disabled={busy||!!pending.current} value={reference} maxLength={200} onChange={e=>setReference(e.target.value)}/></label>{error&&<Notice tone="problem" role="alert">{error}</Notice>}<button disabled={busy||amount===null} className={button('primary')}>{busy?'Opening…':'Continue to Stripe'}</button></form>:<p>Top-ups are not open yet. Revise It can help with department credit.</p>}
 </div></section>;
}
