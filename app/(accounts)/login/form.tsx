'use client';
import Link from 'next/link';
import { AccountForm, Disclosure, EmailField, PasswordField } from '../forms';
import { login, resendConfirmation } from '../actions';
import ui from '../experience.module.css';
/** T2 A and B: a refused sign-in keeps the email, clears and focuses the password. */
export default function LoginForm({resend=false,next}:{resend?:boolean;next?:string|null}) {
  return <>
    <AccountForm action={login} label="Sign in">{state=><>
      {next&&<input type="hidden" name="next" value={next}/>}
      <EmailField/>
      <PasswordField resetKey={state.attempt} trailing={<Link className={ui['link']} href="/forgot-password">Forgot password?</Link>}/>
    </>}</AccountForm>
    <p className={ui['form-card__links']}><Link href="/register">New here? Create an account</Link></p>
    <Disclosure summary="Resend the confirmation email" open={resend}><AccountForm action={resendConfirmation} label="Send confirmation link" submit="secondary"><EmailField/></AccountForm></Disclosure>
  </>;
}
