'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import type {DepartmentMember} from '../../../lib/credits/contracts';
import {button} from '../system/button';
import {Notice} from '../system/notice';
import s from './credits.module.css';
export function MemberControls({members,staff=false}:{members:DepartmentMember[];staff?:boolean}){
 const router=useRouter();const [pending,setPending]=useState<{member:DepartmentMember;action:'role'|'spending'}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){if(!pending)return;setBusy(true);setError('');try{
 const r=await fetch('/api/credits/members',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:pending.member.userId,revision:pending.member.revision,action:pending.action,
 value:pending.action==='role'?(pending.member.role==='head'?'teacher':'head'):!pending.member.canSpend})});
 const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not change this member.');setPending(null);router.refresh();
 }catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}
 return <section className={s['credit-card']}><div className={s['credit-card__body']}><h2 className={s['credit-card__title']}>Members</h2></div>
 {members.map(m=><div key={m.userId} className={s['credit-card__row']}><div className={s['credit-card__primary']}>{m.name}<span className={s['credit-card__secondary']}>{m.email}</span></div><span className={s['credit-card__role']}>{m.role==='head'?'Head of department':m.canSpend?'Teacher':'Teacher · paused'}</span>
 {staff&&<button className={button('text')} onClick={()=>{setError('');setPending({member:m,action:'role'});}}>Change role</button>}
 {(staff||m.role!=='head')&&<button className={button('text')} onClick={()=>{setError('');setPending({member:m,action:'spending'});}}>{m.canSpend?'Pause':'Resume'}</button>}</div>)}
 {pending&&<div className={s['credit-card__body']} role="region" aria-label="Confirm member change"><p>{pending.action==='role'?`Make ${pending.member.name} ${pending.member.role==='head'?'a teacher':'head of department'}?`:`${pending.member.canSpend?'Pause':'Resume'} spending for ${pending.member.name}?`} Existing papers are unchanged.</p>
 {error&&<Notice tone="problem" role="alert">{error}</Notice>}<div className={s['credit-card__actions']}><button disabled={busy} className={button('primary')} onClick={save}>Confirm change</button><button disabled={busy} className={button('secondary')} onClick={()=>setPending(null)}>Cancel</button></div></div>}
 </section>;
}
