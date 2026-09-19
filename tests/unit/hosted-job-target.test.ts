import { describe, it, expect } from 'vitest';
import { requireHostedTarget, requireHostedFixture, hostedOrigin, developmentProject } from '../hosted-jobs/target';
const env = { HOSTED_JOB_TEST_ORIGIN: hostedOrigin, HOSTED_JOB_TEST_PROJECT: developmentProject,
  HOSTED_JOB_TEST_CONFIRM: 'synthetic-replay-only', VERCEL_AUTOMATION_BYPASS_SECRET: 'test-only-secret' };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture = () => ({ origin: hostedOrigin, project: developmentProject, mode: 'replay', entitlement: 'internal_test',
  order: id(1), school: id(2), otherSchool: id(3), serverId:1234, form: [{ label: 'Synthetic' }],
  ...Object.fromEntries(['teacher','other','reviewer'].map((role,i) => [role,{id:id(i+4),email:role+'@synthetic.example',password:'Synthetic-test-password'}])) });
describe('hosted acceptance admission', () => {
  it('accepts only the named isolated environment with explicit replay acknowledgement', () => {
    expect(requireHostedTarget(env).origin).toBe(hostedOrigin);
    for (const change of [{HOSTED_JOB_TEST_ORIGIN:'http://localhost:3101'},
      {HOSTED_JOB_TEST_ORIGIN:'https://reviseit.io'}, {HOSTED_JOB_TEST_PROJECT:'another-project'},
      {HOSTED_JOB_TEST_CONFIRM:''}, {VERCEL_AUTOMATION_BYPASS_SECRET:'bad\nheader'}]) {
      expect(() => requireHostedTarget({...env,...change})).toThrow();
    }
  });
  it('rejects live content, real identities and same-school fixtures before browser actions', () => {
    expect(requireHostedFixture(fixture()).mode).toBe('replay');
    for (const change of [{mode:'live'}, {entitlement:'paid'}, {project:'another-project'},
      {school:id(3)}, {teacher:{id:id(4),email:'teacher@school.edu',password:'Synthetic-test-password'}},
      {reviewer:{id:id(4),email:'reviewer@synthetic.example',password:'Synthetic-test-password'}}]) {
      expect(() => requireHostedFixture({...fixture(),...change})).toThrow();
    }
  });
});
