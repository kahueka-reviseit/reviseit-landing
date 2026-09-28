import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import {publication,recordReceipt} from '../fixtures/publication';
import {randomUUID} from 'node:crypto';
import { readFileSync } from 'node:fs';
const url = process.env.SUPABASE_URL || '';
const key = process.env.AUTH_TEST_SERVICE_KEY || '';
const database = process.env.AUTH_TEST_DATABASE_URL || '';
// No skips: missing local infrastructure must be an explicit test failure.
let admin: SupabaseClient;
test.beforeAll(() => {
  if (![url,database].every(v => v && ['localhost','127.0.0.1'].includes(new URL(v).hostname)) || !key) throw new Error('Run npm run test:auth:integration with disposable local Supabase running.');
  admin = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
});
const password = 'Synthetic-Test-Password-123!';
async function login(page: Page, email: string, pass = password) {
  await page.goto('/login');
  await page.locator('main form').first().getByLabel('School email address').fill(email);
  await page.locator('main form').first().getByLabel('Password',{exact:true}).fill(pass);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page).toHaveURL(/\/account$/);
}
// C08: the staff decision is made in the review panel of /admin/accounts; nothing is preselected.
async function decide(reviewPage: Page, email: string, decision: 'Approve'|'Suspend access', evidence: string, department?: string) {
  await reviewPage.goto('/admin/accounts?status=all');
  await reviewPage.getByRole('row').filter({hasText:email}).click();
  const panel = reviewPage.getByRole('complementary',{name:'Synthetic Teacher'});
  for (const name of ['Approve','Reject','Suspend access']) await expect(panel.getByRole('radio',{name})).not.toBeChecked();
  await panel.getByRole('radio',{name:decision}).check();
  if (department) await panel.getByLabel('Verified school and department').selectOption({label:department});
  await panel.getByLabel('Evidence or reason').fill(evidence);
  await panel.getByRole('button',{name:'Save decision'}).click();
  await expect(panel.getByRole('status')).toContainText('Decision saved');
}

