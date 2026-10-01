import {notFound} from 'next/navigation';
import {requireTeacher} from '../../../../lib/auth/access';
import {creditsEnabled,creditMode} from '../../../../lib/credits/server';
import type {CreditSummary,DepartmentMember} from '../../../../lib/credits/contracts';
import {Offers,type Offer} from '../../credits/offers';
import {Topup} from '../../credits/topup';
import {TeacherHeader} from '../../shell';
import {CreditSummaryView} from '../../credits/summary';
import {MemberControls} from '../../credits/member-controls';
import {Notice} from '../../system/notice';
import {button} from '../../system/button';
import s from '../../credits/credits.module.css';
export default async function Department({searchParams}:{searchParams:Promise<{purchase?:string}>}){
 const params=await searchParams;
 if(!creditsEnabled())notFound();
 const c=await requireTeacher();
 const [department,school,summary]=await Promise.all([
 c.supabase.from('departments').select('name').eq('id',c.account.department_id!).single(),
 c.supabase.from('schools').select('name').eq('id',c.account.school_id!).single(),
 c.supabase.rpc('department_credit_summary',{target_department:c.account.department_id,target_mode:creditMode()})]);
 const value=summary.data as CreditSummary|null;
 const members=value?.canManage?await c.supabase.rpc('department_members',{target_department:c.account.department_id}):null;
 const [offers,topups]=value?.canManage?await Promise.all([c.supabase.rpc('department_offers',{target_department:c.account.department_id,target_mode:creditMode()}),c.supabase.rpc('credit_topups')]):[null,null];
 return <><TeacherHeader current="department" name={c.account.full_name} departmentEnabled/>
 <main className={s.department}><header className={s['department__header']}><div><div className={s['department__eyebrow']}>{school.data?.name} · {department.data?.name}</div><h1 className={s['department__title']}>My department</h1><p className={s['department__lede']}>{value?.canManage?'You manage the department’s credit and members.':'Your department shares credit for creating papers.'}</p></div><a href="/teacher" className={button('primary')}>Build a paper →</a></header>
 {summary.error||!value?<Notice tone="problem" role="alert">The department balance could not be loaded. Please try again.</Notice>:<div className={s['department__stack']}>{offers?.data&&<Offers offers={offers.data as Offer[]}/>}<CreditSummaryView summary={value}/>{value.canManage&&<Topup amounts={topups?.data||[]} purchaseId={params.purchase}/>}{!value.canSpend&&<Notice tone="caution">Your department’s head has paused your spending. Existing papers are unchanged.</Notice>}{members?.error?<Notice tone="problem">Members could not be loaded.</Notice>:members&&<MemberControls members={members.data as DepartmentMember[]}/>}</div>}
 </main></>;
}
