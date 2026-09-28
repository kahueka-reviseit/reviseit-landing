import { ACCOUNT_UNAVAILABLE } from '../../../lib/auth/policy';
import { authConfig } from '../../../lib/supabase/config';
import AuthLayout from '../auth-layout';
import RegisterForm from './form';
import ui from '../experience.module.css';
export default function Register() {
  return <AuthLayout entry="sign-in" step={1} title="Create your teacher account" lede="Use your school email address. Our team checks every account against the school before the workspace opens, so papers stay within verified departments.">
    <section className={ui['form-card']} aria-label="Create account">
      {!authConfig() && <div className={ui['notice--neutral']} role="status"><p className={ui['notice__body']}>{ACCOUNT_UNAVAILABLE}</p></div>}
      <RegisterForm/>
    </section>
  </AuthLayout>;
}
