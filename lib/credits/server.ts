import 'server-only';
import {redirect} from 'next/navigation';
import {requireAccount} from '../auth/access';
export function creditsEnabled(){return process.env.DEPARTMENT_CREDITS_ENABLED==='true';}
export function creditMode():'test'|'live'{return process.env.DEPARTMENT_CREDITS_MODE==='live'?'live':'test';}
export async function requireCreditAdministrator(){
 const context=await requireAccount();
 const r=await context.supabase.rpc('is_credit_administrator');
 if(r.error||r.data!==true)redirect('/account');
 return context;
}
