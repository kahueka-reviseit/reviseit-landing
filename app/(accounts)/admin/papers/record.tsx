'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ui from '../../experience.module.css';
export { FocusRow } from '../accounts/review';
/** Browser-only convenience (S5): copies the Stripe payment reference. No server action. */
export function CopyReference({value}:{value:string}) {
  const [copied,setCopied]=useState(false);
  return <button type="button" className={ui['button--secondary']} onClick={async()=>{try{await navigator.clipboard.writeText(value);setCopied(true);}catch{setCopied(false);}}}>{copied?'Payment reference copied':'Copy payment reference'}</button>;
}
/** Opening a record focuses its heading; Escape closes it and returns to the row. */
export function RecordKeys({closeHref}:{closeHref:string}) {
  const router=useRouter();
  useEffect(()=>{document.getElementById('paper-record-title')?.focus();},[closeHref]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')router.push(closeHref,{scroll:false});};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[closeHref,router]);
  return null;
}
