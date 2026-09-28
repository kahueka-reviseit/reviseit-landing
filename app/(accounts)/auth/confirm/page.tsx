import Link from 'next/link';
import { SignedOutHeader } from '../../shell';
import ConfirmForm from './form';
import ui from '../../experience.module.css';
/** Opening the page never consumes the link; Continue does (T2 D and E). */
export default async function Confirm({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const { token_hash, type } = await searchParams;
  const valid = !!token_hash && token_hash.length <= 512 && ['email','signup','recovery','email_change'].includes(type || '');
  const recovery = type === 'recovery';
  return <><SignedOutHeader entry="none"/><main className={ui['site-shell__main']}><div className={ui['page']}><div className={ui['auth-layout']}>
    <div className={ui['auth-layout__intro']}><p className={ui['auth-layout__eyebrow']}>{recovery ? 'Account recovery' : 'Confirm your school email'}</p><h1 className={ui['auth-layout__title']}>{recovery ? 'Reset your password' : 'Confirm your email'}</h1></div>
    <section className={ui['form-card']} aria-label={recovery ? 'Reset your password' : 'Confirm your email'}>
      {valid ? <ConfirmForm tokenHash={token_hash!} type={type!}/> : <>
        <div className={ui['notice--caution']} role="status"><p className={ui['notice__title--compact']}>This confirmation link is incomplete.</p><p className={ui['notice__body']}>Request a new link from the sign-in screen.</p></div>
        <p className={ui['form-card__links']}><Link href="/login">Back to sign in</Link></p></>}
    </section>
  </div></div></main></>;
}
