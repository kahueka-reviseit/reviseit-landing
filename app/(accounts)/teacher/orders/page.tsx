import Link from 'next/link';
import { requireTeacher } from '../../../../lib/auth/access';
import { type Order,stateLabels } from '../../../../lib/jobs/contracts';
import styles from '../../accounts.module.css';
export const dynamic='force-dynamic';
export default async function Orders(){
 const {supabase}=await requireTeacher();const result=await supabase.rpc('teacher_orders');
 return <section className={`${styles.card} ${styles.wide}`}><Link href="/teacher">Back to workspace</Link><h1>Your paper requests</h1><p>You can leave and return here to check your documents.</p>
 {result.error?<p role="alert">Your requests are temporarily unavailable. Please refresh shortly.</p>:result.data?.length?result.data.map((o:Order)=><article key={o.id} className={styles.review}><h2><Link href={`/teacher/orders/${o.id}`}>{o.title}</Link></h2><p>{stateLabels[o.state]||'Status unavailable'}</p>{o.internalTest&&<p>Internal test order</p>}{o.payment&&<p>Payment: {o.payment.status}{o.payment.testMode?' (test mode)':''}</p>}</article>):<p>No paper requests yet. Choose questions in your workspace and continue to payment to start one.</p>}</section>;
}
