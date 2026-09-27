'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './accounts.module.css';

/**
 * Teacher pages use the paper journey's navigation (Paper: My curricula · My papers ·
 * My account). Sign-in, registration and admin pages keep the original two-link bar.
 */
export default function AccountNav({path:forced}:{path?:string}={}) {
  // `path` lets the isolated synthetic preview render the teacher navigation outside Next.
  const current=usePathname();const path=forced ?? current ?? '';
  const teacher=path==='/teacher'||path.startsWith('/teacher/');
  if(!teacher) return <nav className={styles.nav} aria-label="Account navigation"><Link className={styles.brand} href="/">Revise It</Link><Link href="/account">My account</Link></nav>;
  const papers=path.startsWith('/teacher/orders');
  return <nav className={`${styles.nav} ${styles.teacherNav}`} aria-label="Account navigation">
    <Link className={styles.brand} href="/">Revise It</Link>
    <span className={styles.navLinks}>
      {/* A full load: the workspace reads its screen from the address on arrival. */}<a href="/teacher?view=home" aria-current={!papers?'page':undefined}>My curricula</a>
      <Link href="/teacher/orders" aria-current={papers?'page':undefined}>My papers</Link>
      <Link href="/account">My account</Link>
    </span>
  </nav>;
}
