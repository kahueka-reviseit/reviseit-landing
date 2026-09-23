// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock('../../lib/supabase/server', () => ({ createClient: mocks.create }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
import { adminLogin } from '../../app/(accounts)/admin/login/actions';
const form = () => { const f = new FormData(); f.set('email', ' Team@reviseit.io '); f.set('password', 'private-test-password'); return f; };
function client(role: unknown = true, confirmed = true, roleError: unknown = null) {
  const c = { auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'team', email_confirmed_at: confirmed ? 'confirmed' : null } }, error: null }), signOut: vi.fn().mockResolvedValue({ error: null }) }, rpc: vi.fn().mockResolvedValue({ data: role, error: roleError }) };
  mocks.create.mockResolvedValue(c); return c;
}
beforeEach(() => vi.clearAllMocks());
test('confirmed reviewers reach the existing verification screen', async () => {
  const c = client();
  await expect(adminLogin({message:''}, form())).rejects.toThrow('redirect:/admin/accounts');
  expect(c.rpc).toHaveBeenCalledWith('is_account_reviewer');
  expect(c.auth.signInWithPassword).toHaveBeenCalledWith({email:'team@reviseit.io',password:'private-test-password'});
});
test.each([false, null, 'true'])('ordinary accounts cannot enter administration with role %s', async role => {
  const c = client(role); expect((await adminLogin({message:''},form())).message).toContain('does not have');
  expect(c.auth.signOut).toHaveBeenCalled(); expect(mocks.redirect).not.toHaveBeenCalled();
});
test('role lookup errors refuse access and clear the new session', async () => {
  const c = client(true,true,{message:'unavailable'}); await adminLogin({message:''},form());
  expect(c.auth.signOut).toHaveBeenCalled(); expect(mocks.redirect).not.toHaveBeenCalled();
});
test('unconfirmed users cannot enter even if the role says true', async () => {
  const c=client(true,false); await adminLogin({message:''},form()); expect(c.auth.signOut).toHaveBeenCalled();
});
test('bad credentials do not query roles', async () => {
  const c=client(); c.auth.signInWithPassword.mockResolvedValue({data:{user:null},error:{message:'invalid'}} as never);
  expect((await adminLogin({message:''},form())).message).toContain('Unable'); expect(c.rpc).not.toHaveBeenCalled();
});
test('missing configuration reports unavailable', async () => {
  mocks.create.mockResolvedValue(null); expect((await adminLogin({message:''},form())).message).toBeTruthy(); expect(mocks.redirect).not.toHaveBeenCalled();
});
