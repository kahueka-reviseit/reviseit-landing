import { redirect } from 'next/navigation';
import { requireReviewer } from '../../../lib/auth/access';
export default async function Administration() {
  await requireReviewer();
  redirect('/admin/accounts');
}
