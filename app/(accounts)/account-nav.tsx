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
  if(!teacher) return <nav className={styles['site-nav']} aria-label="Account navigation"><Link className={styles['site-nav__brand']} href="/">Revise It</Link><Link className={styles['site-nav__link']} href="/account">My account</Link></nav>;
  const papers=path.startsWith('/teacher/orders');
  return <nav className={`${styles['site-nav']} ${styles['site-nav--teacher']}`} aria-label="Account navigation">
    <Link className={styles['site-nav__brand']} href="/">Revise It</Link>
    <span className={styles['site-nav__links']}>
      {/* A full load: the workspace reads its screen from the address on arrival. */}<a className={`${styles['site-nav__link']} ${!papers?styles['site-nav__link--current']:''}`} href="/teacher?view=home" aria-current={!papers?'page':undefined}>My curricula</a>
      <Link className={`${styles['site-nav__link']} ${papers?styles['site-nav__link--current']:''}`} href="/teacher/orders" aria-current={papers?'page':undefined}>My papers</Link>
      <Link className={styles['site-nav__link']} href="/account">My account</Link>
    </span>
  </nav>;
}
