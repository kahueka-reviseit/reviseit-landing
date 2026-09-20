import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAccount } from '../../../../lib/auth/access';
import styles from '../../accounts.module.css';
export const dynamic='force-dynamic';
export default async function ReviewPapers(){const {supabase}=await requireAccount();const r=await supabase.rpc('paper_review_queue');if(r.error)redirect('/account');return <section className={`${styles.card} ${styles.wide}`}><h1>Paper requests needing attention</h1><p>The generation skill handles content checks. Stopped requests are listed for internal attention; they cannot be approved or restarted here.</p>{r.data?.length?r.data.map((o:any)=><article key={o.id} className={styles.review}><Link href={`/admin/papers/${o.id}`}>{o.title}</Link><p>{o.state}</p></article>):<p>No requests need attention.</p>}</section>;}
