import { requireAccount } from '../../../lib/auth/access';
import { SignedOutHeader } from '../shell';
import ResetForm from './form';
import ui from '../experience.module.css';
export default async function ResetPassword() {
  await requireAccount();
  return <><SignedOutHeader entry="none"/><main className={ui['site-shell__main']}><div className={ui['page']}><div className={ui['auth-layout']}>
    <div className={ui['auth-layout__intro']}><p className={ui['auth-layout__eyebrow']}>Account recovery</p><h1 className={ui['auth-layout__title']}>Choose a new password</h1></div>
    <section className={ui['form-card']} aria-label="Choose a new password"><ResetForm/></section>
  </div></div></main></>;
}
