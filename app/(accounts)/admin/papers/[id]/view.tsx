'use client';
import { useState } from 'react';
import Link from 'next/link';
import { documents,documentLabels } from '../../../../../lib/jobs/contracts';
import styles from '../../../accounts.module.css';
export default function ReviewView({order}:{order:any}){
 const [note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const memo=order.state==='awaiting_memo_review';
 async function decide(approve:boolean){setBusy(true);try{const r=await fetch(`/api/admin/papers/${order.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage:memo?'memo':'release',hash:memo?order.memoHash:order.packHash,approve,note})});if(!r.ok){setError((await r.json()).error);return;}window.location.assign('/admin/papers');}catch{setError('Decision could not be confirmed. Refresh before trying again.');}finally{setBusy(false);}}
 return <section className={`${styles.card} ${styles.wide}`}><Link href="/admin/papers">All reviews</Link><h1>{order.title}</h1><h2>{memo?'Review the memorandum':'Inspect all four documents'}</h2><p>School reference: {order.schoolId}</p>{memo?<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:600,overflow:'auto'}}>{order.memo}</pre>:<ul>{documents.map(n=><li key={n}><a href={`/api/teacher/orders/${order.id}/documents/${n}?review=true`}>{documentLabels[n]}</a></li>)}</ul>}<p>Version: <code style={{overflowWrap:'anywhere'}}>{memo?order.memoHash:order.packHash}</code></p>
 <label style={{display:'block'}}>Review evidence<textarea value={note} onChange={e=>setNote(e.target.value)} minLength={10} maxLength={2000} style={{display:'block',width:'100%'}}/></label><label style={{display:'block',margin:'20px 0'}}><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> {memo?'I have checked the question, calculations, marking guidance and memorandum.':'I have inspected all four documents and approve this version for release.'}</label>
 {error&&<p role="alert">{error}</p>}<button disabled={busy||!confirmed||note.trim().length<10} onClick={()=>void decide(true)}>{memo?'Approve memorandum':'Release four documents'}</button>{' '}<button disabled={busy||note.trim().length<10} onClick={()=>void decide(false)}>Hold for correction</button></section>;
}
