// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { schoolEmailError, canEnterWorkspace, type TeacherAccount } from '../../lib/auth/policy';
vi.mock('server-only', () => ({}));
const create = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase/server', () => ({ createClient: create }));
import { GET } from '../../app/api/teacher/session/route';
const account: TeacherAccount = { user_id:'teacher',email:'teacher@school.example',full_name:'Teacher',requested_school:'School',requested_department:'Science',status:'approved',school_id:'school-one',department_id:'science',revision:2,reviewed_at:'2026-09-12' };
function mockAccount(a: TeacherAccount | null, options: {confirmed?:boolean; anonymous?:boolean; error?:boolean} = {}) {
  const query = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({data:a,error:options.error ? {} : null}) };
  query.eq.mockReturnValue(query);
  create.mockResolvedValue({auth:{getUser: vi.fn().mockResolvedValue({ data:{ user:options.anonymous ? null : { id:'teacher',email:account.email,email_confirmed_at: options.confirmed === false ? null : 'confirmed' } }, error:null })},from:vi.fn().mockReturnValue({select:vi.fn().mockReturnValue(query)})});
}
beforeEach(() => vi.resetAllMocks());
describe('direct teacher endpoint access', () => {
  test('configuration missing returns service unavailable with no teacher data', async () => {
    create.mockResolvedValue(null); const r=await GET(); expect(r.status).toBe(503); expect(await r.text()).not.toContain('school-one');
  });
  test('anonymous requests return 401', async () => { mockAccount(null,{anonymous:true}); expect((await GET()).status).toBe(401); });
  test.each(['pending','rejected','suspended'] as const)('%s accounts return 403', async status => { mockAccount({...account,status}); const r=await GET(); expect(r.status).toBe(403); expect(await r.text()).not.toContain('school-one'); });
  test('email-unconfirmed requests return 403 even if approval exists', async () => { mockAccount(account,{confirmed:false}); expect((await GET()).status).toBe(403); });
  test('database failure does not fall back to approval claims', async () => { mockAccount(account,{error:true}); expect((await GET()).status).toBe(503); });
  test('approved membership returns only its school and disables caching', async () => { mockAccount(account); const r=await GET(); expect(r.status).toBe(200); expect(await r.json()).toEqual({schoolId:'school-one',departmentId:'science'}); expect(r.headers.get('Cache-Control')).toBe('private, no-store'); });
});
test('school validation accepts unfamiliar school domains but blocks common personal addresses', () => {
  expect(schoolEmailError('teacher@unfamiliar-school.ac.za')).toBeNull();
  expect(schoolEmailError('Teacher@GMAIL.COM')).toMatch(/school-issued/);
  expect(schoolEmailError('bad-email')).toBeTruthy();
});
test('approval cannot survive a changed email or missing school association', () => {
  expect(canEnterWorkspace(account,'changed@school.example',true)).toBe(false);
  expect(canEnterWorkspace({...account,department_id:null},account.email,true)).toBe(false);
});
