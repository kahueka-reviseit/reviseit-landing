import { StaffHeader } from '../../staff-header';
import AdminLoginForm from './form';
import ui from '../../experience.module.css';
export const metadata = { title: 'Administration | Revise It' };
/** Team sign in (Paper S4 A and B). */
export default function AdminLogin() {
  return <><StaffHeader/><main className={ui['site-shell__main']}><div className={ui['page--staff']}><div className={ui['auth-layout']}>
    <div className={ui['auth-layout__intro']}><p className={ui['auth-layout__eyebrow']}>Revise It administration</p><h1 className={ui['auth-layout__title']}>Revise It team sign in</h1>
      <p className={ui['auth-layout__lede']}>Manage teacher applications, school access and papers that need attention using your authorised team account.</p></div>
    <section className={ui['form-card--staff']} aria-label="Team sign in"><AdminLoginForm/></section>
  </div></div></main></>;
}
