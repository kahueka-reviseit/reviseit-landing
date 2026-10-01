import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireCreditAdministrator,creditsEnabled,creditMode} from '../../../../lib/credits/server';
import type {CreditSummary,DepartmentMember} from '../../../../lib/credits/contracts';
import {StaffHeader} from '../../staff-header';
import {CreditSummaryView} from '../../credits/summary';
import {MemberControls} from '../../credits/member-controls';
import {GrantForm} from '../../credits/grant-form';
import {Notice} from '../../system/notice';
import s from '../../credits/credits.module.css';
export default async function Departments({searchParams}:{searchParams:Promise<{department?:string}>}){
 if(!creditsEnabled())notFound();const c=await requireCreditAdministrator();const params=await searchParams;
 const r=await c.supabase.rpc('credit_departments');
 const rows=(r.data||[]) as {id:string;name:string;school:string}[];
 const selected=rows.find(d=>d.id===params.department);
 const [summary,members]=selected?await Promise.all([c.supabase.rpc('department_credit_summary',{target_department:selected.id,target_mode:creditMode()}),c.supabase.rpc('department_members',{target_department:selected.id})]):[null,null];
 return <><StaffHeader current="departments" signedIn name={c.account.full_name} creditsEnabled/>
 <main className={s.department}><header className={s['department__header']}><div><div className={s['department__eyebrow']}>DEPARTMENT CREDIT{creditMode()==='test'?' · TEST MODE':''}</div><h1 className={s['department__title']}>{selected?selected.name:'Departments'}</h1><p>{selected?.school}</p></div>{selected&&<Link href="/admin/departments">← All departments</Link>}</header>
 {r.error?<Notice tone="problem">Departments could not be loaded.</Notice>:selected?<div className={s['department__columns']}><div className={s['department__stack']}>{summary?.error?<Notice tone="problem">Balance could not be loaded.</Notice>:summary?.data&&<CreditSummaryView summary={summary.data as CreditSummary}/>}{members?.error?<Notice tone="problem">Members could not be loaded.</Notice>:members?.data&&<MemberControls members={members.data as DepartmentMember[]} staff/>}</div><GrantForm key={selected.id} departmentId={selected.id}/></div>:
 <section className={s['credit-card']}>{rows.length?rows.map(d=><Link key={d.id} href={`/admin/departments?department=${d.id}`} className={s['credit-card__row']}><span className={s['credit-card__primary']}>{d.school}<span className={s['credit-card__secondary']}>{d.name}</span></span><span>View department →</span></Link>):<p className={s['credit-card__empty']}>No departments registered yet.</p>}</section>}
 </main></>;
}
