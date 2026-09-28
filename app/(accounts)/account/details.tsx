'use client';
import { useFormState } from 'react-dom';
import { AccountForm, Disclosure, SchoolFields, Submit } from '../forms';
import { resendConfirmation, saveDetails } from '../actions';
import ui from '../experience.module.css';
/** T3 "Change school or department": saving sends the account back for verification. */
export default function AccountDetails({account}:{account:{full_name:string;requested_school:string;requested_department:string}}) {
  return <>
    <Disclosure summary="Change school or department"><AccountForm action={saveDetails} label="Submit for verification" submit="secondary"><SchoolFields account={account}/></AccountForm></Disclosure>
    <p className={ui['aside-card__note']}>Saving a change sends your account back for verification.</p>
  </>;
}
/** T4 A: resend uses the existing action; its reply never reveals whether an account exists. */
export function ResendConfirmation({email}:{email:string}) {
  const [state, action] = useFormState(resendConfirmation, { message: '' });
  return <form action={action} className={ui['button-row']}>
    <input type="hidden" name="email" value={email}/>
    {state.message ? <p className={ui['field__hint']} role="status">{state.message}</p> : <Submit label="Resend confirmation email" variant="secondary"/>}
  </form>;
}
