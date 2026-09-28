'use client';
import { AccountForm, PasswordField } from '../forms';
import { resetPassword } from '../actions';
/** T2 H: a mismatch is shown on the repeated password. */
export default function ResetForm() {
  return <AccountForm action={resetPassword} label="Save new password">{state=><>
    <PasswordField newPassword label="New password" error={state.field==='password'?state.message:undefined}/>
    <PasswordField newPassword label="Repeat new password" name="confirm_password" error={state.field==='confirm_password'?state.message:undefined}/>
  </>}</AccountForm>;
}
