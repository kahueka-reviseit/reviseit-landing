import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAccount } from '../../../../lib/auth/access';
import styles from '../../accounts.module.css';
export const dynamic='force-dynamic';
export default async function ReviewPapers(){const {supabase}=await requireAccount();const r=await supabase.rpc('paper_review_queue');if(r.error)redirect('/account');return <section className={`${styles.card} ${styles.wide}`}><h1>Review paper requests</h1><p>Check the memorandum first, then inspect all four documents before release. Every decision records your account identity and the exact reviewed version.</p>{r.data?.length?r.data.map((o:any)=><article key={o.id} className={styles.review}><Link href={`/admin/papers/${o.id}`}>{o.title}</Link><p>{o.state==='awaiting_memo_review'?'Memorandum review':'Four-document release review'}</p></article>):<p>No requests awaiting review.</p>}</section>;}
