'use client';
import {useState,useRef} from 'react';
import {useRouter} from 'next/navigation';
import {moneyInput} from '../../../lib/credits/contracts';
import {formatRand} from '../../../lib/credits/pricing';
import {button} from '../system/button';
import {Notice} from '../system/notice';
import field from '../system/field.module.css';
import s from './credits.module.css';
export function GrantForm({departmentId}:{departmentId:string}){
 const router=useRouter();const [amount,setAmount]=useState(''),[kind,setKind]=useState('staff_grant'),[reference,setReference]=useState(''),[reason,setReason]=useState(''),[date,setDate]=useState('');
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const request=useRef<Record<string,unknown>|null>(null);const minor=moneyInput(amount);
 async function save(){setBusy(true);setError('');if(!request.current)request.current={departmentId,amount,kind,reference,reason,useBy:date?new Date(`${date}T23:59:59+02:00`).toISOString():null,requestKey:crypto.randomUUID()};try{
 const r=await fetch('/api/credits/grants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.current)});const data=await r.json();if(!r.ok)throw new Error(data.error||'Grant outcome unconfirmed.');
 setSaved(true);setConfirm(false);request.current=null;router.refresh();
 }catch(e){setError(e instanceof Error?e.message:'Grant outcome unconfirmed. Retry the same request.');}finally{setBusy(false);}}
 return <section className={s['credit-card']}><div className={s['credit-card__body']}><h2 className={s['credit-card__title']}>Add department credit</h2>
 {saved?<Notice tone="success" role="status">Credit added. The department balance has been updated.</Notice>:confirm?<><p>Add <strong>{formatRand(minor!)}</strong> as {kind==='paid_invoice'?'a paid invoice':'a staff grant'}?</p><p>{date?`Use by ${date}`:'No use-by date'} · {reason}</p>{error&&<Notice tone="problem" role="alert">{error}</Notice>}<div className={s['credit-card__actions']}><button disabled={busy} className={button('primary')} onClick={save}>{busy?'Confirming…':'Confirm credit'}</button>{!request.current&&<button disabled={busy} className={button('secondary')} onClick={()=>setConfirm(false)}>Back</button>}</div></>:<form className={s['credit-card__form']} onSubmit={e=>{e.preventDefault();if(minor!==null)setConfirm(true);}}>
 <label className={field.field}>Amount in rand<input className={field['field__input']} required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
 <label className={field.field}>Source<select className={field['field__select']} value={kind} onChange={e=>setKind(e.target.value)}><option value="staff_grant">Staff grant</option><option value="paid_invoice">Paid invoice</option></select></label>
 <label className={field.field}>Invoice or reference<input className={field['field__input']} required={kind==='paid_invoice'} maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></label>
 <label className={field.field}>Use by (optional)<input className={field['field__input']} type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
 <label className={field.field}>Private reason<textarea className={field['field__textarea']} required minLength={3} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <button disabled={minor===null} className={button('primary')}>Review credit</button></form>}
 </div></section>;
}
