export const hostedOrigin = 'https://reviseit-teacher-test.vercel.app';
export const developmentProject = 'tgaganmgccvrphpfipgy';

export function requireHostedTarget(env: Record<string, string | undefined>, mode: 'replay' | 'live' = 'replay') {
  if (env.HOSTED_JOB_TEST_ORIGIN !== hostedOrigin ||
      env.HOSTED_JOB_TEST_PROJECT !== developmentProject ||
      env.HOSTED_JOB_TEST_CONFIRM !== (mode === 'live' ? 'authorised-internal-live' : 'synthetic-replay-only')) {
    throw new Error('Explicit isolated hosted synthetic target required');
  }
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret || /[\r\n]/.test(secret)) throw new Error('Private deployment access credential required');
  return { origin: hostedOrigin, project: developmentProject, secret };
}

export function requireHostedFixture(value: any, mode: 'replay' | 'live' = 'replay') {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (value?.project !== developmentProject || value?.origin !== hostedOrigin ||
      value?.mode !== mode || value?.entitlement !== 'internal_test' ||
      !uuid.test(value?.order ?? '') || !Number.isSafeInteger(value?.serverId) || value.serverId <= 0 ||
      !Array.isArray(value?.form) || !value.form.length) {
    throw new Error('Bound synthetic hosted fixture required');
  }
  const ids = new Set<string>();
  for (const role of ['teacher', 'other', 'reviewer']) {
    const person = value[role];
    if (!uuid.test(person?.id ?? '') || !/^[a-z0-9-]+@synthetic\.example$/.test(person?.email ?? '') ||
        typeof person?.password !== 'string' || person.password.length < 16 || ids.has(person.id)) {
      throw new Error('Distinct synthetic authenticated identities required');
    }
    ids.add(person.id);
  }
  if (!uuid.test(value.school ?? '') || !uuid.test(value.otherSchool ?? '') || value.school === value.otherSchool) {
    throw new Error('Distinct synthetic schools required');
  }
  return value;
}
