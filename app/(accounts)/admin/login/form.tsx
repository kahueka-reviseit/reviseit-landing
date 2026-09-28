'use client';
import Link from 'next/link';
import { AccountForm, EmailField, PasswordField } from '../../forms';
import { adminLogin } from './actions';
import ui from '../../experience.module.css';
export default function AdminLoginForm() {
  return <><AccountForm action={adminLogin} label="Sign in to admin" submit="inverse"><EmailField label="Staff email address"/><PasswordField trailing={<Link className={ui['link']} href="/forgot-password">Forgot password?</Link>}/></AccountForm>
    <p className={ui['form-card__note']}>Teachers sign in at pilot.reviseit.io.</p></>;
}
