import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requireHostedTarget, requireHostedFixture } from './target';

const execute = promisify(execFile);
const target = requireHostedTarget(process.env);
const names = ['paper','memo','learner-memo','teacher-description'];
async function operator(action: 'inspect' | 'restart-at-memo' | 'report', order: string) {
  const driver = process.env.HOSTED_JOB_TEST_DRIVER;
  if (!driver) throw new Error('Configure the reviewed remote acceptance driver');
  const result = await execute('python3', [driver, action, order], {timeout:300000,maxBuffer:2_000_000});
  return JSON.parse(result.stdout);
}
async function protectedContext(context: BrowserContext) {
  // Never send the preview bypass credential to a redirect or another origin.
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== target.origin) return route.abort();
    await route.continue({headers:{...route.request().headers(),'x-vercel-protection-bypass':target.secret}});
  });
}
async function get(page: Page, path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Relative application path required');
  return page.request.get(target.origin + path, {maxRedirects:0,headers:{'x-vercel-protection-bypass':target.secret}});
}
async function login(page: Page, person: {email:string,password:string}) {
  await page.goto('/login');
  await page.locator('main form').first().getByLabel('School email address').fill(person.email);
  await page.getByLabel('Password',{exact:true}).fill(person.password);
  await page.getByRole('button',{name:'Log in',exact:true}).click();
  await expect(page).toHaveURL(/\/(account|teacher)$/);
}

