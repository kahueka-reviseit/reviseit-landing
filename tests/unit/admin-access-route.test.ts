// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({ create: vi.fn(), redirect: vi.fn((path: string) => { throw Error(`redirect:${path}`); }) }));
vi.mock('../../lib/supabase/server', () => ({ createClient: m.create }));
vi.mock('next/navigation', () => ({ redirect: m.redirect }));
import { requireReviewer, requireTeacher } from '../../lib/auth/access';
beforeEach(() => vi.clearAllMocks());
test('an expired admin session goes to staff sign-in, while teachers keep teacher sign-in', async () => {
  m.create.mockResolvedValue({auth:{getUser:async()=>({data:{user:null},error:null})}});
  await expect(requireReviewer()).rejects.toThrow('redirect:/admin/login');
  await expect(requireTeacher()).rejects.toThrow('redirect:/login');
});
test('missing admin configuration stays on the staff sign-in route', async () => {
  m.create.mockResolvedValue(null);
  await expect(requireReviewer()).rejects.toThrow('redirect:/admin/login?message=unavailable');
});
test.each([false, true])('reviewer check still enforces access when role is %s', async role => {
  const q={eq:vi.fn(),maybeSingle:async()=>({data:{user_id:'staff'},error:null})};q.eq.mockReturnValue(q);
  const rpc=vi.fn().mockResolvedValue({data:role,error:null});
  m.create.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:'staff'}},error:null})},from:()=>({select:()=>q}),rpc});
  if(role) expect((await requireReviewer()).user.id).toBe('staff');
  else await expect(requireReviewer()).rejects.toThrow('redirect:/account');
  expect(rpc).toHaveBeenCalledWith('is_account_reviewer');
});
