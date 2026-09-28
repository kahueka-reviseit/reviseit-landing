'use client';
import Link from 'next/link';
import { useFormState } from 'react-dom';
import { Submit } from '../../forms';
import { confirmEmail } from '../../actions';
import ui from '../../experience.module.css';
export default function ConfirmForm({tokenHash,type}:{tokenHash:string;type:string}) {
  const [state, action] = useFormState(confirmEmail, { message: '' });
  if (state.field === 'expired') return <div className={ui['form']}>
    <h2 className={ui['form-card__title']}>This link no longer works</h2>
    <div className={ui['notice--caution']} role="alert"><p className={ui['notice__body']}>{state.message}</p></div>
    <div className={ui['button-row']}><Link className={ui['button--primary']} href="/login">Sign in</Link><Link className={ui['button--secondary']} href="/login?resend=1">Resend confirmation</Link></div>
  </div>;
  return <form action={action} className={ui['form']}>
    {state.message && <div className={ui['notice--problem']} role="alert"><p className={ui['notice__body']}>{state.message}</p></div>}
    <p className={ui['form-card__body']}>Continue to securely verify this link.</p>
    <input type="hidden" name="token_hash" value={tokenHash}/><input type="hidden" name="type" value={type}/>
    <Submit label="Continue"/>
    <p className={ui['form-card__links']}><Link href="/login">Back to sign in</Link></p>
  </form>;
}