test('hosted order survives server reboot and releases only to its school', async ({browser}, info) => {
  const fixturePath = process.env.HOSTED_JOB_TEST_FIXTURE;
  if (!fixturePath) throw new Error('Private pre-provisioned fixture required');
  const fixture = requireHostedFixture(JSON.parse(readFileSync(fixturePath,'utf8')));
  const path = `/api/teacher/orders/${fixture.order}`;
  const initial = await operator('inspect',fixture.order);
  expect(initial.mode).toBe('replay');
  expect(initial.paidProviderCalls).toBe(0);
  expect(initial.orderState).toBe('awaiting_answers');
  expect(initial.laptopDependencies).toEqual([]);
  expect(initial.rendererNetwork).toBe('none');
  expect(initial.serverId).toBe(fixture.serverId);
  const contexts = await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
  const evidence: any = {order:fixture.order,origin:target.origin,project:target.project,initial};
  try {
    const unauth = await contexts[0].request.get(target.origin,{maxRedirects:0});
    expect([302,307,401]).toContain(unauth.status());
    if (unauth.status() !== 401) expect(new URL(unauth.headers().location).hostname).toBe('vercel.com');
    await Promise.all(contexts.map(protectedContext));
    let page = await contexts[0].newPage();
    const other = await contexts[1].newPage(), review = await contexts[2].newPage();
    expect((await get(page,path)).status()).toBe(401);
    await login(page,fixture.teacher);
    await page.goto(`/teacher/orders/${fixture.order}`);
    await expect(page.getByRole('heading',{name:'Ready for your answers'})).toBeVisible();
    for (const field of fixture.form) await page.getByLabel(field.label,{exact:true}).selectOption(field.options[0]);
    expect((await get(page,path+'/documents/paper?review=true')).status()).toBe(403);
    const posted = page.waitForRequest(r=>r.url().endsWith('/submit') && r.method()==='POST');
    await page.getByRole('button',{name:'Submit answers',exact:true}).click();
    const submitted = (await posted).postDataJSON();
    const duplicate = await page.request.post(target.origin+path+'/submit',{data:submitted,maxRedirects:0,
      headers:{origin:target.origin,'x-vercel-protection-bypass':target.secret}});
    expect(duplicate.status()).toBe(202);
    expect(await duplicate.json()).toEqual({id:fixture.order});
    expect((await get(page,path+'/documents/paper')).status()).toBe(404);
    await page.close();
    await expect.poll(async()=> (await operator('inspect',fixture.order)).orderState,{timeout:180000,intervals:[2000,5000]}).toBe('awaiting_memo_review');
    const before = await operator('inspect',fixture.order);
    expect(before.bootId).toMatch(/^[0-9a-f-]{36}$/);
    expect(before.workerIdentity).toEqual(expect.any(String));
    expect(before.workerIdentity.length).toBeGreaterThan(8);
    expect(before.memoHash).toMatch(/^[0-9a-f]{64}$/);
    expect(before.ledgerHash).toMatch(/^[0-9a-f]{64}$/);
    const after = await operator('restart-at-memo',fixture.order);
    expect(after.bootId).toMatch(/^[0-9a-f-]{36}$/);
    expect(after.serverId).toBe(before.serverId);
    expect(after.bootId).not.toBe(before.bootId);
    expect(after.workerIdentity).toBe(before.workerIdentity);
    expect(after.memoHash).toBe(before.memoHash);
    expect(after.ledgerHash).toBe(before.ledgerHash);
    expect(after.orderState).toBe('awaiting_memo_review');
    evidence.restart = {before,after};
    page = await contexts[0].newPage();
    await page.goto(`/teacher/orders/${fixture.order}`);
    await expect(page.getByRole('heading',{name:'Checking the memorandum'})).toBeVisible();
    await login(review,fixture.reviewer);
    await review.goto(`/admin/papers/${fixture.order}`);
    await expect(review.getByRole('heading',{name:'Review the memorandum'})).toBeVisible();
    await review.getByLabel('Review evidence').fill('Synthetic hosted protocol proof: replay memo checkpoint and exact material hash verified; no real school content.');
    await review.getByRole('checkbox').check();
    await review.getByRole('button',{name:'Approve memorandum',exact:true}).click();
    await expect(review).toHaveURL(/\/admin\/papers$/);
    await expect.poll(async()=> (await operator('inspect',fixture.order)).orderState,{timeout:180000,intervals:[2000,5000]}).toBe('awaiting_release');
    expect((await get(page,path+'/documents/paper')).status()).toBe(404);
    await review.goto(`/admin/papers/${fixture.order}`);
    await expect(review.getByRole('heading',{name:'Inspect all four documents'})).toBeVisible();
    const hashes: Record<string,string> = {};
    for (const name of names) {
      const response = await get(review,`${path}/documents/${name}?review=true`);
      expect(response.status()).toBe(200);
      const bytes = await response.body();
      expect(bytes.subarray(0,4).toString('hex')).toBe('504b0304');
      hashes[name] = createHash('sha256').update(bytes).digest('hex');
    }
    await review.getByLabel('Review evidence').fill('Synthetic hosted delivery proof: four Word documents fetched and hashes recorded; no customer release or scientific acceptance.');
    await review.getByRole('checkbox').check();
    await review.getByRole('button',{name:'Release four documents',exact:true}).click();
    await expect(review).toHaveURL(/\/admin\/papers$/);
    await page.reload();
    await expect(page.getByRole('heading',{name:'Ready to download',exact:true})).toBeVisible();
    evidence.documents = {};
    await login(other,fixture.other);
    expect((await get(other,path)).status()).toBe(404);
    for (const name of names) {
      const response = await get(page,`${path}/documents/${name}`);
      expect(response.status()).toBe(200);
      const bytes = await response.body(), sha256 = createHash('sha256').update(bytes).digest('hex');
      expect(sha256).toBe(hashes[name]);
      writeFileSync(info.outputPath(name+'.docx'),bytes);
      evidence.documents[name] = {sha256,bytes:bytes.length};
      expect((await get(other,`${path}/documents/${name}`)).status()).toBe(404);
    }
    const report = await operator('report',fixture.order);
    expect(report.paidProviderCalls).toBe(0);
    expect(report.mode).toBe('replay');
    expect(report.steps).toEqual([1,2,3,4,5,6]);
    expect(report.submissionCount).toBe(1);
    expect(report.memoReviewer).toBe(fixture.reviewer.id);
    expect(report.releaseReviewer).toBe(fixture.reviewer.id);
    expect(report.laptopDependencies).toEqual([]);
    evidence.final = report;
    evidence.otherSchoolDenied = true;
    await page.screenshot({path:info.outputPath('released-desktop.png'),fullPage:true});
    writeFileSync(info.outputPath('journey-evidence.json'),JSON.stringify(evidence,null,2));
  } finally {
    // Preserve hosted evidence and worker state. No implicit database cleanup or server deletion.
    await Promise.all(contexts.map(context=>context.close()));
  }
});
