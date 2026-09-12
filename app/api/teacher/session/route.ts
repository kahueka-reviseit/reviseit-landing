import { NextResponse } from 'next/server';
import { accountContext } from '../../../../lib/auth/access';
import { canEnterWorkspace } from '../../../../lib/auth/policy';
export const dynamic = 'force-dynamic';
export async function GET() {
  const context = await accountContext();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (context.kind !== 'authenticated') return NextResponse.json({ error: context.kind === 'unavailable' ? 'Account service unavailable' : 'Sign in required' }, { status: context.kind === 'unavailable' ? 503 : 401, headers });
  if (!canEnterWorkspace(context.account, context.user.email || '', !!context.user.email_confirmed_at)) return NextResponse.json({ error: 'School verification required' }, { status: 403, headers });
  return NextResponse.json({ schoolId: context.account.school_id, departmentId: context.account.department_id }, { headers });
}
