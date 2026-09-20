import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { requireHostedTarget, requireHostedFixture } from './target';
import { isQuestionnaire } from '../../lib/jobs/questionnaire';
import { questionFieldId } from '../../lib/jobs/questionnaire-fields';

// Admission only. Provision a synthetic order with a unique worker_id which no
// running worker uses. The operator checks that fence before and after this test.
const target = requireHostedTarget(process.env);
test('hosted grouped questionnaire preserves answers and admits one corrected submission', async ({browser}, info) => {
  const fixturePath = process.env.HOSTED_GROUPED_FIXTURE;
  if (!fixturePath) throw new Error('Private fenced questionnaire fixture required');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const base = requireHostedFixture(fixture.base);
  expect(fixture.order).toMatch(/^[a-f0-9-]{36}$/);
  expect(fixture.order).not.toBe(base.order);
  expect(fixture.worker).toMatch(/^questionnaire-probe-[a-f0-9-]{36}$/);
  expect(isQuestionnaire(fixture.form)).toBe(true);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  async function protect(context: BrowserContext) {
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== target.origin) return route.abort();
      return route.continue({headers:{...route.request().headers(),'x-vercel-protection-bypass':target.secret}});
    });
  }
  const headers = {'x-vercel-protection-bypass':target.secret, origin:target.origin};
  const path = `/api/teacher/orders/${fixture.order}`;
  const authoredError = `Synthetic first question: Include a graph: ${fixture.error}`;
  async function login(page:Page, person:{email:string,password:string}) {
    await page.goto('/login');
    await page.locator('main form').first().getByLabel('School email address').fill(person.email);
    await page.getByLabel('Password',{exact:true}).fill(person.password);
    await page.getByRole('button',{name:'Log in',exact:true}).click();
    await expect(page).toHaveURL(/\/(account|teacher)$/);
  }
  try {
    await Promise.all(contexts.map(protect));
    const page = await contexts[0].newPage(), other = await contexts[1].newPage();
    expect((await page.request.get(target.origin+path,{headers,maxRedirects:0})).status()).toBe(401);
    await login(page,base.teacher);
    await login(other,base.other);
    expect((await other.request.get(target.origin+path,{headers,maxRedirects:0})).status()).toBe(404);
    const visible=await page.request.get(target.origin+path,{headers,maxRedirects:0});
    expect(visible.status()).toBe(200);
    const initial=await visible.json();
    expect(initial.state).toBe('awaiting_answers');
    expect(initial.form).toEqual(fixture.form);
    for (const privateName of ['generationPlan','answerPolicy','SYNTHETIC-PRIVATE-SENTINEL','profileSha256','worker_id'])
      expect(JSON.stringify(initial)).not.toContain(privateName);
    await page.goto(`/teacher/orders/${fixture.order}`);
    await expect(page.getByRole('heading',{name:'Ready for your answers'})).toBeVisible();
    await expect(page.locator('fieldset').first()).toContainText('8 marks');
    await expect(page.locator('fieldset').nth(1)).toContainText('12 marks');
    for (const select of await page.locator('main select').all()) await expect(select).toHaveValue('');
    const graph=page.locator('#'+questionFieldId('first','graph'));
    await graph.selectOption('choice:no');
    await page.getByLabel('Read from the graph',{exact:true}).selectOption('choice:yes');
    await page.getByLabel('Question setting (optional)',{exact:true}).selectOption('automatic');
    await page.getByLabel('Paper notes (optional)',{exact:true}).selectOption('text');
    await page.getByLabel('Your answer for Paper notes',{exact:true}).fill('Preserve this synthetic preference.');
    const rejected = page.waitForResponse(r=>r.url().endsWith(path+'/submit')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Submit answers',exact:true}).click();
    const refusal=await rejected;
    expect(refusal.status()).toBe(422);
    expect(await refusal.json()).toEqual({error:authoredError,fieldError:{itemId:'first',fieldId:'graph'}});
    await expect(graph).toBeFocused();
    await expect(graph).toHaveAttribute('aria-invalid','true');
    await expect(page.locator('main').getByRole('alert')).toHaveText(authoredError);
    await expect(page.getByLabel('Your answer for Paper notes',{exact:true})).toHaveValue('Preserve this synthetic preference.');
    await expect(page.getByLabel('Question setting (optional)',{exact:true})).toHaveValue('automatic');
    const unchanged=await (await page.request.get(target.origin+path,{headers,maxRedirects:0})).json();
    expect(unchanged.state).toBe('awaiting_answers'); expect(unchanged.answers).toBeNull();
    await graph.selectOption('choice:yes');
    await expect(graph).toHaveAttribute('aria-invalid','false');
    const accepted=page.waitForResponse(r=>r.url().endsWith(path+'/submit')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Submit answers',exact:true}).click();
    const response=await accepted; expect(response.status()).toBe(202);
    const submitted=response.request().postDataJSON();
    expect(submitted.requestKey).toBe(refusal.request().postDataJSON().requestKey);
    await expect(page.getByRole('heading',{name:'Queued',exact:true})).toBeVisible();
    const duplicate=await page.request.post(target.origin+path+'/submit',{headers,maxRedirects:0,data:submitted});
    expect(duplicate.status()).toBe(202);expect(await duplicate.json()).toEqual({id:fixture.order});
    const denied=await other.request.post(target.origin+path+'/submit',{headers,maxRedirects:0,data:submitted});
    expect(denied.status()).toBe(403);
    const final=await (await page.request.get(target.origin+path,{headers,maxRedirects:0})).json();
    expect(final.state).toBe('queued');expect(final.form).toBeNull();expect(final.answers).toEqual(submitted.answers);
    expect(final.documents).toEqual([]);
    expect((await page.request.get(target.origin+path+'/documents/paper',{headers,maxRedirects:0})).status()).toBe(404);
    await page.getByText('Your submitted answers',{exact:true}).click();
    await expect(page.getByText('Preserve this synthetic preference.',{exact:true})).toBeVisible();
    writeFileSync(info.outputPath('questionnaire-evidence.json'),JSON.stringify({order:fixture.order,origin:target.origin,project:target.project,
      anonymousDenied:true,otherSchoolDenied:true,privatePlanHidden:true,invalidAnswersRefused:true,fieldFocused:true,
      answersPreserved:true,submissionKeyPreserved:true,duplicateAccepted:true,finalState:final.state,documents:final.documents,
      scope:'Synthetic admission only; database event count and worker fence require separate operator inspection.'},null,2));
  } finally { await Promise.all(contexts.map(c=>c.close())); }
});