test('real signup, email confirmation, team approval, suspension and password recovery', async ({page,browser}) => {
  const suffix = Date.now();
  const email = `teacher-${suffix}@synthetic-school.example`;
  const reviewerEmail = `reviewer-${suffix}@reviseit.example`;
  const db = new Client({connectionString:database});
  await db.connect();
  const { data: reviewer, error: reviewerError } = await admin.auth.admin.createUser({email:reviewerEmail,password,email_confirm:true});
  expect(reviewerError).toBeNull();
  await db.query('insert into private.account_reviewers(user_id) values($1)',[reviewer.user!.id]);
  const reviewContext = await browser.newContext();
  const reviewPage = await reviewContext.newPage();
  try {
    await page.goto('/register');
    await page.getByLabel('Your full name').fill('Synthetic Teacher');
    await page.getByLabel('School',{exact:true}).fill('Synthetic School');
    await page.getByLabel('Department',{exact:true}).fill('Physical Sciences');
    await page.getByLabel('School email address').fill(email);
    await page.getByLabel('Password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Check your school inbox'})).toContainText(email);
    await page.goto('/login');
    await page.locator('main form').first().getByLabel('School email address').fill(email);
    await page.locator('main form').first().getByLabel('Password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('confirm your school email first');
    // A refused sign-in keeps the email and clears the password.
    await expect(page.locator('main form').first().getByLabel('Password',{exact:true})).toHaveValue('');
    // Retrieve a local-only signup link through the admin test client; real hosted email delivery is a separate smoke check.
    const {data:confirmation,error:linkError} = await admin.auth.admin.generateLink({type:'signup',email,password});
    expect(linkError).toBeNull();
    await page.goto(`/auth/confirm?token_hash=${confirmation.properties!.hashed_token}&type=signup`);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Your account is awaiting verification'})).toBeVisible();
    // Until access is verified the header offers only My account.
    await expect(page.getByRole('navigation',{name:'Account navigation'}).getByRole('link',{name:'My papers'})).toHaveCount(0);
    await page.goto('/teacher');
    await expect(page).toHaveURL(/\/account$/);
    expect((await page.request.get('/api/teacher/session')).status()).toBe(403);
    await login(reviewPage,reviewerEmail);
    await reviewPage.getByRole('link',{name:'Open admin workspace'}).click();
    await expect(reviewPage.getByRole('heading',{name:/^Good (morning|afternoon|evening)/})).toBeVisible();
    await reviewPage.goto('/admin/accounts');
    await expect(reviewPage.getByRole('row').filter({hasText:email})).toContainText('Pending');
    await reviewPage.getByRole('button',{name:'+ Add a verified school department'}).click();
    const schoolForm = reviewPage.getByRole('region',{name:'Add a verified school department'});
    await schoolForm.getByLabel('Full school name').fill('Synthetic School');
    await schoolForm.getByLabel('School identifier').fill('synthetic-school');
    await schoolForm.getByLabel('Department',{exact:true}).fill('Physical Sciences');
    await schoolForm.getByRole('button',{name:'Add department'}).click();
    await expect(schoolForm.getByRole('status')).toContainText('available');
    // Search is a server read over the same list.
    await reviewPage.getByRole('searchbox',{name:'Search name, email or school'}).fill(`teacher-${suffix}`);
    await reviewPage.getByRole('searchbox',{name:'Search name, email or school'}).press('Enter');
    await expect(reviewPage.getByRole('row').filter({hasText:email})).toBeVisible();
    await decide(reviewPage,email,'Approve','Confirmed affiliation using synthetic test evidence.','Synthetic School · Physical Sciences');
    await db.query(readFileSync('tests/fixtures/workspace.sql','utf8'));
    await db.query("insert into public.school_curriculum_access(school_id,module_id) select school_id,m.id from public.teacher_accounts cross join public.curriculum_modules m where user_id=$1",[(await db.query('select id from auth.users where email=$1',[email])).rows[0].id]);
    await page.goto('/account');
    await expect(page.getByRole('heading',{name:'Your school account is verified'})).toBeVisible();
    await page.goto('/teacher');
    await expect(page.getByRole('link',{name:'My curricula'})).toHaveAttribute('aria-current','page');
    const initialResponse=await page.request.get('/api/teacher/workspace');
    expect(initialResponse.status()).toBe(200);
    const initial=await initialResponse.json();
    expect(JSON.stringify(initial)).not.toMatch(/parameter_questions|specification|generation_prompt/);
    const diagramUrl=initial.entries.find((e:{thumbnail?:{src:string}})=>e.thumbnail)?.thumbnail.src as string;
    expect(diagramUrl).toBeTruthy();
    expect((await page.request.get(diagramUrl)).status()).toBe(200);
    await page.goto('/teacher?view=formatting');
    await expect(page.getByText('Shared with your school')).toBeVisible();
    await page.getByLabel('School heading').fill('SYNTHETIC SCHOOL SCIENCE');
    await page.getByRole('button',{name:'Save school formatting'}).click();
    await expect(page.getByRole('status').filter({hasText:'School formatting saved'})).toBeVisible();
    await page.goto('/teacher?view=formatting');
    await expect(page.getByLabel('School heading')).toHaveValue('SYNTHETIC SCHOOL SCIENCE');
    await page.goto('/teacher/orders');
    await expect(page.getByRole('heading',{name:'No papers yet'})).toBeVisible();
    // One build remains running: an approved import changes the catalogue on the next read.
    const release=publication('published-2','demo-grade-10-sciences');
    release.module.name='Grade 10 Physical Sciences · demonstration';
    const receiptId=randomUUID();await recordReceipt(db,receiptId,release,'demo-1');
    // Supabase's test administrator can manage roles but does not automatically inherit new ones.
    await db.query('grant reviseit_catalogue_publisher to current_user');
    await db.query('set role reviseit_catalogue_publisher');
    await db.query('select public.import_catalogue_release($1,$2::jsonb)',[receiptId,JSON.stringify(release)]);
    await db.query('reset role');
    const publishedResponse=await page.request.get('/api/teacher/workspace?curriculum=demo-grade-10-sciences');
    const publishedBody=await publishedResponse.text();expect(publishedBody).toContain('published-2');
    expect(publishedBody).not.toMatch(/forms_digest|gate_record_id|reviewer_id|contentDigest|parameter_questions/);
    await page.goto('/teacher');
    await page.screenshot({path:'test-results/teacher-workspace-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.goto('/account');
    await page.screenshot({path:'test-results/teacher-account-mobile.png',fullPage:true});
    await page.setViewportSize({width:1280,height:800});
    expect((await page.request.get('/api/teacher/session')).status()).toBe(200);
    await decide(reviewPage,email,'Suspend access','Synthetic suspension test.');
    await reviewPage.goto('/admin/accounts?status=suspended');
    await expect(reviewPage.getByRole('row').filter({hasText:email})).toContainText('Paused');
    await reviewPage.screenshot({path:'test-results/staff-accounts-desktop.png',fullPage:true});
    expect((await page.request.get('/api/teacher/session')).status()).toBe(403);
    expect((await page.request.get('/api/teacher/workspace')).status()).toBe(403);
    expect((await page.request.get('/api/teacher/catalogue/search?q=electricity')).status()).toBe(403);
    expect((await page.request.get(diagramUrl)).status()).toBe(403);
    await page.goto('/teacher');
    await expect(page.getByRole('heading',{name:'Your account access is paused'})).toBeVisible();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(page).toHaveURL(/\/login$/);
    const {data:recovery,error:recoveryError} = await admin.auth.admin.generateLink({type:'recovery',email});
    expect(recoveryError).toBeNull();
    await page.goto(`/auth/confirm?token_hash=${recovery.properties!.hashed_token}&type=recovery`);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Choose a new password'})).toBeVisible();
    await page.getByLabel('New password',{exact:true}).fill(`${password}new`);
    await page.getByLabel('Repeat new password',{exact:true}).fill(`${password}new`);
    await page.getByRole('button',{name:'Save new password'}).click();
    await expect(page).toHaveURL(/\/login\?message=password-updated$/);
    await expect(page.getByRole('status').filter({hasText:'Password updated'})).toBeVisible();
    await login(page,email,`${password}new`);
    await expect(page.getByRole('heading',{name:'Your account access is paused'})).toBeVisible();
  } finally { await Promise.allSettled([reviewContext.close(), db.end()]); }
});
