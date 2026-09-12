import { AccountForm, PasswordField } from '../forms';
import { resetPassword } from '../actions';
import { requireAccount } from '../../../lib/auth/access';
import styles from '../accounts.module.css';
export default async function ResetPassword() {
  await requireAccount();
  return <section className={styles.card}><h1>Choose a new password</h1><AccountForm action={resetPassword} label="Save password"><PasswordField newPassword /><label>Confirm password<input name="confirm_password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label></AccountForm></section>;
}
