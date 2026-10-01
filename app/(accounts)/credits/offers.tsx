'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {formatRand} from '../../../lib/credits/pricing';
import {Notice} from '../system/notice';
import {button} from '../system/button';
import s from './credits.module.css';
export type Offer={id:string;title:string;amountMinor:number;claimBy:string;useBy:string;claimed:boolean;available:boolean};
export function Offers({offers}:{offers:Offer[]}){
 const router=useRouter();const keys=useRef<Record<string,string>>({});const [busy,setBusy]=useState(''),[error,setError]=useState('');
 async function claim(id:string){setBusy(id);setError('');keys.current[id]??=crypto.randomUUID();try{
 const r=await fetch('/api/credits/offers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'claim',offerId:id,requestKey:keys.current[id]})});const v=await r.json();if(!r.ok)throw new Error(v.error);router.refresh();
 }catch(e){setError(e instanceof Error?e.message:'Claim could not be confirmed. Retry to check.');}finally{setBusy('');}}
 return <>{error&&<Notice tone="problem" role="alert">{error}</Notice>}{offers.map(o=><section key={o.id} className={s['credit-card']}><div className={s['credit-card__body']}><div className={s['credit-card__label']}>DEPARTMENT OFFER</div><h2 className={s['credit-card__title']}>{o.title}</h2><p className={s['credit-card__balance']}>{formatRand(o.amountMinor)}</p><p>Claim by {new Date(o.claimBy).toLocaleDateString('en-ZA')} · Use by {new Date(o.useBy).toLocaleDateString('en-ZA')}</p>
 {o.claimed?<Notice tone="success">Your department has claimed this offer.</Notice>:o.available?<button className={button('primary')} disabled={!!busy} onClick={()=>claim(o.id)}>{busy===o.id?'Confirming…':'Claim department credit'}</button>:<p>This offer is not available to claim now.</p>}</div></section>)}</>;
}
