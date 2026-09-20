import Link from 'next/link';
import styles from '../../../accounts.module.css';
export default function ReviewView({order}:{order:any}){
 return <section className={`${styles.card} ${styles.wide}`}><Link href="/admin/papers">Paper requests</Link><h1>{order.title}</h1><p>Status: {order.state}</p><p>This request needs internal attention. Content evaluation and correction belong to the generation skill. There is no separate approval or correction action here.</p></section>;
}
